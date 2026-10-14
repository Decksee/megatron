import type { TimeEntry, Timer } from "./db";

export const NO_PROJECT_COLOR = "#8e8e93";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Le minuteur de ce projet tourne-t-il (session ouverte) ? */
export const isRunning = (entries: TimeEntry[], projectId: number | null) =>
  entries.some((e) => e.ended_at == null && e.project_id === projectId);

/** Temps cumulé du minuteur depuis son démarrage (pauses exclues). */
export const timerElapsed = (timer: Timer, entries: TimeEntry[], now: Date) =>
  entries
    .filter((e) => e.project_id === timer.project_id && e.started_at >= timer.created_at)
    .reduce((sum, e) => sum + entryMs(e, now), 0);

/** Durée de l'entrée comprise dans [from, to[ (une session à cheval sur minuit est coupée). */
export function overlapMs(e: TimeEntry, from: Date, to: Date, now: Date) {
  const start = Math.max(new Date(e.started_at).getTime(), from.getTime());
  const end = Math.min(e.ended_at ? new Date(e.ended_at).getTime() : now.getTime(), to.getTime());
  return Math.max(0, end - start);
}

/**
 * Temps réellement travaillé sur [from, to[ : les sessions simultanées (plusieurs projets en même temps)
 * ne sont comptées qu'une fois. La répartition par projet, elle, compte chaque projet en entier.
 */
export function totalMs(entries: TimeEntry[], from: Date, to: Date, now: Date) {
  const intervals = entries
    .map((e) => [
      Math.max(new Date(e.started_at).getTime(), from.getTime()),
      Math.min(e.ended_at ? new Date(e.ended_at).getTime() : now.getTime(), to.getTime()),
    ])
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curStart = -Infinity;
  let curEnd = -Infinity;
  for (const [a, b] of intervals) {
    if (a > curEnd) {
      if (curEnd > curStart) total += curEnd - curStart;
      curStart = a;
      curEnd = b;
    } else {
      curEnd = Math.max(curEnd, b);
    }
  }
  if (curEnd > curStart) total += curEnd - curStart;
  return total;
}

export const entryMs = (e: TimeEntry, now: Date) =>
  (e.ended_at ? new Date(e.ended_at).getTime() : now.getTime()) - new Date(e.started_at).getTime();

/** "3h12", "42 min", "0 min" */
export function formatDuration(ms: number) {
  const minutes = Math.floor(ms / MIN);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/** "1:02:03" ou "02:03" */
export function formatClock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export const hours = (ms: number) => ms / HOUR;




export function startOfDay(d: Date) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

export function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Lundi 00:00 de la semaine de d. */
export function startOfWeek(d: Date) {
  const r = startOfDay(d);
  return addDays(r, -((r.getDay() + 6) % 7));
}

export function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export type Period = "day" | "week" | "month";

/** Bornes de la période et découpage en barres (heures pour un jour, jours sinon). */
export function periodBuckets(period: Period, now: Date) {
  if (period === "day") {
    const from = startOfDay(now);
    const buckets = Array.from({ length: 24 }, (_, h) => {
      const start = new Date(from.getTime() + h * HOUR);
      return { start, end: new Date(start.getTime() + HOUR), label: `${h}h`, short: h % 3 === 0 ? `${h}h` : "" };
    });
    return { from, to: addDays(from, 1), buckets };
  }
  const from = period === "week" ? startOfWeek(now) : startOfMonth(now);
  const to = period === "week" ? addDays(from, 7) : new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const buckets = [];
  for (let d = from; d < to; d = addDays(d, 1)) {
    const weekday = d.toLocaleDateString("fr-FR", { weekday: "short" }).replace(".", "");
    buckets.push({
      start: d,
      end: addDays(d, 1),
      label: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" }),
      short: period === "week" ? weekday : d.getDate() % 5 === 1 ? String(d.getDate()) : "",
    });
  }
  return { from, to, buckets };
}

/** Minutes d'inactivité avant pause automatique du minuteur ("0" = désactivé). */
export const DEFAULT_IDLE_MINUTES = "5";
