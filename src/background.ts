import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { pauseAll, setSetting } from "./db";
import { isLeader } from "./leader";
import { notify } from "./notify";
import { telegramNotify } from "./telegram";
import { DEFAULT_IDLE_MINUTES } from "./time";
import { aiConfig, requestInputFocus, startConversation, startTalking, stopTalking, voiceConfig } from "./ai/session";
import type { Data } from "./useData";

const isTauri = "__TAURI_INTERNALS__" in window;
const IDLE_CHECK_MS = 15_000;
/** Maintenir le raccourci plus longtemps que ça = parler ; plus court = écrire. */
const HOLD_TO_TALK_MS = 350;

function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Pause automatique : si un minuteur tourne et que personne ne touche au PC depuis X minutes,
 * on met tout en pause au moment de la dernière action. Une seule fenêtre (la première) s'en charge.
 */
export function useIdleAutoPause(data: Data) {
  const ref = useLatest(data);
  useEffect(() => {
    if (!isTauri) return;
    const id = setInterval(async () => {
      const { entries, settings } = ref.current;
      const minutes = Number(settings.idle_minutes ?? DEFAULT_IDLE_MINUTES);
      if (!minutes || !entries.some((e) => e.ended_at == null)) return;
      if (!(await isLeader())) return;
      const idle = await invoke<number>("idle_seconds");
      if (idle >= minutes * 60) {
        const lastActivity = new Date(Date.now() - idle * 1000);
        const paused = await pauseAll(lastActivity);
        if (paused.length) {
          await setSetting("auto_paused_projects", JSON.stringify(paused));
          await setSetting("auto_paused_at", lastActivity.toISOString());
        }
      }
    }, IDLE_CHECK_MS);
    return () => clearInterval(id);
  }, []);
}

/** Fin du compte à rebours (tuile « Minuteur ») : notification, une seule fois. */
export function useCountdownWatcher(data: Data) {
  const ref = useLatest(data);
  useEffect(() => {
    const id = setInterval(async () => {
      const end = ref.current.settings.countdown_end;
      if (!end || new Date(end).getTime() > Date.now() || !(await isLeader())) return;
      await setSetting("countdown_end", "");
      await notify("⏱ Minuteur terminé", "Le temps est écoulé.");
      await telegramNotify("reminders", "⏱ Minuteur terminé : le temps est écoulé.");
    }, 1000);
    return () => clearInterval(id);
  }, []);
}

/** Ctrl+Shift+Espace (envoyé par Rust) : appui court = écrire à l'IA, appui long = lui parler. */
export function useAssistantShortcut(data: Data, open: () => void) {
  const ref = useLatest({ data, open });
  useEffect(() => {
    if (!isTauri) return;
    let holdTimer: number | undefined;
    let down = false;
    let talking = false;
    const unlisten = getCurrentWebviewWindow().listen<boolean>("assistant-key", (e) => {
      const config = aiConfig(ref.current.data.settings);
      const voice = voiceConfig(ref.current.data.settings);
      if (e.payload) {
        if (down) return; // répétition clavier
        down = true;
        ref.current.open();
        if (config && voice) {
          holdTimer = window.setTimeout(() => {
            talking = true;
            startTalking(() => {
              talking = false;
              stopTalking(config, voice);
            });
          }, HOLD_TO_TALK_MS);
        }
      } else {
        down = false;
        window.clearTimeout(holdTimer);
        if (talking && config && voice) {
          talking = false;
          stopTalking(config, voice);
        } else {
          requestInputFocus();
        }
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

/**
 * « Hey Mégatron » : la fenêtre « première » allume ou coupe l'écoute côté Rust selon le réglage
 * (et note le résultat pour la fenêtre de réglages) ; chaque encoche réagit au mot d'éveil sur son écran.
 */
export function useWakeWord(data: Data, onWake: () => void) {
  const ref = useLatest({ data, onWake });
  const enabled = data.settings.wake_word === "1";

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    (async () => {
      if (!(await isLeader())) return;
      try {
        const language = await invoke<string>("wake_word_set", { enabled });
        if (!cancelled && enabled) await setSetting("wake_status", `ok:${language}`);
      } catch (e) {
        if (!cancelled) await setSetting("wake_status", `error:${String((e as Error)?.message ?? e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!isTauri) return;
    const unlisten = getCurrentWebviewWindow().listen("wake-word", () => ref.current.onWake());
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

/** Ce que fait l'encoche quand elle entend « Mégatron » : elle s'ouvre sur l'IA et lance la conversation. */
export function listenAfterWake(data: Data) {
  const config = aiConfig(data.settings);
  const voice = voiceConfig(data.settings);
  if (!config || !voice) {
    requestInputFocus();
    return;
  }
  // Conversation continue : il réécoute après chaque réponse, jusqu'à « merci, c'est bon ».
  void startConversation(config, voice, { greet: true });
}
