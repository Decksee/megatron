import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { endFocus, saveFocusProgress, type FocusSession } from "./db";
import { isLeader } from "./leader";
import { notify } from "./notify";
import { nicknameNow, withName } from "./nickname";
import { telegramNotify } from "./telegram";
import type { Data } from "./useData";

/** Mots-clés cherchés dans le nom du programme ou le titre de la fenêtre (onglet du navigateur). */
export const DEFAULT_BLOCKLIST = [
  "youtube",
  "netflix",
  "twitch",
  "tiktok",
  "instagram",
  "facebook",
  "twitter",
  "x.com",
  "reddit",
  "discord",
  "steam",
  "prime video",
  "disney+",
];

export const FOCUS_DURATIONS = [25, 50, 90];
/** Durée maximale d'un focus : 12 h. */
export const FOCUS_MAX_MINUTES = 720;
/** Pas du réglage de durée : fin sous l'heure, plus large pour les longues sessions. */
export const focusStep = (minutes: number, up: boolean) => {
  const ref = up ? minutes : minutes - 1;
  return ref < 60 ? 5 : ref < 240 ? 15 : 30;
};
export const FOCUS_BUDGETS = [0, 2, 5, 10, 15];

const TICK_MS = 1000;
/** Clé du temps passé sans toucher au PC : il compte comme du repos dans le budget. */
export const IDLE_KEY = "repos";
/** Sans clavier ni souris pendant ce temps, on considère que tu fais une pause. */
const IDLE_AFTER_S = 60;
const SAVE_EVERY_TICKS = 5;
const STATUS_EVENT = "focus-status";

export interface FocusStatus {
  sessionId: number;
  /** Mot-clé de la distraction en cours, ou null si concentré. */
  distraction: string | null;
  distractionMs: number;
  /** Temps par distraction (pour le bilan). */
  byKey: Record<string, number>;
}

interface ForegroundWindow {
  hwnd: number;
  process: string;
  title: string;
}

export const activeFocus = (sessions: FocusSession[]) => sessions.find((s) => s.ended_at == null);

export function blocklist(settings: Data["settings"]): string[] {
  try {
    const list = JSON.parse(settings.focus_blocklist ?? "null");
    return Array.isArray(list) ? list : DEFAULT_BLOCKLIST;
  } catch {
    return DEFAULT_BLOCKLIST;
  }
}

function matchDistraction(fg: ForegroundWindow, list: string[]) {
  const process = fg.process.toLowerCase();
  if (process === "megatron.exe") return null;
  const haystack = `${process} ${fg.title.toLowerCase()}`;
  return list.find((k) => k.trim() && haystack.includes(k.trim().toLowerCase())) ?? null;
}

/** Temps de focus écoulé, sans les pauses. */
export const focusElapsedMs = (s: FocusSession, now: Date) => {
  const end = s.paused_at ? new Date(s.paused_at).getTime() : now.getTime();
  return Math.max(0, end - new Date(s.started_at).getTime() - (s.paused_ms ?? 0));
};

/**
 * Surveille la fenêtre au premier plan pendant une session de focus.
 * Une seule fenêtre (la « première ») mesure et enregistre ; elle diffuse l'état à tous les écrans.
 */
export function useFocusMonitor(data: Data) {
  const ref = useRef(data);
  ref.current = data;
  const [status, setStatus] = useState<FocusStatus | null>(null);

  useEffect(() => {
    const unlisten = listen<FocusStatus | null>(STATUS_EVENT, (e) => setStatus(e.payload));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    let tracked: { id: number; ms: number; byKey: Record<string, number>; warned: boolean; ticks: number } | null = null;
    let busy = false;

    const id = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const session = activeFocus(ref.current.focusSessions);
        if (!session) {
          if (tracked) {
            tracked = null;
            await emit(STATUS_EVENT, null);
          }
          return;
        }
        if (!(await isLeader())) return;

        if (tracked?.id !== session.id) {
          tracked = {
            id: session.id,
            ms: session.distraction_ms,
            byKey: JSON.parse(session.distractions || "{}"),
            warned: session.distraction_ms > session.budget_minutes * 60_000,
            ticks: 0,
          };
        }
        const t = tracked;

        const now = new Date();
        if (focusElapsedMs(session, now) >= session.planned_minutes * 60_000) {
          await saveFocusProgress(session.id, t.ms, t.byKey);
          await endFocus(session, true);
          await notify("Session de focus terminée 🎯", `${withName("Bravo", await nicknameNow())} ! Prends une petite pause.`);
          await telegramNotify("focus", "🎯 Session de focus terminée. Bravo ! Prends une petite pause.");
          return;
        }

        // En pause : rien n'est compté, on garde juste l'état à jour.
        if (session.paused_at) {
          await emit(STATUS_EVENT, { sessionId: session.id, distraction: null, distractionMs: t.ms, byKey: t.byKey } satisfies FocusStatus);
          return;
        }

        const fg = await invoke<ForegroundWindow | null>("foreground_window");
        const idle = (await invoke<number>("idle_seconds").catch(() => 0)) >= IDLE_AFTER_S;
        const distraction = idle ? IDLE_KEY : fg ? matchDistraction(fg, blocklist(ref.current.settings)) : null;
        if (distraction) {
          t.ms += TICK_MS;
          t.byKey[distraction] = (t.byKey[distraction] ?? 0) + TICK_MS;
          const over = t.ms > session.budget_minutes * 60_000;
          if (over && session.mode === "block" && fg && distraction !== IDLE_KEY) {
            await invoke("minimize_window", { hwnd: fg.hwnd });
          }
          if (over && !t.warned) {
            t.warned = true;
            const name = await nicknameNow();
            await notify(
              distraction === IDLE_KEY ? "Temps de repos écoulé" : "Budget de distraction dépassé",
              distraction === IDLE_KEY
                ? `Ta pause est finie : on s'y remet${name ? `, ${name}` : ""} !`
                : session.mode === "block"
                  ? `${distraction} est bloqué jusqu'à la fin de la session.`
                  : `Retour au boulot ! (${distraction})`,
            );
            await telegramNotify(
              "focus",
              distraction === IDLE_KEY ? "☕ Ton temps de repos est écoulé : on s'y remet !" : `⚠️ Budget de distraction dépassé (${distraction}).`,
            );
          }
        }

        t.ticks++;
        if (t.ticks % SAVE_EVERY_TICKS === 0) await saveFocusProgress(session.id, t.ms, t.byKey);
        await emit(STATUS_EVENT, {
          sessionId: session.id,
          distraction,
          distractionMs: t.ms,
          byKey: t.byKey,
        } satisfies FocusStatus);
      } catch (e) {
        console.error(e);
      } finally {
        busy = false;
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const session = activeFocus(data.focusSessions);
  if (!session) return null;
  // Avant le premier relevé, on part de la valeur enregistrée.
  return status?.sessionId === session.id
    ? status
    : {
        sessionId: session.id,
        distraction: null,
        distractionMs: session.distraction_ms,
        byKey: JSON.parse(session.distractions || "{}") as Record<string, number>,
      };
}
