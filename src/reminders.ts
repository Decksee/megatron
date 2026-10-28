import { useEffect, useRef } from "react";
import { catchUpReminder, markReminderNotified, ruleOf, type Reminder, type ReminderRepeat } from "./db";
import { isLeader } from "./leader";
import { notify } from "./notify";
import { nicknameNow } from "./nickname";
import { reminderButtons, telegramNotify } from "./telegram";
import type { Data } from "./useData";

const CHECK_MS = 5000;
export const SNOOZE_MINUTES = 10;

export const REPEAT_LABEL: Record<ReminderRepeat, string> = {
  none: "Ce jour-là seulement",
  daily: "Chaque jour",
  weekdays: "Jours ouvrés",
  days: "Certains jours",
  weekly: "Chaque semaine",
  monthly: "Chaque mois",
};

/** Jours dans l'ordre français (lundi d'abord), avec leur numéro JavaScript (0 = dimanche). */
export const WEEK = [
  { day: 1, short: "L", label: "Lun" },
  { day: 2, short: "M", label: "Mar" },
  { day: 3, short: "M", label: "Mer" },
  { day: 4, short: "J", label: "Jeu" },
  { day: 5, short: "V", label: "Ven" },
  { day: 6, short: "S", label: "Sam" },
  { day: 0, short: "D", label: "Dim" },
];

export const EVERY_OPTIONS = [
  { value: 0, label: "Une seule fois" },
  { value: 15, label: "Chaque 15 min" },
  { value: 30, label: "Chaque 30 min" },
  { value: 60, label: "Chaque heure" },
  { value: 120, label: "Chaque 2 h" },
  { value: 180, label: "Chaque 3 h" },
];

const everyLabel = (min: number) =>
  min % 60 === 0 ? (min === 60 ? "toutes les heures" : `toutes les ${min / 60} h`) : `toutes les ${min} min`;

/** « Lun, Sam · toutes les heures jusqu'à 18 h » ; vide pour un rappel unique. */
export function ruleLabel(r: Reminder) {
  const rule = ruleOf(r);
  const days =
    rule.repeat === "days"
      ? WEEK.filter((w) => rule.days.includes(w.day)).map((w) => w.label).join(", ")
      : rule.repeat === "none"
        ? ""
        : REPEAT_LABEL[rule.repeat];
  const within = rule.everyMin
    ? `${everyLabel(rule.everyMin)}${rule.until ? ` jusqu'à ${rule.until.replace(":00", " h").replace(":", " h ")}` : ""}`
    : "";
  const text = [days, within].filter(Boolean).join(" · ");
  return text ? text[0].toUpperCase() + text.slice(1) : "";
}

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
        const now = new Date();
        // Répété dans la journée sans « Fait » : au créneau suivant, il sonne de nouveau.
        if (ref.current.reminders.some((r) => r.every_min && r.notified_at === r.due_at) && (await isLeader())) {
          for (const r of ref.current.reminders) await catchUpReminder(r, now);
        }
        const pending = dueReminders(ref.current.reminders, now).filter((r) => r.notified_at !== r.due_at);
        if (!pending.length || !(await isLeader())) return;
        for (const r of pending) {
          const name = await nicknameNow();
          const label = name ? `Rappel pour ${name}` : "Rappel Mégatron";
          const rule = ruleLabel(r);
          await notify(`🔔 ${r.title}`, rule ? `${label} · ${rule}` : label);
          await telegramNotify("reminders", `🔔 ${r.title}`, reminderButtons(r.id));
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
