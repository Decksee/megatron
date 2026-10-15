import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FileUp, Settings2 } from "lucide-react";
import { useData } from "./useData";
import { isHeld } from "./hold";
import { useTheme } from "./theme";
import { isSpeaking, useSpeechPrefs } from "./ai/speech";
import { listenAfterWake, useAssistantShortcut, useCountdownWatcher, useIdleAutoPause, useWakeWord } from "./background";
import { focusElapsedMs, IDLE_KEY, useFocusMonitor } from "./focus";
import { dueReminders, SNOOZE_MINUTES, useReminderWatcher } from "./reminders";
import { useTelegram } from "./telegram";
import { useUpdateCheck } from "./updater";
import { useBreakNudge, useDailyBriefing, useFirstRun } from "./wellbeing";
import { useMood, useNotchCursor, useNotchOccupied } from "./mood";
import { formatTrackTime, mediaAppName, mediaPosition, useMedia } from "./media";
import { addFiles, aiConfig, aiStore, useAi, voiceConfig } from "./ai/session";
import { useFileDrop } from "./fileDrop";
import { completeReminder, snoozeReminder } from "./db";
import { addDays, formatClock, formatDuration, isRunning, startOfDay, timerElapsed, totalMs } from "./time";
import { Bot } from "./components/Bot";
import { Confetti } from "./components/Confetti";
import { VoiceWave } from "./components/VoiceWave";
import { SoundCurves } from "./components/SoundCurves";
import { Today } from "./views/Today";
import { Controls } from "./views/Controls";
import { Tasks } from "./views/Tasks";
import { Projects } from "./views/Projects";
import { Time } from "./views/Time";
import { Focus } from "./views/Focus";
import { Reminders } from "./views/Reminders";
import { Assistant } from "./views/Assistant";

const isTauri = "__TAURI_INTERNALS__" in window;

const COLLAPSED = { width: 230, height: 36 };
/** Pilule un peu plus large quand une musique joue (titre + avancement). */
const COLLAPSED_MEDIA = { width: 340, height: 40 };
/** Fin de focus réussie : la pastille s'élargit pour féliciter. */
const CELEBRATE = { width: 300, height: 40 };
const CELEBRATION_MS = 7000;
/** Pastille vocale (« Hey Mégatron ») : juste ses yeux et les ondes, sans texte ni ouvrir l'encoche. */
const VOICE_PILL = { width: 230, height: 50 };
const VOICE_TAIL_MS = 2600;
const VOICE_DROP = { width: 300, height: 78 };
/** Hauteur gagnée sur l'onglet Contrôles quand aucune musique ne joue. */
const CONTROLS_NO_MEDIA_SHRINK = 66;
/** En focus, pendant une pause ou une distraction : place pour le temps de repos restant. */
const COLLAPSED_FOCUS = { width: 290, height: 36 };
/** En focus, concentré : juste l'étiquette et le temps restant. */
const COLLAPSED_FOCUS_CALM = { width: 182, height: 36 };
/** Encoche entrouverte quand un rappel arrive. */
const ALERT = { width: 420, height: 64 };
/** Au repos (rien en cours), l'encoche se réduit à une fine barre qui ne cache presque rien. */
const MINI = { width: 150, height: 6 };
/**
 * Zone de survol de la fine barre : la barre elle-même, tout en haut de l'écran, sans marge.
 * Il faut pousser la souris contre le bord : naviguer dans les onglets juste en dessous ne l'ouvre pas.
 */
const MINI_HOVER = { width: 150, height: 5 };
// Zone de survol un peu plus large que l'encoche fermée, pour l'attraper facilement.
const HOVER_MARGIN = 8;
const COLLAPSE_DELAY_MS = 250;
/** La souris doit s'arrêter un instant pour ouvrir : on peut viser un onglet juste en dessous sans l'ouvrir. */
const OPEN_DELAY_MS = 280;
/** Plus long pour la fine barre, qui est posée sur d'autres fenêtres. */
const OPEN_DELAY_MINI_MS = 180;
/** La fine barre s'épaissit dès que la souris la touche, avant de s'ouvrir : réaction immédiate. */
const MINI_HOVERED = { width: 190, height: 12 };

