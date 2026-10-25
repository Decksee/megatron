import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Check, Minus, Pause, Play, Plus, ShieldCheck, Square } from "lucide-react";
import { endFocus, pauseFocus, resumeFocus, setSetting, startFocus, listFocusSessions, type FocusSession } from "../db";
import { activeFocus, focusElapsedMs } from "../focus";
import { ProgressRing } from "../views/Today";
import { Switch } from "../components/Switch";
import { native } from "./native";
import { Sheet } from "./sheets";
import type { Data } from "../useData";

const DURATIONS = [15, 25, 45, 60, 90];
const STEP = 5;
const MIN = 5;
const MAX = 240;

const formatMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`);
const endLabel = (m: number) => new Date(Date.now() + m * 60_000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const isTauri = "__TAURI_INTERNALS__" in window;

interface App {
  package: string;
  label: string;
}

const blockedApps = (s: Data["settings"]): string[] => {
  try {
    return JSON.parse(s.m_block_apps || "[]");
  } catch {
    return [];
  }
};

/** Fin du focus (ms) d'après la session : début + durée prévue + pauses. */
const endsAt = (s: FocusSession, now = new Date()) => now.getTime() + s.planned_minutes * 60_000 - focusElapsedMs(s, now);

/** Prévient Android : alarme de fin, compte à rebours en notification, blocage des applis choisies. */
async function armNative(session: FocusSession, settings: Data["settings"]) {
  if (!isTauri) return;
  await native("focusStart", {
    sessionId: session.id,
    endsAt: Math.round(endsAt(session)),
    block: settings.m_block !== "0",
    apps: blockedApps(settings),
  }).catch(console.error);
}

function useTick(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setT((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

export function MobileFocus({ focusSessions, settings }: Data) {
  const session = activeFocus(focusSessions);
  const [minutes, setMinutes] = useState(Number(settings.focus_duration) || 25);
  const [picking, setPicking] = useState(false);
  const [blocker, setBlocker] = useState<{ usage: boolean; overlay: boolean; enabled: boolean } | null>(null);
  useTick(!!session && !session.paused_at);
  const block = settings.m_block !== "0";
  // Durée libre : par pas de 5 min, de 5 min à 4 h ; retenue pour la prochaine fois.
  const choose = (m: number) => {
    const v = Math.min(MAX, Math.max(MIN, m));
    setMinutes(v);
    void setSetting("focus_duration", String(v));
  };
  const apps = blockedApps(settings);

  // Le service de blocage est-il autorisé ? (revérifié au retour des réglages d'Android)
  useEffect(() => {
    if (!isTauri) return;
    const check = () => native<{ usage: boolean; overlay: boolean; enabled: boolean }>("blockerStatus").then(setBlocker).catch(() => setBlocker(null));
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const start = async () => {
    await startFocus({ projectId: null, plannedMinutes: minutes, budgetMinutes: 0, mode: block ? "block" : "alert" });
    const fresh = activeFocus(await listFocusSessions());
    if (fresh) await armNative(fresh, settings);
  };
  const stop = async () => {
    if (!session) return;
    await endFocus(session, false);
    if (isTauri) await native("focusStop").catch(console.error);
  };
  const togglePause = async () => {
    if (!session) return;
    if (session.paused_at) {
      await resumeFocus(session);
      const fresh = activeFocus(await listFocusSessions());
      if (fresh) await armNative(fresh, settings);
    } else {
      await pauseFocus(session);
      if (isTauri) await native("focusStop").catch(console.error);
    }
  };

  // Compte à rebours terminé appli ouverte : session réussie (l'alarme Android le fait aussi appli fermée).
  const done = !!session && !session.paused_at && focusElapsedMs(session, new Date()) >= session.planned_minutes * 60_000;
  useEffect(() => {
    if (done && session) void endFocus(session, true);
  }, [done]);

  if (session) {
    const now = new Date();
    const total = session.planned_minutes * 60_000;
    const left = Math.max(0, total - focusElapsedMs(session, now));
    const mm = Math.floor(left / 60_000);
    const ss = Math.floor((left % 60_000) / 1000);
    return (
      <div className="m-focus">
        <div className="m-focus-ring">
          <ProgressRing ratio={1 - left / total} size={230} stroke={12}>
            <div className="m-focus-time">
              <b>
                {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
              </b>
              <span className="muted">{session.paused_at ? "En pause" : "Reste concentré"}</span>
            </div>
          </ProgressRing>
        </div>
        {session.mode === "block" && apps.length > 0 && (
          <p className="m-focus-note">
            <ShieldCheck size={15} /> {apps.length} appli{apps.length > 1 ? "s" : ""} bloquée{apps.length > 1 ? "s" : ""} jusqu'à la fin
          </p>
        )}
        <div className="m-focus-actions">
          <button className="btn ghost m-big" onClick={togglePause}>
            {session.paused_at ? <Play size={18} /> : <Pause size={18} />} {session.paused_at ? "Reprendre" : "Pause"}
          </button>
          <button className="btn danger m-big" onClick={stop}>
            <Square size={16} /> Arrêter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="m-focus">
      <section className="m-card m-duration-card">
        <b className="m-card-title">Durée</b>
        <div className="m-stepper">
          <motion.button
            className="m-step"
            whileTap={{ scale: 0.88 }}
            onClick={() => choose(minutes - STEP)}
            disabled={minutes <= MIN}
            aria-label="5 minutes de moins"
          >
            <Minus size={22} strokeWidth={2.6} />
          </motion.button>
          <div className="m-step-value">
            <b>{formatMinutes(minutes)}</b>
            <span className="muted small">fin vers {endLabel(minutes)}</span>
          </div>
          <motion.button
            className="m-step"
            whileTap={{ scale: 0.88 }}
            onClick={() => choose(minutes + STEP)}
            disabled={minutes >= MAX}
            aria-label="5 minutes de plus"
          >
            <Plus size={22} strokeWidth={2.6} />
          </motion.button>
        </div>
        <div className="m-durations">
          {DURATIONS.map((d) => (
            <button key={d} className={d === minutes ? "m-duration active" : "m-duration"} onClick={() => choose(d)}>
              {formatMinutes(d)}
            </button>
          ))}
        </div>
      </section>

      <section className="m-card">
        <div className="m-card-row">
          <div>
            <b className="m-card-title">Bloquer les applis distrayantes</b>
            <span className="muted small">Pendant le focus, un écran « Focus en cours » passe devant.</span>
          </div>
          <Switch label="Bloquer" checked={block} onChange={(v) => setSetting("m_block", v ? "1" : "0")} />
        </div>
        {/* Deux autorisations d'Android, données une seule fois ; Mégatron ne s'en sert que pendant un focus. */}
        {block && blocker && !blocker.enabled && (
          <div className="m-blocker-steps">
            <span className="muted small">Pour bloquer, Android demande deux autorisations (utilisées seulement pendant un focus) :</span>
            <button
              className={blocker.usage ? "m-blocker-step done" : "m-blocker-step"}
              disabled={blocker.usage}
              onClick={() => native("openBlockerSettings", { which: "usage" })}
            >
              <span className="m-blocker-num">{blocker.usage ? <Check size={14} strokeWidth={3} /> : 1}</span>
              <span>
                <b>Accès aux données d'utilisation</b>
                <span className="muted small">Pour voir quelle appli s'ouvre. Active Mégatron dans la liste.</span>
              </span>
            </button>
            <button
              className={blocker.overlay ? "m-blocker-step done" : "m-blocker-step"}
              disabled={blocker.overlay}
              onClick={() => native("openBlockerSettings", { which: "overlay" })}
            >
              <span className="m-blocker-num">{blocker.overlay ? <Check size={14} strokeWidth={3} /> : 2}</span>
              <span>
                <b>Affichage par-dessus les autres applis</b>
                <span className="muted small">Pour poser l'écran « Focus en cours » devant l'appli bloquée.</span>
              </span>
            </button>
          </div>
        )}
        {block && (
          <button className="btn ghost m-wide" onClick={() => setPicking(true)}>
            {apps.length ? `${apps.length} appli${apps.length > 1 ? "s" : ""} à bloquer · modifier` : "Choisir les applis à bloquer"}
          </button>
        )}
      </section>

      <button className="m-start" onClick={start}>
        <Play size={20} /> Lancer {formatMinutes(minutes)} de focus
      </button>

      <AppPicker open={picking} selected={apps} onClose={() => setPicking(false)} />
    </div>
  );
}

/** Liste des applis du téléphone, à cocher. */
/** Liste des applis lue une seule fois, dès l'arrivée sur l'écran Focus : le panneau s'ouvre déjà rempli. */
let appsLoad: Promise<App[]> | null = null;
const loadApps = () =>
  (appsLoad ??= isTauri
    ? native<{ apps: App[] }>("listApps").then((r) => r.apps).catch(() => ((appsLoad = null), []))
    : Promise.resolve([]));

function AppPicker({ open, selected, onClose }: { open: boolean; selected: string[]; onClose: () => void }) {
  const [apps, setApps] = useState<App[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(selected));

  useEffect(() => {
    void loadApps().then(setApps);
  }, []);

  useEffect(() => {
    if (open) setChosen(new Set(selected));
  }, [open]);

  const save = async () => {
    await setSetting("m_block_apps", JSON.stringify([...chosen]));
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title="Applis à bloquer" className="m-sheet-apps">
      <div className="m-app-list">
        {apps == null && <span className="muted small">Chargement…</span>}
        {apps?.length === 0 && <span className="muted small">Aucune appli trouvée.</span>}
        {apps?.map((a) => {
          const on = chosen.has(a.package);
          return (
            <button
              key={a.package}
              className={on ? "m-app on" : "m-app"}
              onClick={() => {
                const next = new Set(chosen);
                if (on) next.delete(a.package);
                else next.add(a.package);
                setChosen(next);
              }}
            >
              <span className="m-app-check">{on && <Check size={14} strokeWidth={3} />}</span>
              <span className="m-app-name">{a.label}</span>
            </button>
          );
        })}
      </div>
      <button className="m-start" onClick={save}>
        Enregistrer ({chosen.size})
      </button>
    </Sheet>
  );
}
