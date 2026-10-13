import { useEffect, useRef } from "react";
import { markReminderNotified, type Reminder, type ReminderRepeat } from "./db";
import { isLeader } from "./leader";
import { notify } from "./notify";
import type { Data } from "./useData";

const CHECK_MS = 5000;
export const SNOOZE_MINUTES = 10;

export const REPEAT_LABEL: Record<ReminderRepeat, string> = {
  none: "Une fois",
  daily: "Chaque jour",
  weekdays: "Jours ouvrés",
  weekly: "Chaque semaine",
  monthly: "Chaque mois",
};

/** Rappels arrivés à échéance et pas encore traités (Fait ou Plus tard), du plus ancien au plus récent. */
export const dueReminders = (reminders: Reminder[], now: Date) =>
  reminders.filter((r) => !r.done && new Date(r.due_at) <= now);

export function formatDue(iso: string, now: Date) {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const day = new Date(d);
  day.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return `Aujourd'hui ${time}`;
  if (diff === 1) return `Demain ${time}`;
  if (diff === -1) return `Hier ${time}`;
  return `${d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}

/** Envoie la notification Windows de chaque rappel échu, une seule fois (fenêtre « première » uniquement). */
export function useReminderWatcher(data: Data) {
  const ref = useRef(data);
  ref.current = data;
  useEffect(() => {
    let busy = false;
    const id = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const pending = dueReminders(ref.current.reminders, new Date()).filter((r) => r.notified_at !== r.due_at);
        if (!pending.length || !(await isLeader())) return;
        for (const r of pending) {
          await notify(`🔔 ${r.title}`, r.repeat === "none" ? "Rappel Mégatron" : `Rappel Mégatron · ${REPEAT_LABEL[r.repeat]}`);
          await markReminderNotified(r);
        }
      } catch (e) {
        console.error(e);
      } finally {
        busy = false;
      }
    }, CHECK_MS);
    return () => clearInterval(id);
  }, []);
}
