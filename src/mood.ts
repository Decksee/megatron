import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { FocusStatus } from "./focus";
import type { Reminder } from "./db";
import { isRunning } from "./time";
import type { Data } from "./useData";

export type Mood =
  | "idle"
  | "work"
  | "paused"
  | "focus"
  | "suspicious"
  | "angry"
  | "happy"
  | "sleep"
  | "alert"
  | "listen"
  | "think"
  | "timer";

const isTauri = "__TAURI_INTERNALS__" in window;
/** Il s'endort après ce temps sans clavier ni souris. */
const SLEEP_AFTER_S = 5 * 60;
const IDLE_POLL_MS = 3000;
const HAPPY_MS = 2600;

/** Humeur de la mascotte, déduite de ce qui se passe dans l'app. */
export function useMood(
  data: Data,
  focus: FocusStatus | null,
  due: Reminder[],
  assistant: { listening: boolean; thinking: boolean },
): Mood {
  const [idleS, setIdleS] = useState(0);
  const [happyUntil, setHappyUntil] = useState(0);
  const prev = useRef<{ doneTasks: number; completedFocus: number } | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    const poll = () => invoke<number>("idle_seconds").then(setIdleS).catch(() => {});
    poll();
    const id = setInterval(poll, IDLE_POLL_MS);
    return () => clearInterval(id);
  }, []);

  // Petite fête quand une tâche est cochée ou qu'une session de focus se termine.
  const doneTasks = data.tasks.filter((t) => t.done).length;
  const completedFocus = data.focusSessions.filter((s) => s.completed).length;
  useEffect(() => {
    const p = prev.current;
    if (p && (doneTasks > p.doneTasks || completedFocus > p.completedFocus)) setHappyUntil(Date.now() + HAPPY_MS);
    prev.current = { doneTasks, completedFocus };
  }, [doneTasks, completedFocus]);

  const [, force] = useState(0);
  useEffect(() => {
    if (happyUntil <= Date.now()) return;
    const t = setTimeout(() => force((n) => n + 1), happyUntil - Date.now());
    return () => clearTimeout(t);
  }, [happyUntil]);

  if (assistant.listening) return "listen";
  if (assistant.thinking) return "think";
  if (due.length) return "alert";
  const focusSession = focus && data.focusSessions.find((s) => s.id === focus.sessionId);
  if (focusSession && focus.distraction) {
    return focus.distractionMs > focusSession.budget_minutes * 60_000 ? "angry" : "suspicious";
  }
  if (happyUntil > Date.now()) return "happy";
  if (idleS >= SLEEP_AFTER_S) return "sleep";
  if (focusSession) return "focus";
  const countdown = data.settings.countdown_end;
  if (countdown && new Date(countdown).getTime() > Date.now()) return "timer";
  if (data.timers.some((t) => isRunning(data.entries, t.project_id))) return "work";
  if (data.timers.length) return "paused";
  return "idle";
}

/** Position de la souris près de l'encoche (envoyée par Rust), pour que la mascotte la suive des yeux. */
export function useNotchCursor() {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!isTauri) {
      const onMove = (e: MouseEvent) => setCursor({ x: e.clientX, y: e.clientY });
      window.addEventListener("mousemove", onMove);
      return () => window.removeEventListener("mousemove", onMove);
    }
    const unlisten = getCurrentWebviewWindow().listen<[number, number] | null>("notch-cursor", (e) =>
      setCursor(e.payload ? { x: e.payload[0], y: e.payload[1] } : null),
    );
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
  return cursor;
}

/** Une fenêtre (navigateur, éditeur…) est-elle derrière l'encoche ? (détecté par Rust) */
export function useNotchOccupied() {
  const [occupied, setOccupied] = useState(false);
  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWebviewWindow().listen<boolean>("notch-occupied", (e) => setOccupied(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
  return occupied;
}
