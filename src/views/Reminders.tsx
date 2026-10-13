import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  completeReminder,
  createReminder,
  deleteReminder,
  snoozeReminder,
  type Reminder,
  type ReminderRepeat,
} from "../db";
import { formatDue, REPEAT_LABEL, SNOOZE_MINUTES } from "../reminders";
import type { Data } from "../useData";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { ArrowRight, BellRing, Check, Repeat, X } from "lucide-react";
import { EmptyState } from "../components/EmptyState";
import { projectOptions } from "../options";

function at(hour: number, dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** « dans 1 h 30 », « dans 12 min », « dans 3 j » */
function untilLabel(d: Date, now: Date) {
  const min = Math.max(1, Math.round((d.getTime() - now.getTime()) / 60_000));
  if (min < 60) return `dans ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `dans ${h} h${min % 60 ? ` ${String(min % 60).padStart(2, "0")}` : ""}`;
  return `dans ${Math.round(h / 24)} j`;
}

const SUGGESTIONS = ["Relancer un client", "Faire une pause", "Envoyer la facture", "Point avec l'équipe"];

/** Groupe d'affichage d'un rappel dans la ligne du temps. */
function groupOf(due: Date, now: Date) {
  if (due <= now) return "Maintenant";
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((day(due) - day(now)) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff < 7) return "Cette semaine";
  return "Plus tard";
}

const PRESETS: { label: string; date: () => Date }[] = [
  { label: "+10 min", date: () => new Date(Date.now() + 10 * 60_000) },
  { label: "+30 min", date: () => new Date(Date.now() + 30 * 60_000) },
  { label: "+1 h", date: () => new Date(Date.now() + 60 * 60_000) },
  { label: "Ce soir 18h", date: () => at(18) },
  { label: "Demain 9h", date: () => at(9, 1) },
];

export function Reminders({ reminders, projects, now }: Data & { now: Date }) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<Date | null>(() => new Date(Date.now() + 30 * 60_000));
  const [repeat, setRepeat] = useState<ReminderRepeat>("none");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [showDone, setShowDone] = useState(false);

  const valid = title.trim() && due;
  const upcoming = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const next = upcoming.filter((r) => new Date(r.due_at) > now)[0];
  const todayCount = upcoming.filter((r) => new Date(r.due_at).toDateString() === now.toDateString()).length;

  const add = async () => {
    if (!valid) return;
    await createReminder({ title: title.trim(), dueAt: due!, repeat, projectId });
    setTitle("");
  };

  const row = (r: Reminder) => {
    const isDue = !r.done && new Date(r.due_at) <= now;
    const project = r.project_id != null ? byId.get(r.project_id) : undefined;
    return (
      <motion.li
        key={r.id}
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={{ duration: 0.18 }}
        className={isDue ? "reminder due" : r.done ? "reminder done" : "reminder"}
      >
        <div className="reminder-time">
          <span className="rt-hour">
            {new Date(r.due_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span className="rt-day">
            {isDue ? (
              <BellRing size={11} />
            ) : r.done ? (
              <Check size={11} />
            ) : ["Cette semaine", "Plus tard"].includes(groupOf(new Date(r.due_at), now)) ? (
              new Date(r.due_at).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })
            ) : null}
          </span>
        </div>
        <div className="reminder-main">
          <span className="reminder-title">{r.title}</span>
          {r.repeat !== "none" && (
            <span className="muted small with-icon">
              <Repeat size={11} /> {REPEAT_LABEL[r.repeat]}
            </span>
          )}
        </div>
        {project && (
          <span className="tag-pill">
            <i style={{ background: project.color }} />
            {project.name}
          </span>
        )}
        {isDue && (
          <>
            <button className="btn ghost icon" onClick={() => snoozeReminder(r, SNOOZE_MINUTES)} title="Plus tard">
              +{SNOOZE_MINUTES}
            </button>
            <button className="btn primary icon" onClick={() => completeReminder(r)} title="Fait" aria-label="Marquer comme fait">
              <Check size={14} strokeWidth={2.5} />
            </button>
          </>
        )}
        <button className="icon-btn" onClick={() => deleteReminder(r.id)} aria-label="Supprimer le rappel">
          <X size={14} />
        </button>
      </motion.li>
    );
  };

  return (
    <div className="split">
    <div className="view">
      <form
        className="tile reminder-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="composer-line">
          <BellRing size={15} className="tile-icon" />
          <input
            id="reminder-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Me rappeler de… (ex : relancer le client)"
          />
          <button type="submit" className="todo-send" disabled={!valid} aria-label="Ajouter le rappel">
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        </div>
        <div className="row wrap composer-meta">
          <DatePicker withTime value={due} onChange={setDue} ariaLabel="Date et heure du rappel" />
          {PRESETS.map((p) => (
            <button type="button" key={p.label} className="chip small" onClick={() => setDue(p.date())}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="row composer-meta">
          <Select<ReminderRepeat>
            small
            value={repeat}
            onChange={setRepeat}
            options={(Object.keys(REPEAT_LABEL) as ReminderRepeat[]).map((v) => ({ value: v, label: REPEAT_LABEL[v] }))}
            ariaLabel="Répétition"
          />
          <Select small value={projectId} onChange={setProjectId} options={projectOptions(projects)} ariaLabel="Projet" />
        </div>
      </form>

      {upcoming.length === 0 && !showDone ? (
        <EmptyState mood="sleep" title="Aucun rappel prévu" hint="Une idée ?">
          {SUGGESTIONS.map((t) => (
            <button
              key={t}
              className="chip"
              onClick={() => {
                setTitle(t);
                document.getElementById("reminder-title")?.focus();
              }}
            >
              {t}
            </button>
          ))}
        </EmptyState>
      ) : null}
      <ul className="reminders">
        <AnimatePresence initial={false}>
          {upcoming.flatMap((r, i) => {
            const group = groupOf(new Date(r.due_at), now);
            const prev = i > 0 ? groupOf(new Date(upcoming[i - 1].due_at), now) : null;
            return group !== prev
              ? [
                  <motion.li key={`g-${group}`} layout className="list-label">
                    {group}
                  </motion.li>,
                  row(r),
                ]
              : [row(r)];
          })}
        </AnimatePresence>
        {done.length > 0 && (
          <li className="done-toggle">
            <button className="link" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "Masquer" : "Voir"} les rappels terminés ({done.length})
            </button>
          </li>
        )}
        <AnimatePresence initial={false}>{showDone && done.map(row)}</AnimatePresence>
      </ul>
    </div>
      <aside className="side">
        <div className="tile next-reminder">
          <span className="tile-caption with-icon">
            <BellRing size={12} /> Prochain rappel
          </span>
          {next ? (
            <>
              <span className="next-title">{next.title}</span>
              <span className="next-in">{untilLabel(new Date(next.due_at), now)}</span>
              <span className="tile-caption">{formatDue(next.due_at, now)}</span>
            </>
          ) : (
            <span className="tile-caption">Rien de prévu.</span>
          )}
        </div>
        <div className="tile side-list">
          <span className="tile-title">En bref</span>
          <div className="side-row static">
            <span className="side-row-name">Aujourd'hui</span>
            <span className="side-row-value">{todayCount}</span>
          </div>
          <div className="side-row static">
            <span className="side-row-name">À venir</span>
            <span className="side-row-value">{upcoming.length}</span>
          </div>
          <div className="side-row static">
            <span className="side-row-name">Répétés</span>
            <span className="side-row-value">{upcoming.filter((r) => r.repeat !== "none").length}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
