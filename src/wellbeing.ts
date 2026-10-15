import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { listEntries, listFocusSessions, listProjects, listReminders, listSettings, listTasks, setSetting, type Settings } from "./db";
import { isLeader } from "./leader";
import { notify } from "./notify";
import { compose } from "./ai/session";
import { activeFocus } from "./focus";
import { formatDay, isOpen, taskBucket, toIsoDay } from "./projects";
import { formatDuration, startOfDay, totalMs } from "./time";
import type { Data } from "./useData";

const isTauri = "__TAURI_INTERNALS__" in window;
const CHECK_MS = 60_000;
/** Une absence (aucune action au clavier ou à la souris) d'au moins ce temps compte comme une pause. */
const BREAK_IDLE_S = 5 * 60;
/** Entre deux conseils de pause. */
const NUDGE_COOLDOWN_MS = 45 * 60_000;
/** Laisse les données se charger et le PC « s'installer » avant le point du matin. */
const STARTUP_DELAY_MS = 20_000;

export const BREAK_OPTIONS = [
  { value: "0", label: "Jamais" },
  { value: "60", label: "Après 1 h" },
  { value: "90", label: "Après 1 h 30" },
  { value: "120", label: "Après 2 h" },
];
export const breakAfterMinutes = (s: Settings) => Number(s.break_after ?? "90");
export const briefingOn = (s: Settings) => s.briefing !== "0";

const hhmm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

// ---------- Point du matin ----------

/** Ce qui est prévu aujourd'hui, en lignes de faits (pour l'IA ou pour le texte de secours). */
async function todayFacts(now: Date) {
  const [tasks, reminders, projects] = await Promise.all([listTasks(), listReminders(), listProjects()]);
  const today = toIsoDay(now);
  const todo = tasks.filter((t) => !t.done && taskBucket(t, now) === "today");
  const late = todo.filter((t) => t.due_date && t.due_date < today);
  const dayEnd = new Date(startOfDay(now).getTime() + 86_400_000);
  const rem = reminders
    .filter((r) => !r.done && new Date(r.due_at) >= now && new Date(r.due_at) < dayEnd)
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const soon = new Date(now.getTime() + 3 * 86_400_000);
  const deadlines = projects.filter((p) => isOpen(p) && p.deadline && p.deadline >= today && p.deadline <= toIsoDay(soon));
  return { todo, late, rem, deadlines };
}

function briefingFallback({ todo, late, rem, deadlines }: Awaited<ReturnType<typeof todayFacts>>) {
  const parts: string[] = [];
  if (todo.length) {
    const names = todo.slice(0, 3).map((t) => t.title).join(", ");
    parts.push(`${todo.length} tâche${todo.length > 1 ? "s" : ""} : ${names}${todo.length > 3 ? "…" : ""}`);
  }
  if (late.length) parts.push(`${late.length} en retard`);
  if (rem.length) parts.push(`${rem.length} rappel${rem.length > 1 ? "s" : ""} (${hhmm(new Date(rem[0].due_at))} ${rem[0].title})`);
  if (deadlines.length) parts.push(`deadline ${formatDay(deadlines[0].deadline!)} : ${deadlines[0].name}`);
  return parts.length ? parts.join(" · ") : "Rien de prévu aujourd'hui. Bonne journée !";
}

async function sendBriefing(settings: Settings, now: Date) {
  const facts = await todayFacts(now);
  const lines = [
    `Il est ${hhmm(now)}, ${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}.`,
    `Tâches du jour : ${facts.todo.map((t) => `${t.title}${t.due_date && t.due_date < toIsoDay(now) ? " (en retard)" : ""}`).join(" ; ") || "aucune"}.`,
    `Rappels aujourd'hui : ${facts.rem.map((r) => `${hhmm(new Date(r.due_at))} ${r.title}`).join(" ; ") || "aucun"}.`,
    `Deadlines de projets dans les 3 jours : ${facts.deadlines.map((p) => `${p.name} le ${p.deadline}`).join(" ; ") || "aucune"}.`,
  ];
  const text =
    (await compose(
      settings,
      `Écris le point du matin : ce que l'utilisateur doit faire aujourd'hui, en commençant par le plus important ` +
        `(retards, deadlines proches). Cite les éléments, pas de liste à puces. S'il n'y a rien, souhaite-lui une bonne journée.\n${lines.join("\n")}`,
    )) ?? briefingFallback(facts);
  await notify("☀️ Ta journée", text);
}

/**
 * Point du jour : une notification avec ce qui est prévu aujourd'hui, au premier moment de la journée
 * où l'utilisateur est devant son PC (démarrage du PC, de l'app, ou retour de veille un autre jour).
 */
export function useDailyBriefing() {
  useEffect(() => {
    if (!isTauri) return;
    const started = Date.now();
    const id = setInterval(async () => {
      if (Date.now() - started < STARTUP_DELAY_MS) return;
      const now = new Date();
      if (now.getHours() < 5) return;
      const settings = await listSettings();
      // Pas avant la visite guidée : l'utilisateur découvre l'app.
      if (!briefingOn(settings) || settings.onboarded !== "1" || settings.briefing_day === toIsoDay(now)) return;
      if (!(await isLeader())) return;
      if ((await invoke<number>("idle_seconds")) > 120) return; // personne devant l'écran
      await setSetting("briefing_day", toIsoDay(now)); // d'abord : jamais deux fois
      await sendBriefing(settings, now);
    }, 10_000);
    return () => clearInterval(id);
  }, []);
}

