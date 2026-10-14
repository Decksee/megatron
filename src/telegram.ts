import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  completeReminder,
  listEntries,
  listExtras,
  listFocusSessions,
  listPayments,
  listProjects,
  listReminders,
  listTasks,
  setSetting,
  snoozeReminder,
  type Settings,
} from "./db";
import { isLeader } from "./leader";
import { aiConfig, ask, transcribe, voiceConfig, waitIdle } from "./ai/session";
import { activeFocus, focusElapsedMs } from "./focus";
import { addDays, entryMs, formatClock, formatDuration, startOfDay, startOfWeek, totalMs } from "./time";
import { awaitingPayment, formatMoney, moneyTotals, projectMoney, toIsoDay, usageProfile } from "./projects";
import { formatDue, SNOOZE_MINUTES } from "./reminders";
import type { Data } from "./useData";
import type { Attachment } from "./ai/attachments";

/**
 * Le bot Telegram de l'utilisateur : notifications sur le téléphone, et discussion avec Mégatron
 * (texte ou vocal). Tout passe par la fenêtre « première », tant que le PC est allumé.
 * Le bot n'obéit qu'au compte Telegram relié avec le code d'appairage.
 */

export const TG_SLOT = "telegram";

/** Les notifications qu'on peut recevoir sur le téléphone (toutes activées par défaut). */
export type TgKind = "reminders" | "focus" | "timer" | "payments";
export const TG_KINDS: { kind: TgKind; label: string; hint: string }[] = [
  { kind: "reminders", label: "Rappels", hint: "Avec les boutons Fait et Plus tard." },
  { kind: "focus", label: "Focus", hint: "Fin de session et temps de repos dépassé." },
  { kind: "timer", label: "Minuteur oublié", hint: "Quand un minuteur tourne depuis plus de 4 h." },
  { kind: "payments", label: "Paiements en attente", hint: "Le lundi matin, les projets pas encore payés." },
];

const FORGOTTEN_TIMER_MS = 4 * 3_600_000;

interface TgUser {
  id: number;
  first_name?: string;
  username?: string;
}
interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  voice?: { file_id: string; duration: number };
  audio?: { file_id: string; duration: number };
  /** Document envoyé (PDF, Word, texte…). */
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
  /** Photo (plusieurs tailles, la dernière est la plus grande). */
  photo?: { file_id: string; file_size?: number; width: number; height: number }[];
  /** Légende d'une photo ou d'un document. */
  caption?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}
type Buttons = { text: string; data: string }[][];

export const tg = <T = unknown>(method: string, params: object = {}) =>
  invoke<T>("telegram_call", { method, params });

/** Paramètres de la fenêtre « première » (gardés à jour par useTelegram). */
let current: Settings = {};

export const telegramLinked = (s: Settings) => !!s.tg_bot && !!s.tg_chat_id;
export const tgKindOn = (s: Settings, kind: TgKind) =>
  s[`tg_n_${kind}`] !== "0" && (kind !== "payments" || usageProfile(s).money);
/** Notifications proposées pour ce type d'usage (pas de paiements sans argent en jeu). */
export const tgKindsFor = (s: Settings) => TG_KINDS.filter((k) => k.kind !== "payments" || usageProfile(s).money);
export const tgChatOn = (s: Settings) => s.tg_chat !== "0";

/** Envoie un message sur le téléphone, avec des boutons éventuels. */
export async function sendTelegram(text: string, buttons?: Buttons, settings: Settings = current) {
  if (!telegramLinked(settings)) return;
  await tg("sendMessage", {
    chat_id: Number(settings.tg_chat_id),
    text,
    ...(buttons && {
      reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) },
    }),
  });
}

/** Notification sur le téléphone, si ce type est activé. N'échoue jamais. */
export async function telegramNotify(kind: TgKind, text: string, buttons?: Buttons) {
  if (!telegramLinked(current) || !tgKindOn(current, kind)) return;
  await sendTelegram(text, buttons).catch(console.error);
}

export const reminderButtons = (id: number): Buttons => [
  [
    { text: "✓ Fait", data: `r:d:${id}` },
    { text: `⏰ +${SNOOZE_MINUTES} min`, data: `r:s:${id}` },
  ],
];

