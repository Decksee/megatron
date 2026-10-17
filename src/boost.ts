import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listEntries, listFocusSessions, listSettings, listTasks, setSetting, type Settings, type Task } from "./db";
import { isLeader } from "./leader";
import { notify } from "./notify";
import { compose } from "./ai/session";
import { activeFocus } from "./focus";
import { isTaskLate, toIsoDay } from "./projects";
import { formatDuration, startOfDay, totalMs } from "./time";

/**
 * Boost : Mégatron coache et motive.
 * - Coach : retards à répétition, ou plus rien de planifié depuis longtemps → conseils, puis suivi des progrès.
 * - Motivation : longue journée de travail ou belle série de tâches faites → un message qui donne de l'élan,
 *   avec parfois l'exemple de quelqu'un qui a beaucoup progressé.
 * Discret : au plus 2 messages par jour, en journée, quand l'utilisateur est devant son PC, jamais pendant un focus.
 */

const isTauri = "__TAURI_INTERNALS__" in window;
const CHECK_MS = 5 * 60_000;
const STARTUP_DELAY_MS = 2 * 60_000;
const DAY_MS = 86_400_000;
const MAX_PER_DAY = 2;
/** Retards (en cours + rattrapés trop tard sur 14 jours) à partir desquels le coach intervient. */
const LATE_THRESHOLD = 3;
/** Jours sans nouvelle tâche (et sans rien de prévu) avant de relancer. */
const EMPTY_DAYS = 3;
/** Temps chronométré dans la journée qui mérite un encouragement. */
const LONG_DAY_MS = 3 * 3_600_000;
/** Tâches cochées dans la journée qui font une belle série. */
const STREAK_TASKS = 4;

export const boostOn = (s: Settings) => s.boost !== "0";

const sqlDate = (sql: string) => new Date(sql.replace(" ", "T") + "Z");
const daysSince = (iso: string | undefined, now: number) => (iso ? (now - new Date(iso).getTime()) / DAY_MS : Infinity);

/** Retards : tâches en retard maintenant, et tâches cochées après leur échéance ces 14 derniers jours. */
function lateness(tasks: Task[], now: Date) {
  const since = now.getTime() - 14 * DAY_MS;
  const current = tasks.filter((t) => isTaskLate(t, now)).length;
  const caughtUpLate = tasks.filter(
    (t) => t.done && t.due_date && t.completed_at && sqlDate(t.completed_at).getTime() >= since && toIsoDay(sqlDate(t.completed_at)) > t.due_date,
  ).length;
  return { current, caughtUpLate, score: current + caughtUpLate };
}

/** Rien de prévu : aucune tâche à faire, ni créée depuis quelques jours. */
function emptyPlanning(tasks: Task[], now: Date) {
  const pending = tasks.filter((t) => !t.done).length;
  const lastCreated = Math.max(0, ...tasks.map((t) => sqlDate(t.created_at).getTime()));
  const idleDays = lastCreated ? (now.getTime() - lastCreated) / DAY_MS : Infinity;
  return { pending, idleDays };
}

const EXAMPLE_HINT =
  "Si ça s'y prête, appuie-toi sur l'exemple bref d'une personne connue qui a beaucoup progressé à force de constance " +
  "(sportif, entrepreneur, artiste…) : ne cite que des faits connus et sûrs, n'invente jamais de citation entre guillemets.";

const FALLBACK = {
  late: (n: number) =>
    `${n} tâches ont glissé ces derniers temps. Astuce : découpe-les en petites étapes et donne-leur un jour prévu réaliste. Une à la fois, tu vas rattraper.`,
  lateBetter: (from: number, to: number) => `Tu es passé de ${from} à ${to} retards. C'est exactement comme ça qu'on progresse, continue !`,
  empty: (days: number) =>
    `Rien de planifié depuis ${Math.round(days)} jours. Prends 2 minutes pour noter 3 tâches pour aujourd'hui : c'est le meilleur moyen de garder le rythme.`,
  longDay: (worked: string) => `${worked} de travail aujourd'hui : quelle constance ! Les grands progrès se construisent exactement comme ça.`,
  streak: (n: number) => `${n} tâches cochées aujourd'hui, belle série ! Garde ce rythme, tu avances vraiment.`,
};

type Kind = "late" | "empty" | "longDay" | "streak";

async function send(settings: Settings, kind: Kind, title: string, instruction: string, fallback: string) {
  const text = (await compose(settings, `${instruction}\n${EXAMPLE_HINT}`)) ?? fallback;
  const today = toIsoDay(new Date());
  const count = settings.boost_day === today ? Number(settings.boost_count || 0) : 0;
  await setSetting("boost_day", today);
  await setSetting("boost_count", String(count + 1));
  await setSetting(`boost_${kind}_at`, new Date().toISOString());
  await notify(title, text);
}