// ---------- Conseils de pause ----------

const BREAK_FALLBACKS = [
  "Ça fait {streak} que tu bosses sans t'arrêter. Lève-toi, bois un verre d'eau, 5 minutes : ton cerveau te dira merci.",
  "{streak} d'affilée, c'est du solide. Petite pause : étire-toi, regarde au loin, respire.",
  "Tu enchaînes depuis {streak}. Une pause de 5 minutes maintenant, et tu repars plus frais.",
];
const LATE_FALLBACK = "Il est {hour} et tu as déjà {today} au compteur. Pense à t'arrêter pour ce soir, la suite attendra demain.";

/**
 * Conseils de pause : Mégatron suit le temps passé devant le PC sans vraie pause (5 min sans activité).
 * Au-delà du seuil réglé (ou tard le soir), l'IA juge s'il faut te le dire et rédige le message.
 * Jamais pendant un focus : on ne coupe pas une session de concentration.
 */
export function useBreakNudge() {
  const streakStart = useRef(Date.now());
  const lastNudge = useRef(0);
  const nudgesToday = useRef({ day: "", count: 0 });

  useEffect(() => {
    if (!isTauri) return;
    const id = setInterval(async () => {
      if (!(await isLeader())) return;
      const idle = await invoke<number>("idle_seconds");
      const now = Date.now();
      if (idle >= BREAK_IDLE_S) {
        streakStart.current = now; // il a fait une pause
        return;
      }
      const settings = await listSettings();
      const threshold = breakAfterMinutes(settings);
      if (!threshold || now - lastNudge.current < NUDGE_COOLDOWN_MS) return;
      const streakMin = (now - streakStart.current) / 60_000;
      const date = new Date();
      const late = date.getHours() >= 23 && streakMin >= 30;
      if (streakMin < threshold && !late) return;
      if (activeFocus(await listFocusSessions())) return;

      const entries = await listEntries();
      const worked = totalMs(entries, startOfDay(date), date, date);
      const day = toIsoDay(date);
      if (nudgesToday.current.day !== day) nudgesToday.current = { day, count: 0 };
      lastNudge.current = now;

      const streak = formatDuration(streakMin * 60_000);
      const today = formatDuration(worked);
      const text =
        (await compose(
          settings,
          `Contexte : il est ${hhmm(date)}. L'utilisateur est actif sur son PC depuis ${streak} sans vraie pause` +
            `${worked > 0 ? ` et a chronométré ${today} de travail aujourd'hui` : ""}. ` +
            `C'est le conseil de pause n°${nudgesToday.current.count + 1} de la journée. ` +
            (late
              ? "Il est tard : encourage-le à s'arrêter pour ce soir."
              : "Juge s'il faut lui conseiller une petite pause (eau, s'étirer, marcher, regarder au loin) ; varie les idées, sans faire la morale."),
        )) ??
        (late ? LATE_FALLBACK : BREAK_FALLBACKS[nudgesToday.current.count % BREAK_FALLBACKS.length])
          .replace("{streak}", streak)
          .replace("{today}", today)
          .replace("{hour}", hhmm(date));
      nudgesToday.current.count++;
      await notify(late ? "🌙 Il se fait tard" : "☕ Petite pause ?", text);
    }, CHECK_MS);
    return () => clearInterval(id);
  }, []);
}

// ---------- Premier lancement ----------

/**
 * Premier lancement : Mégatron démarre avec Windows par défaut (une seule fois : si l'utilisateur
 * le coupe ensuite, on ne le réactive pas), puis la fenêtre s'ouvre sur la visite guidée.
 */
export function useFirstRun(data: Data) {
  const done = useRef(false);
  const loaded = Object.keys(data.settings).length > 0 || data.projects.length > 0;
  useEffect(() => {
    if (!isTauri || done.current) return;
    const timer = setTimeout(async () => {
      if (done.current || !(await isLeader())) return;
      done.current = true;
      const s = await listSettings();
      if (s.autostart_default !== "1") {
        await setSetting("autostart_default", "1");
        // En développement, on n'inscrit pas l'exécutable de test au démarrage de Windows.
        if (import.meta.env.PROD && !(await autostartEnabled().catch(() => true))) await enableAutostart().catch(console.error);
      }
      if (s.onboarded !== "1") {
        // Quelqu'un qui utilise déjà Mégatron (mise à jour) n'a pas besoin de la visite.
        const [projects, tasks, reminders] = await Promise.all([listProjects(), listTasks(), listReminders()]);
        if (projects.length || tasks.length || reminders.length) await setSetting("onboarded", "1");
        else await invoke("open_settings", { section: "welcome" }).catch(console.error);
      }
    }, 2_500);
    return () => clearTimeout(timer);
  }, [loaded]);
}