/** Code à envoyer au bot (/start CODE) pour le relier à ce compte. */
export function newPairCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

// ---------- Commandes rapides ----------

const HELP = `Je suis Mégatron 🤖
Écris-moi, envoie un vocal, une photo ou un document, comme dans l'encoche : « ajoute relancer le client pour demain », « crée le projet à partir de ce brief »…

Commandes rapides :
/taches — tes tâches à faire
/temps — ton temps de travail
/focus — ta session de focus
/rappels — tes prochains rappels`;

async function commandTasks() {
  const [tasks, projects] = await Promise.all([listTasks(), listProjects()]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const pending = tasks.filter((t) => !t.done);
  if (!pending.length) return "✅ Rien à faire, tout est fait !";
  const lines = pending.slice(0, 25).map((t) => {
    const project = t.project_id != null ? ` · ${names.get(t.project_id)}` : "";
    const due = t.due_date ? ` · ${t.due_date === toIsoDay(new Date()) ? "aujourd'hui" : t.due_date}` : "";
    return `• ${t.title}${project}${due}`;
  });
  return `📝 ${pending.length} tâche${pending.length > 1 ? "s" : ""} à faire\n${lines.join("\n")}${pending.length > 25 ? "\n…" : ""}`;
}

async function commandTime() {
  const [entries, projects] = await Promise.all([listEntries(), listProjects()]);
  const now = new Date();
  const today = totalMs(entries, startOfDay(now), addDays(startOfDay(now), 1), now);
  const week = totalMs(entries, startOfWeek(now), addDays(startOfWeek(now), 7), now);
  const running = entries.filter((e) => !e.ended_at);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const live = running.length
    ? `\n▶️ En cours : ${running.map((e) => `${e.project_id != null ? names.get(e.project_id) : "sans projet"} (${formatDuration(entryMs(e, now))})`).join(", ")}`
    : "";
  return `⏱ Aujourd'hui : ${formatDuration(today)}\n📅 Cette semaine : ${formatDuration(week)}${live}`;
}

async function commandFocus() {
  const session = activeFocus(await listFocusSessions());
  if (!session) return "🎯 Aucune session de focus en cours.";
  if (session.paused_at) {
    const left = session.planned_minutes * 60_000 - focusElapsedMs(session, new Date());
    return `⏸ Focus en pause : ${formatClock(Math.max(0, left))} restantes à la reprise.`;
  }
  const left = session.planned_minutes * 60_000 - focusElapsedMs(session, new Date());
  const rest = Math.max(0, session.budget_minutes * 60_000 - session.distraction_ms);
  return `🎯 Focus en cours : ${formatClock(Math.max(0, left))} restantes\nRepos disponible : ${formatClock(rest)}`;
}

async function commandReminders() {
  const now = new Date();
  const next = (await listReminders()).filter((r) => !r.done).slice(0, 10);
  if (!next.length) return "🔔 Aucun rappel prévu.";
  return `🔔 Prochains rappels\n${next.map((r) => `• ${r.title} · ${formatDue(r.due_at, now)}`).join("\n")}`;
}

const COMMANDS: Record<string, () => Promise<string>> = {
  "/taches": commandTasks,
  "/tâches": commandTasks,
  "/temps": commandTime,
  "/focus": commandFocus,
  "/rappels": commandReminders,
  "/aide": async () => HELP,
  "/help": async () => HELP,
  "/start": async () => HELP,
};

// ---------- Discussion avec l'IA ----------

/** Affiche « en train d'écrire… » dans Telegram tant que la réponse n'est pas prête. */
function typing(chatId: number) {
  const send = () => tg("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  void send();
  const id = window.setInterval(send, 4500);
  return () => window.clearInterval(id);
}

async function askFromPhone(chatId: number, text: string, settings: Settings, files: Attachment[] = []) {
  const config = aiConfig(settings);
  if (!config) return "L'IA n'est pas encore configurée dans Mégatron (onglet IA).";
  const stop = typing(chatId);
  try {
    if (!(await waitIdle())) return "Je suis occupé sur le PC, réessaie dans un instant.";
    const res = await ask(text, config, undefined, false, { silent: true, badge: "📱", files });
    // Les simples lectures (« 3 tâche(s) consultée(s) ») n'apportent rien sur le téléphone.
    const actions = res.actions.filter((a) => !/consulté/i.test(a));
    const lines = [...actions.map((a) => `✓ ${a}`), res.reply || res.error || ""].filter(Boolean);
    return lines.join("\n") || "C'est fait.";
  } finally {
    stop();
  }
}

async function handleMessage(msg: TgMessage, settings: Settings) {
  const chatId = msg.chat.id;
  const text = (msg.text ?? msg.caption ?? "").trim();

  // Pas encore relié : seul « /start CODE » (le lien affiché dans les réglages) est accepté.
  if (!settings.tg_chat_id) {
    const code = text.match(/^\/start\s+(\S+)/)?.[1];
    if (msg.chat.type === "private" && code && settings.tg_pair_code && code === settings.tg_pair_code) {
      await setSetting("tg_chat_id", String(chatId));
      await setSetting("tg_user", msg.from?.first_name ?? msg.from?.username ?? "");
      await setSetting("tg_pair_code", "");
      await sendTelegram(`✅ C'est relié ! Tu recevras tes notifications ici.\n\n${HELP}`, undefined, {
        ...settings,
        tg_chat_id: String(chatId),
      });
    }
    return;
  }
  // Le bot n'obéit qu'au compte relié.
  if (String(chatId) !== settings.tg_chat_id) return;

  const command = text.split(/[\s@]/)[0].toLowerCase();
  if (command.startsWith("/")) {
    const run = COMMANDS[command];
    await sendTelegram(run ? await run() : `Commande inconnue.\n\n${HELP}`, undefined, settings);
    return;
  }

  if (!tgChatOn(settings)) {
    await sendTelegram("La discussion depuis Telegram est désactivée dans les réglages de Mégatron.", undefined, settings);
    return;
  }

  let question = text;

  // Photo ou document : récupéré, lu comme dans la discussion, puis envoyé avec la légende.
  const files: Attachment[] = [];
  const doc = msg.document;
  const photo = msg.photo?.[msg.photo.length - 1];
  if (doc || photo) {
    const stop = typing(chatId);
    try {
      if ((doc?.file_size ?? photo?.file_size ?? 0) > 20 * 1024 * 1024) throw new Error("Le fichier dépasse 20 Mo.");
      const data = await invoke<string>("telegram_file", { fileId: (doc ?? photo)!.file_id });
      const name = doc?.file_name || (photo ? "photo.jpg" : "fichier");
      files.push(await invoke<Attachment>("parse_attachment", { name, dataBase64: data }));
    } catch (e) {
      await sendTelegram(`Je n'ai pas pu lire ton fichier : ${String((e as Error)?.message ?? e).slice(0, 160)}`, undefined, settings);
      return;
    } finally {
      stop();
    }
    if (!question) question = photo ? "Regarde cette image." : "Regarde ce fichier.";
  }

  const audio = msg.voice ?? msg.audio;
  if (audio) {
    const voice = voiceConfig(settings);
    if (!voice) {
      await sendTelegram("Pour les messages vocaux, ajoute une clé pour la voix dans les réglages de l'IA.", undefined, settings);
      return;
    }
    const stop = typing(chatId);
    try {
      const data = await invoke<string>("telegram_file", { fileId: audio.file_id });
      question = (await transcribe(voice, data, "audio/ogg")).trim();
    } catch (e) {
      await sendTelegram(`Je n'ai pas pu écouter ton message (${String((e as Error)?.message ?? e).slice(0, 120)}).`, undefined, settings);
      return;
    } finally {
      stop();
    }
    if (!question) {
      await sendTelegram("Je n'ai rien entendu dans ton message vocal.", undefined, settings);
      return;
    }
  }
  if (!question) return;
  await sendTelegram(await askFromPhone(chatId, question, settings, files), undefined, settings);
}

async function handleCallback(cb: NonNullable<TgUpdate["callback_query"]>, settings: Settings) {
  if (!settings.tg_chat_id || String(cb.from.id) !== settings.tg_chat_id) return;
  const [kind, action, rawId] = (cb.data ?? "").split(":");
  let answer = "";
  if (kind === "r") {
    const reminder = (await listReminders()).find((r) => r.id === Number(rawId));
    if (!reminder) answer = "Ce rappel n'existe plus.";
    else if (action === "d") {
      await completeReminder(reminder);
      answer = "✓ Fait";
    } else if (action === "s") {
      await snoozeReminder(reminder, SNOOZE_MINUTES);
      answer = `⏰ Reporté de ${SNOOZE_MINUTES} min`;
    }
  }
  await tg("answerCallbackQuery", { callback_query_id: cb.id, text: answer }).catch(() => {});
  if (answer && cb.message?.text) {
    await tg("editMessageText", {
      chat_id: cb.message.chat.id,
      message_id: cb.message.message_id,
      text: `${cb.message.text}\n${answer}`,
    }).catch(() => {});
  }
}

// ---------- Résumés et vérifications de fond ----------

async function dailySummary(settings: Settings) {
  const [entries, tasks, reminders, projects] = await Promise.all([listEntries(), listTasks(), listReminders(), listProjects()]);
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const worked = totalMs(entries, today, tomorrow, now);

  const byProject = new Map<number | null, number>();
  for (const e of entries) {
    const end = e.ended_at ? new Date(e.ended_at) : now;
    const from = Math.max(new Date(e.started_at).getTime(), today.getTime());
    const ms = Math.min(end.getTime(), tomorrow.getTime()) - from;
    if (ms > 0) byProject.set(e.project_id, (byProject.get(e.project_id) ?? 0) + ms);
  }
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const detail = [...byProject.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, ms]) => `${id != null ? names.get(id) : "sans projet"} ${formatDuration(ms)}`)
    .join(", ");

  const doneToday = tasks.filter((t) => t.done && t.completed_at && new Date(t.completed_at + "Z") >= today).length;
  const tomorrowIso = toIsoDay(tomorrow);
  const dueTomorrow = tasks.filter((t) => !t.done && t.due_date === tomorrowIso);
  const late = tasks.filter((t) => !t.done && t.due_date && t.due_date < toIsoDay(now));
  const remindersTomorrow = reminders.filter((r) => {
    const d = new Date(r.due_at);
    return !r.done && d >= tomorrow && d < addDays(tomorrow, 1);
  });
  const pending = moneyTotals(projects, await ledger()).pending;

  const lines = [
    "🌙 Ta journée",
    `⏱ ${formatDuration(worked)} de travail${detail ? ` (${detail})` : ""}`,
    `✅ ${doneToday} tâche${doneToday > 1 ? "s" : ""} faite${doneToday > 1 ? "s" : ""}`,
  ];
  if (late.length) lines.push(`⚠️ ${late.length} tâche${late.length > 1 ? "s" : ""} en retard`);
  if (dueTomorrow.length || remindersTomorrow.length) {
    lines.push("", "📅 Demain");
    for (const t of dueTomorrow.slice(0, 8)) lines.push(`• ${t.title}`);
    for (const r of remindersTomorrow.slice(0, 5)) lines.push(`• 🔔 ${r.title} · ${formatDue(r.due_at, now).replace("Demain ", "")}`);
  }
  if (Object.keys(pending).length && usageProfile(settings).money) {
    lines.push("", `💶 À encaisser : ${Object.entries(pending).map(([c, v]) => formatMoney(v, c)).join(" + ")}`);
  }
  return lines.join("\n");
}