export function useBoost() {
  useEffect(() => {
    if (!isTauri) return;
    const started = Date.now();
    const id = setInterval(async () => {
      try {
        if (Date.now() - started < STARTUP_DELAY_MS || !(await isLeader())) return;
        const s = await listSettings();
        const now = new Date();
        const hour = now.getHours();
        if (!boostOn(s) || s.onboarded !== "1" || hour < 9 || hour >= 20) return;
        const today = toIsoDay(now);
        if (s.boost_day === today && Number(s.boost_count || 0) >= MAX_PER_DAY) return;
        if ((await invoke<number>("idle_seconds")) > 120) return; // personne devant l'écran
        if (activeFocus(await listFocusSessions())) return; // on ne coupe pas une concentration

        const [tasks, entries] = await Promise.all([listTasks(), listEntries()]);
        const t = now.getTime();

        // 1. Coach : retards à répétition, avec suivi des progrès depuis le dernier conseil.
        const late = lateness(tasks, now);
        const lastLate = Number(s.boost_late_score || 0);
        if (late.score >= LATE_THRESHOLD && daysSince(s.boost_late_at, t) >= 2) {
          await setSetting("boost_late_score", String(late.score));
          const better = lastLate > late.score;
          return send(
            s,
            "late",
            better ? "🚀 Tu progresses" : "🧭 Petit coup de pouce",
            better
              ? `L'utilisateur avait ${lastLate} retards lors du dernier conseil, il n'en a plus que ${late.score}. Félicite-le de ses progrès et encourage-le à continuer, avec une astuce concrète.`
              : `L'utilisateur a ${late.current} tâche(s) en retard et en a terminé ${late.caughtUpLate} après leur échéance ces 14 derniers jours. ` +
                  "Donne-lui un conseil concret et bienveillant pour tenir ses échéances (découper, jour prévu réaliste, focus court, prioriser), sans culpabiliser.",
            better ? FALLBACK.lateBetter(lastLate, late.score) : FALLBACK.late(late.score),
          );
        }
        // Retards résorbés depuis le dernier conseil : on le dit (une fois).
        if (lastLate >= LATE_THRESHOLD && late.score === 0) {
          await setSetting("boost_late_score", "0");
          return send(
            s,
            "late",
            "🏆 Plus aucun retard",
            `L'utilisateur avait ${lastLate} retards, il les a tous rattrapés. Félicite-le chaleureusement.`,
            FALLBACK.lateBetter(lastLate, 0),
          );
        }

        // 2. Coach : plus rien de planifié depuis longtemps.
        const empty = emptyPlanning(tasks, now);
        if (empty.pending === 0 && empty.idleDays >= EMPTY_DAYS && daysSince(s.boost_empty_at, t) >= EMPTY_DAYS) {
          return send(
            s,
            "empty",
            "🗒️ On planifie ?",
            `L'utilisateur n'a plus aucune tâche à faire et n'en a créé aucune depuis ${Math.round(empty.idleDays)} jours. ` +
              "Encourage-le à noter 2 ou 3 tâches pour aujourd'hui, et rappelle qu'il peut simplement les dicter à Mégatron.",
            FALLBACK.empty(empty.idleDays),
          );
        }

        // 3. Motivation : longue journée, ou belle série de tâches (une fois par jour chacune).
        const worked = totalMs(entries, startOfDay(now), now, now);
        if (worked >= LONG_DAY_MS && daysSince(s.boost_longDay_at, t) >= 0.75) {
          return send(
            s,
            "longDay",
            "⚡ Quelle énergie",
            `L'utilisateur a déjà chronométré ${formatDuration(worked)} de travail aujourd'hui. Écris un message motivant qui valorise sa constance.`,
            FALLBACK.longDay(formatDuration(worked)),
          );
        }
        const doneToday = tasks.filter((x) => x.done && x.completed_at && toIsoDay(sqlDate(x.completed_at)) === today).length;
        if (doneToday >= STREAK_TASKS && daysSince(s.boost_streak_at, t) >= 0.75) {
          return send(
            s,
            "streak",
            "🔥 Belle série",
            `L'utilisateur a coché ${doneToday} tâches aujourd'hui. Félicite-le et donne-lui de l'élan pour la suite.`,
            FALLBACK.streak(doneToday),
          );
        }
      } catch (e) {
        console.error("Boost :", e);
      }
    }, CHECK_MS);
    return () => clearInterval(id);
  }, []);
}