const spring = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const;

/** Chaque onglet a sa taille : l'encoche s'élargit ou se resserre en changeant d'onglet. */
const TABS = [
  { id: "today", label: "Aujourd'hui", width: 800, height: 336 },
  { id: "controls", label: "Contrôles", width: 660, height: 404 },
  { id: "tasks", label: "Tâches", width: 720, height: 410 },
  { id: "projects", label: "Projets", width: 760, height: 470 },
  { id: "time", label: "Temps", width: 740, height: 440 },
  { id: "focus", label: "Focus", width: 820, height: 420 },
  { id: "reminders", label: "Rappels", width: 780, height: 420 },
  { id: "assistant", label: "IA", width: 780, height: 468 },
] as const;
type TabId = (typeof TABS)[number]["id"];

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** `interactive` : l'encoche reçoit les clics ; sinon ils passent aux applications en dessous. */
function reportHitArea(size: { width: number; height: number }, interactive: boolean, margin = HOVER_MARGIN) {
  if (!isTauri) return;
  invoke("set_hit_area", {
    width: size.width + margin * 2,
    height: size.height + margin,
    interactive,
  }).catch(console.error);
}

export function App() {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<TabId>("today");
  const collapseTimer = useRef<number | undefined>(undefined);
  const openTimer = useRef<number | undefined>(undefined);
  const miniRef = useRef(false);
  const [hovering, setHovering] = useState(false);
  const hoveredRef = useRef(false);
  const now = useNow();
  const data = useData();
  useTheme(data.settings);
  useIdleAutoPause(data);
  useCountdownWatcher(data);
  useReminderWatcher(data);
  useTelegram(data);
  useUpdateCheck(data.settings);
  useDailyBriefing();
  useBreakNudge();
  useFirstRun(data);
  useAssistantShortcut(data, () => {
    setTab("assistant");
    setExpanded(true);
  });
  useSpeechPrefs(data.settings);
  useWakeWord(data, () => {
    // C'est sa propre voix qu'il entend, ou une conversation est déjà en cours.
    const ai = aiStore.get();
    if (isSpeaking() || ai.conversing || ai.recording || ai.busy) return;
    // Façon Siri : la pastille vocale suffit. Sans IA ou sans voix configurée, on ouvre l'onglet IA.
    if (!aiConfig(data.settings) || !voiceConfig(data.settings)) {
      setTab("assistant");
      setExpanded(true);
    }
    listenAfterWake(data);
  });
  const focus = useFocusMonitor(data);
  const focusSession = focus && data.focusSessions.find((s) => s.id === focus.sessionId);
  const focusOver = !!focusSession && focus!.distractionMs > focusSession.budget_minutes * 60_000;
  const due = dueReminders(data.reminders, now);
  const alert = !expanded ? due[0] : undefined;
  const ai = useAi();
  // Conversation vocale terminée : l'encoche se range peu après, sauf si la souris est dessus.
  const wasConversing = useRef(false);
  const [voiceTail, setVoiceTail] = useState(false);
  const showVoice = ai.conversing || voiceTail;
  /** Pendant la conversation vocale : la pastille devient une zone de dépôt (fichier demandé ou en cours de glisser). */
  const voiceDrop = showVoice && (ai.awaitingFile || ai.dragging);

  // Fichier glissé sur l'encoche : en conversation vocale il part tout de suite,
  // sinon l'encoche s'ouvre sur la discussion avec le fichier prêt à partir.
  useFileDrop((paths) => {
    if (!aiStore.get().conversing) {
      setTab("assistant");
      setExpanded(true);
    }
    void addFiles(paths);
  });
  useEffect(() => {
    if (ai.conversing) {
      wasConversing.current = true;
      return;
    }
    if (!wasConversing.current) return;
    wasConversing.current = false;
    // La pastille vocale reste le temps qu'il dise au revoir.
    setVoiceTail(true);
    window.setTimeout(() => setVoiceTail(false), VOICE_TAIL_MS);
    const t = window.setTimeout(() => {
      if (!hoveredRef.current && !isBusy()) setExpanded(false);
    }, 2500);
    return () => window.clearTimeout(t);
  }, [ai.conversing]);
  // Focus mené à son terme : Mégatron fête ça quelques secondes (sourire, sautillement, confettis).
  const [celebration, setCelebration] = useState<{ minutes: number } | null>(null);
  const lastFocusId = useRef<number | null>(null);
  const celebrationTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const id = focusSession?.id ?? null;
    const prev = lastFocusId.current;
    lastFocusId.current = id;
    if (prev == null || id != null) return;
    const ended = data.focusSessions.find((s) => s.id === prev);
    if (!ended?.completed || !ended.ended_at) return;
    setCelebration({ minutes: Math.max(1, Math.round((new Date(ended.ended_at).getTime() - new Date(ended.started_at).getTime()) / 60_000)) });
    window.clearTimeout(celebrationTimer.current);
    celebrationTimer.current = window.setTimeout(() => setCelebration(null), CELEBRATION_MS);
  }, [focusSession?.id, data.focusSessions]);
  const computedMood = useMood(data, focus, due, { listening: ai.recording, thinking: ai.busy || ai.transcribing });
  const mood = celebration ? "happy" : computedMood;
  const cursor = useNotchCursor();
  const media = useMedia(expanded && (tab === "controls" || tab === "today"));
  const occupied = useNotchOccupied();

  // Pendant un rappel, le survol ne déplie pas l'encoche : il faut pouvoir cliquer sur ses boutons.
  const alertRef = useRef(false);
  alertRef.current = !!due.length;

  // On reste ouvert tant qu'on tape dans un champ ou qu'une action est en cours ;
  // dans ce cas l'encoche se ferme quand la fenêtre perd le focus.
  const isBusy = () => {
    const el = document.activeElement;
    const state = aiStore.get();
    if (state.recording || state.busy || state.transcribing || state.conversing || state.dragging || isSpeaking()) return true;
    // Un champ ne retient l'encoche que si la fenêtre a vraiment le focus : l'onglet IA place le curseur
    // dans son champ dès l'ouverture, même quand on n'a fait que survoler (on ne pouvait plus la fermer).
    const typing =
      document.hasFocus() && el instanceof HTMLElement && el.matches('input, textarea, select, [aria-expanded="true"]');
    return isHeld() || typing;
  };

  const setHovered = (hovered: boolean) => {
    hoveredRef.current = hovered;
    setHovering(hovered);
    window.clearTimeout(collapseTimer.current);
    window.clearTimeout(openTimer.current);
    if (hovered) {
      if (!alertRef.current) {
        const delay = miniRef.current ? OPEN_DELAY_MINI_MS : OPEN_DELAY_MS;
        openTimer.current = window.setTimeout(() => setExpanded(true), delay);
      }
    } else {
      collapseTimer.current = window.setTimeout(() => {
        if (!hoveredRef.current && !isBusy()) setExpanded(false);
      }, COLLAPSE_DELAY_MS);
    }
  };

  useEffect(() => {
    const onBlur = () => {
      if (!hoveredRef.current && !isHeld()) setExpanded(false);
    };
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, []);

  // Le survol est détecté côté Rust (la fenêtre laisse passer les clics hors de l'encoche).
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWebviewWindow().listen<boolean>("notch-hover", (e) => setHovered(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const tabSize = TABS.find((t) => t.id === tab)!;
  // Contrôles sans musique : le lecteur est plus petit, l'encoche aussi (les raccourcis gardent leurs proportions).
  const current = tab === "controls" && !media ? { ...tabSize, height: tabSize.height - CONTROLS_NO_MEDIA_SHRINK } : tabSize;
  const busyPill =
    ai.recording || ai.busy || ai.transcribing || !!focusSession || data.timers.length > 0;
  const mediaPill = !busyPill && !!media?.playing;
  // Fine barre : « auto » = quand une fenêtre est derrière (sauf alerte importante),
  // « always » = dès que rien n'est en cours, « never » = jamais.
  const miniMode = data.settings.notch_mini === "0" ? "never" : data.settings.notch_mini === "1" ? "always" : (data.settings.notch_mini ?? "auto");
  // Une distraction ne fait pas ressortir la barre fine (elle passe juste au rouge) :
  // grandir au-dessus d'une fenêtre empêchait ensuite de détecter qu'elle est derrière.
  const important = ai.recording || ai.busy || ai.transcribing || showVoice;
  const activity = busyPill || mediaPill;
  const mini =
    !expanded &&
    !alert &&
    !celebration &&
    !showVoice &&
    (miniMode === "always" ? !activity : miniMode === "auto" ? occupied && !important : false);
  const size = expanded
    ? current
    : alert
      ? ALERT
      : voiceDrop
        ? VOICE_DROP
        : showVoice
        ? VOICE_PILL
        : celebration
        ? CELEBRATE
        : mini
        ? hovering
          ? MINI_HOVERED
          : MINI
        : mediaPill
          ? COLLAPSED_MEDIA
          : focusSession && !(ai.recording || ai.busy || ai.transcribing)
            ? focus?.distraction
              ? COLLAPSED_FOCUS
              : COLLAPSED_FOCUS_CALM
            : COLLAPSED;
  // Ouverte ou rappel affiché : cliquable. Fermée : survol seulement, les clics traversent.
  // La pastille vocale est cliquable : un clic ouvre la discussion complète.
  const interactive = expanded || !!alert || showVoice;
  // Pour entrer, il faut toucher le bord (zone étroite) ; une fois dessus, la zone suit la barre épaissie.
  const hoverZone = mini ? (hovering ? MINI_HOVERED : MINI_HOVER) : size;
  miniRef.current = mini;
  useEffect(() => {
    reportHitArea(hoverZone, interactive, mini ? 0 : HOVER_MARGIN);
  }, [hoverZone.width, hoverZone.height, interactive, mini]);

  const time = now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const remaining = data.tasks.filter((t) => !t.done).length;
  const runningTimers = data.timers.filter((t) => isRunning(data.entries, t.project_id));
  const first = runningTimers[0];
  const today = totalMs(data.entries, startOfDay(now), addDays(startOfDay(now), 1), now);
  const glow = celebration ? "good" : focus?.distraction ? (focusOver ? "bad" : "warn") : undefined;

  const openSettings = () => invoke("open_settings", { section: null }).catch(console.error);

  return (
    <div className="stage">
      {/* Sous l'encoche, en dehors : les clics traversent toujours. */}
      {celebration && <Confetti key={celebration.minutes + String(lastFocusId.current)} />}
      <motion.div
        className="notch"
        data-glow={glow}
        data-mini={mini || undefined}
        data-active={(mini && activity) || undefined}
        initial={false}
        animate={{
          width: size.width,
          height: size.height,
          borderBottomLeftRadius: expanded ? 30 : alert ? 22 : mini ? 4 : 16,
          borderBottomRightRadius: expanded ? 30 : alert ? 22 : mini ? 4 : 16,
        }}
        transition={spring}
        onMouseEnter={isTauri ? undefined : () => setHovered(true)}
        onMouseLeave={isTauri ? undefined : () => setHovered(false)}
      >
        <div className="clip">
          <AnimatePresence mode="popLayout" initial={false}>
            {expanded ? (
              <motion.div
                key="panel"
                className="panel"
                style={{ width: current.width, height: current.height, marginLeft: -current.width / 2 }}
                initial={{ opacity: 0, filter: "blur(6px)", y: -6 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                exit={{ opacity: 0, filter: "blur(6px)", y: -6, transition: { duration: 0.12 } }}
                transition={{ duration: 0.22, delay: 0.06 }}
              >
                <header className="panel-header">
                  <Bot bare mood={mood} size={22} cursor={cursor} />
                  <nav className="tabs" aria-label="Sections">
                    {TABS.map((t) => (
                      <button
                        key={t.id}
                        className={t.id === tab ? "tab active" : "tab"}
                        onClick={() => setTab(t.id)}
                        aria-current={t.id === tab ? "page" : undefined}
                      >
                        {t.id === tab && <motion.span layoutId="tab-pill" className="tab-pill" transition={spring} />}
                        <span className="tab-label">{t.label}</span>
                      </button>
                    ))}
                  </nav>
                  <button className="icon-round" onClick={openSettings} aria-label="Ouvrir les réglages" title="Réglages">
                    <Settings2 size={15} />
                  </button>
                </header>

                <AnimatePresence mode="wait">
                  <motion.section
                    key={tab}
                    className="panel-body"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6, transition: { duration: 0.1 } }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {tab === "today" && <Today {...data} now={now} onOpen={setTab} />}
                    {tab === "controls" && <Controls media={media} now={now} />}
                    {tab === "tasks" && <Tasks {...data} />}
                    {tab === "projects" && <Projects {...data} />}
                    {tab === "time" && <Time {...data} now={now} />}
                    {tab === "focus" && <Focus {...data} now={now} status={focus} />}
                    {tab === "reminders" && <Reminders {...data} now={now} />}
                    {tab === "assistant" && <Assistant {...data} />}
                  </motion.section>
                </AnimatePresence>
              </motion.div>
            ) : alert ? (
              <motion.div
                key={`alert-${alert.id}`}
                className="alert"
                initial={{ opacity: 0, filter: "blur(4px)", y: -4 }}
                animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                transition={{ duration: 0.2, delay: 0.08 }}
              >
                <Bot bare mood="alert" size={26} cursor={cursor} />
                <button
                  className="alert-text"
                  onClick={() => {
                    setTab("reminders");
                    setExpanded(true);
                  }}
                  title="Voir les rappels"
                >
                  <span className="alert-title">{alert.title}</span>
                  <span className="muted small">
                    {due.length > 1 ? `+ ${due.length - 1} autre${due.length > 2 ? "s" : ""} · ` : ""}
                    {new Date(alert.due_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </button>
                <button className="btn ghost icon" onClick={() => snoozeReminder(alert, SNOOZE_MINUTES)}>
                  +{SNOOZE_MINUTES} min
                </button>
                <button className="btn primary icon" onClick={() => completeReminder(alert)}>
                  Fait
                </button>
              </motion.div>
            ) : showVoice ? (
              <motion.button
                key="voice"
                className="voice-pill"
                onClick={() => {
                  setTab("assistant");
                  setExpanded(true);
                }}
                title="Ouvrir la discussion"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                transition={{ duration: 0.2 }}
              >
                <Bot bare mood={voiceDrop ? "alert" : ai.recording ? "listen" : ai.busy || ai.transcribing ? "think" : "happy"} size={20} cursor={cursor} />
                {voiceDrop ? (
                  <span className={ai.dragging ? "voice-drop over" : "voice-drop"}>
                    <FileUp size={16} />
                    {ai.dragging ? "Lâche, je l'attrape !" : "Dépose ton fichier ici"}
                  </span>
                ) : (
                  <VoiceWave phase={ai.recording ? "listen" : ai.busy || ai.transcribing ? "think" : "idle"} />
                )}
              </motion.button>
            ) : mini ? (
              <motion.div
                key="mini"
                className="mini-notch"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              />
            ) : (
              <motion.div
                key="pill"
                className="pill"
                initial={{ opacity: 0, filter: "blur(4px)" }}
                animate={{ opacity: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, filter: "blur(4px)" }}
                transition={{ duration: 0.15 }}
              >
                {celebration ? (
                  <motion.span
                    className="pill-bot"
                    animate={{ y: [0, -4, 0, -2, 0], rotate: [0, -6, 6, -3, 0] }}
                    transition={{ duration: 0.9, repeat: Infinity, repeatDelay: 0.4 }}
                  >
                    <Bot bare mood="happy" size={20} cursor={cursor} />
                  </motion.span>
                ) : (
                  <Bot bare mood={mood} size={20} cursor={cursor} />
                )}
                {celebration ? (
                  <>
                    <span className="pill-tag">Bravo !</span>
                    <span className="pill-time">{celebration.minutes} min de focus</span>
                    <span className="pill-work">🎉</span>
                  </>
                ) : ai.recording || ai.busy || ai.transcribing ? (
                  <>
                    <span className="pill-time">{ai.recording ? "Je t'écoute…" : "Je réfléchis…"}</span>
                    <span className="pill-work">IA</span>
                  </>
                ) : focusSession ? (
                  <>
                    <span className={focusSession.paused_at ? "pill-tag paused" : focusOver && focus!.distraction ? "pill-tag bad" : "pill-tag"}>
                      {focusSession.paused_at ? "Pause" : "Focus"}
                    </span>
                    <span className="pill-time">
                      {formatClock(focusSession.planned_minutes * 60_000 - focusElapsedMs(focusSession, now))}
                    </span>
                    {/* Le temps de repos ne s'affiche que pendant qu'on le consomme (pause ou distraction). */}
                    {focus!.distraction && (
                      <span className={focusOver ? "pill-work bad" : "pill-work rest"}>
                        {focusOver
                          ? focus!.distraction === IDLE_KEY
                            ? "repos dépassé"
                            : `${focus!.distraction} · dépassé`
                          : `${focus!.distraction === IDLE_KEY ? "repos" : focus!.distraction} ${formatClock(
                              Math.max(0, focusSession.budget_minutes * 60_000 - focus!.distractionMs),
                            )}`}
                      </span>
                    )}
                  </>
                ) : first ? (
                  <>
                    <span className="pill-time">
                      {runningTimers.length > 1
                        ? `${runningTimers.length} projets`
                        : formatClock(timerElapsed(first, data.entries, now))}
                    </span>
                    <span className="pill-work">{formatDuration(today)} auj.</span>
                  </>
                ) : data.timers.length ? (
                  <>
                    <span className="pill-time">En pause</span>
                    <span className="pill-work">{formatDuration(today)} auj.</span>
                  </>
                ) : mediaPill && media ? (
                  <>
                    <span className="pill-time pill-track" title={`${media.title} · ${media.artist}`}>
                      {media.title}
                    </span>
                    {media.durationMs > 0 ? (
                      <>
                        <SoundCurves
                          playing={media.playing}
                          ratio={mediaPosition(media, now.getTime()) / media.durationMs}
                          width={110}
                          height={30}
                        />
                        <span className="pill-work">{formatTrackTime(mediaPosition(media, now.getTime()))}</span>
                      </>
                    ) : (
                      // Certains lecteurs (navigateurs) ne donnent pas la durée : on affiche l'artiste.
                      <>
                        <SoundCurves playing={media.playing} ratio={1} width={90} height={30} />
                        <span className="pill-work pill-artist">{media.artist || mediaAppName(media.app)}</span>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <span className="pill-time">{time}</span>
                    <span className="pill-work">{remaining ? `${remaining} à faire` : "à jour"}</span>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