async function ledger() {
  const [extras, payments] = await Promise.all([listExtras(), listPayments()]);
  return { extras, payments };
}

async function paymentsDigest() {
  const l = await ledger();
  const unpaid = awaitingPayment(await listProjects(), l);
  if (!unpaid.length) return null;
  return `💶 ${unpaid.length} projet${unpaid.length > 1 ? "s" : ""} en attente de paiement\n${unpaid
    .map((p) => {
      const m = projectMoney(p, l);
      return `• ${p.name}${p.client ? ` (${p.client})` : ""} · reste ${formatMoney(m.remaining, p.currency)}${
        m.paid > 0 ? ` sur ${formatMoney(m.total, p.currency)}` : ""
      }`;
    })
    .join("\n")}\n\nPense à relancer ! Note chaque paiement reçu dans Mégatron (ou dis-le-moi ici).`;
}

/** Semaine ISO « 2026-W42 » (une relance de paiements par semaine). */
const weekKey = (d: Date) => toIsoDay(startOfWeek(d));

async function backgroundChecks(settings: Settings) {
  const now = new Date();
  const todayIso = toIsoDay(now);
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  // Résumé du soir, une fois par jour à l'heure choisie (ou dès que possible si le PC était éteint).
  if (settings.tg_summary === "1" && settings.tg_summary_day !== todayIso && hhmm >= (settings.tg_summary_time || "19:00")) {
    await setSetting("tg_summary_day", todayIso);
    await sendTelegram(await dailySummary(settings), undefined, settings);
  }

  // Paiements en attente : le lundi à partir de 10 h, une fois par semaine.
  if (tgKindOn(settings, "payments") && now.getDay() === 1 && now.getHours() >= 10 && settings.tg_payments_week !== weekKey(now)) {
    await setSetting("tg_payments_week", weekKey(now));
    const digest = await paymentsDigest();
    if (digest) await sendTelegram(digest, undefined, settings);
  }

  // Minuteur oublié : une seule alerte par session.
  if (tgKindOn(settings, "timer")) {
    const warned = new Set((settings.tg_timer_warned ?? "").split(",").filter(Boolean));
    const forgotten = (await listEntries()).filter(
      (e) => !e.ended_at && now.getTime() - new Date(e.started_at).getTime() > FORGOTTEN_TIMER_MS && !warned.has(String(e.id)),
    );
    if (forgotten.length) {
      const names = new Map((await listProjects()).map((p) => [p.id, p.name]));
      for (const e of forgotten) {
        warned.add(String(e.id));
        await sendTelegram(
          `⏱ Le minuteur « ${e.project_id != null ? names.get(e.project_id) : "sans projet"} » tourne depuis ${formatDuration(
            entryMs(e, now),
          )}. Tu bosses encore dessus ?`,
          undefined,
          settings,
        );
      }
      await setSetting("tg_timer_warned", [...warned].slice(-30).join(","));
    }
  }
}

