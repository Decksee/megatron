import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  completeReminder,
  createReminder,
  deleteReminder,
  snoozeReminder,
  updateReminder,
  type Reminder,
  type ReminderRepeat,
} from "../db";
import { EVERY_OPTIONS, formatDue, REPEAT_LABEL, ruleLabel, SNOOZE_MINUTES, WEEK } from "../reminders";
import type { Data } from "../useData";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { ArrowRight, BellRing, Check, ChevronRight, Music, Pencil, Repeat, X } from "lucide-react";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { EmptyState } from "../components/EmptyState";
import { projectOptions } from "../options";
import { isMobileApp, native } from "../mobile/native";

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
  const [ring, setRing] = useState(false);
  /** Jours choisis (repeat = « days »), répétition dans la journée et heure de fin. */
  const [days, setDays] = useState<number[]>([]);
  const [everyMin, setEveryMin] = useState(0);
  const [until, setUntil] = useState("18:00");
  const [showDone, setShowDone] = useState(false);
  /** Téléphone : nom du son des rappels avec sonnerie (choisi dans la liste des sons d'Android). */
  const [ringSound, setRingSound] = useState<string | null>(null);
  useEffect(() => {
    if (isMobileApp()) native<{ title: string }>("ringSound").then((r) => setRingSound(r.title)).catch(() => {});
  }, []);
  /** Rappel en cours de modification : le formulaire du haut sert alors à le modifier. */
  const [editing, setEditing] = useState<Reminder | null>(null);

  const valid = title.trim() && due && (repeat !== "days" || days.length > 0);
  // Heures de fin possibles : après l'heure du rappel, jusqu'à la fin de la journée.
  const untilOptions = [
    ...Array.from({ length: 23 - (due?.getHours() ?? 0) }, (_, i) => {
      const h = (due?.getHours() ?? 0) + i + 1;
      return { value: `${String(h).padStart(2, "0")}:00`, label: `${h} h` };
    }),
    { value: "", label: "Minuit" },
  ];
  const upcoming = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const next = upcoming.filter((r) => new Date(r.due_at) > now)[0];
  const todayCount = upcoming.filter((r) => new Date(r.due_at).toDateString() === now.toDateString()).length;

  const reset = () => {
    setEditing(null);
    setTitle("");
    setDue(new Date(Date.now() + 30 * 60_000));
    setRepeat("none");
    setProjectId(null);
    setRing(false);
    setDays([]);
    setEveryMin(0);
    setUntil("18:00");
  };

  const add = async () => {
    if (!valid) return;
    const r = { title: title.trim(), dueAt: due!, repeat, projectId, ring, days, everyMin, until };
    if (editing) {
      await updateReminder(editing.id, r);
      reset();
    } else {
      await createReminder(r);
      setTitle("");
    }
  };

  const edit = (r: Reminder) => {
    setEditing(r);
    setTitle(r.title);
    setDue(new Date(r.due_at));
    setRepeat(r.repeat);
    setProjectId(r.project_id);
    setRing(!!r.ring);
    setDays((r.days ?? "").split(",").filter(Boolean).map(Number));
    setEveryMin(r.every_min ?? 0);
    setUntil(r.every_min ? (r.until_time ?? "") : "18:00");
    requestAnimationFrame(() => document.getElementById("reminder-title")?.focus());
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
        className={`${isDue ? "reminder due" : r.done ? "reminder done" : "reminder"}${editing?.id === r.id ? " editing" : ""}`}
        onDoubleClick={() => edit(r)}
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
          {ruleLabel(r) && (
            <span className="muted small with-icon">
              <Repeat size={11} /> {ruleLabel(r)}
            </span>
          )}
          {!!r.ring && isMobileApp() && (
            <span className="muted small with-icon">
              <BellRing size={11} /> Sonnerie
            </span>
          )}
        </div>
        {project && (
          <span className="tag-pill" title={project.name}>
            <i style={{ background: project.color }} />
            <span className="tag-pill-name">{project.name}</span>
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
        <button className="icon-btn edit" onClick={() => edit(r)} aria-label="Modifier le rappel">
          <Pencil size={13} />
        </button>
        <ConfirmDelete
          onConfirm={() => {
            if (editing?.id === r.id) reset();
            return deleteReminder(r.id);
          }}
          ariaLabel="Supprimer le rappel"
        />
      </motion.li>
    );
  };

  return (
    <div className="split">
    <div className="view">
      <form
        className={editing ? "tile reminder-form editing" : "tile reminder-form"}
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        {editing && (
          <div className="reminder-edit-head">
            <span className="with-icon">
              <Pencil size={12} /> Modifier le rappel
            </span>
            <button type="button" className="link muted" onClick={reset}>
              <X size={12} /> Annuler
            </button>
          </div>
        )}
        <div className="composer-line">
          <BellRing size={15} className="tile-icon" />
          <input
            id="reminder-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && editing && reset()}
            placeholder={isMobileApp() ? "Me rappeler de…" : "Me rappeler de… (ex : relancer le client)"}
          />
          <button type="submit" className="todo-send" disabled={!valid} aria-label={editing ? "Enregistrer le rappel" : "Ajouter le rappel"}>
            {editing ? <Check size={14} strokeWidth={2.6} /> : <ArrowRight size={14} strokeWidth={2.5} />}
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
        <div className="row composer-meta reminder-rules">
          {/* Chaque liste porte son titre : « Quels jours » et « Dans la journée » ne se confondent pas. */}
          <div className="rule-field">
            <span className="rule-caption">Quels jours</span>
            <Select<ReminderRepeat>
              small
              value={repeat}
              onChange={(v) => {
                setRepeat(v);
                // « Certains jours » : on propose d'emblée le jour du rappel.
                if (v === "days" && !days.length && due) setDays([due.getDay()]);
              }}
              options={(Object.keys(REPEAT_LABEL) as ReminderRepeat[]).map((v) => ({ value: v, label: REPEAT_LABEL[v] }))}
              ariaLabel="Quels jours"
            />
          </div>
          <div className="rule-field">
            <span className="rule-caption">Dans la journée</span>
            <Select<number> small value={everyMin} onChange={setEveryMin} options={EVERY_OPTIONS} ariaLabel="Dans la journée" />
          </div>
          {everyMin > 0 && (
            <div className="rule-field">
              <span className="rule-caption">Jusqu'à</span>
              <Select<string> small value={until} onChange={setUntil} options={untilOptions} ariaLabel="Jusqu'à" />
            </div>
          )}
          <div className="rule-field">
            <span className="rule-caption">Projet</span>
            <Select small value={projectId} onChange={setProjectId} options={projectOptions(projects)} ariaLabel="Projet" />
          </div>
        </div>
        {repeat === "days" && (
          <div className="weekday-picker" role="group" aria-label="Jours du rappel">
            {WEEK.map((w) => {
              const on = days.includes(w.day);
              return (
                <button
                  type="button"
                  key={w.day}
                  className={on ? "weekday on" : "weekday"}
                  aria-pressed={on}
                  aria-label={w.label}
                  title={w.label}
                  onClick={() => setDays(on ? days.filter((d) => d !== w.day) : [...days, w.day])}
                >
                  {w.short}
                </button>
              );
            })}
          </div>
        )}
        {isMobileApp() && (
          <button type="button" className={ring ? "m-ring on" : "m-ring"} onClick={() => setRing(!ring)} aria-pressed={ring}>
            <BellRing size={17} />
            <span>
              <b>Sonnerie</b>
              <span className="muted small">{ring ? "Sonne comme un réveil, même en silencieux" : "Simple notification"}</span>
            </span>
            <span className="m-ring-switch" />
          </button>
        )}
        {isMobileApp() && ring && (
          <button
            type="button"
            className="m-ring-sound"
            onClick={() => native<{ title: string }>("pickRingSound").then((r) => setRingSound(r.title)).catch(() => {})}
          >
            <Music size={16} />
            <span>
              <b>Son de l'alarme</b>
              <span className="muted small">{ringSound ?? "Réveil du téléphone"}</span>
            </span>
            <ChevronRight size={18} />
          </button>
        )}
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
            <span className="side-row-value">{upcoming.filter((r) => r.repeat !== "none" || !!r.every_min).length}</span>
          </div>
        </div>
      </aside>
    </div>
  );
}