// ---------- Boucle d'écoute ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** En développement, ce fichier peut être rechargé à chaud : l'ancienne boucle d'écoute doit s'arrêter. */
let moduleAlive = true;
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    moduleAlive = false;
  });
  // Les fenêtres doivent relancer l'écoute avec le nouveau code.
  import.meta.hot.accept(() => location.reload());
}

/**
 * Écoute le bot (fenêtre « première » seulement) : appairage, messages, boutons des rappels,
 * puis résumés et alertes de fond chaque minute.
 */
export function useTelegram(data: Data) {
  const ref = useRef(data.settings);
  ref.current = data.settings;
  current = data.settings;
  const bot = data.settings.tg_bot;

  useEffect(() => {
    if (!bot || !("__TAURI_INTERNALS__" in window)) return;
    let stopped = false;
    (async () => {
      if (!(await isLeader())) return;
      await tg("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
      let offset = Number(ref.current.tg_offset) || 0;
      while (!stopped && moduleAlive) {
        try {
          const updates = await tg<TgUpdate[]>("getUpdates", {
            offset,
            timeout: 25,
            allowed_updates: ["message", "callback_query"],
          });
          if (stopped || !moduleAlive) break;
          for (const u of updates) {
            offset = u.update_id + 1;
            try {
              if (u.message) await handleMessage(u.message, ref.current);
              else if (u.callback_query) await handleCallback(u.callback_query, ref.current);
            } catch (e) {
              console.error(e);
            }
          }
          if (updates.length) await setSetting("tg_offset", String(offset));
        } catch (e) {
          console.error(e);
          await sleep(5000); // pas de réseau, ou clé changée : on réessaie plus tard
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [bot]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let busy = false;
    const id = window.setInterval(async () => {
      if (busy || !telegramLinked(ref.current)) return;
      busy = true;
      try {
        if (await isLeader()) await backgroundChecks(ref.current);
      } catch (e) {
        console.error(e);
      } finally {
        busy = false;
      }
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
}

/** Pour le réglage « Résumé du soir ». */
export const SUMMARY_TIMES = ["17:00", "18:00", "19:00", "20:00", "21:00", "22:00"];
