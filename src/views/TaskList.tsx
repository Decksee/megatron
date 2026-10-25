import { useEffect, useRef, useState } from "react";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, CalendarDays, Check, Eye, Flag, Pencil, Plus } from "lucide-react";
import { createTask, deleteTask, renameTask, setTaskDue, setTaskPlanned, toggleTask, type Project, type Task } from "../db";
import { EmptyState } from "../components/EmptyState";
import { DatePicker } from "../components/DatePicker";
import { fromIsoDay, isOverdue, isTaskLate, relativeDay, taskBucket, toIsoDay } from "../projects";
import { isMobileApp } from "../mobile/native";
import { openAddTask, openTask } from "../mobile/sheets";

interface Props {
  tasks: Task[];
  projects: Project[];
  /** Projet auquel rattacher les nouvelles tâches (null = sans projet). */
  projectId: number | null;
  /** Affiche l'étiquette du projet sur chaque tâche. */
  showProject?: boolean;
  placeholder?: string;
  /** Extra auquel rattacher les nouvelles tâches. */
  extraId?: number | null;
  /** Version compacte (tâches d'un extra) : pas de titres « À faire / Terminées » ni d'écran vide. */
  compact?: boolean;
  /** Sans jour choisi, une nouvelle tâche est prévue pour aujourd'hui (liste « Aujourd'hui »). */
  plannedToday?: boolean;
}

const PLAN_ICON = <CalendarDays size={12} className="select-chevron" aria-hidden="true" />;
const DUE_ICON = <Flag size={11} className="select-chevron" aria-hidden="true" />;

/** Jour où l'on prévoit de faire la tâche. Un jour passé (tâche reportée) compte pour aujourd'hui. */
function PlanChip({ task }: { task: Task }) {
  const day = task.planned_date;
  const now = !!day && !task.done && day <= toIsoDay(new Date());
  return (
    <DatePicker
      variant="chip"
      clearable
      icon={PLAN_ICON}
      title="Jour prévu : quand tu comptes la faire"
      value={day ? fromIsoDay(day) : null}
      onChange={(d) => setTaskPlanned(task.id, d ? toIsoDay(d) : null)}
      chipLabel={day ? (now && isOverdue(day) ? "Reportée" : relativeDay(day)) : undefined}
      chipClassName={`plan${now ? " today" : ""}`}
      ariaLabel={day ? `Prévue le ${day} (changer)` : "Prévoir un jour"}
    />
  );
}

/** Échéance : date limite. */
function DueChip({ task }: { task: Task }) {
  const due = task.due_date;
  const late = !!due && !task.done && isOverdue(due);
  const today = !!due && !task.done && due === toIsoDay(new Date());
  return (
    <DatePicker
      variant="chip"
      clearable
      icon={DUE_ICON}
      title="Échéance : date limite"
      value={due ? fromIsoDay(due) : null}
      onChange={(d) => setTaskDue(task.id, d ? toIsoDay(d) : null)}
      chipLabel={due ? relativeDay(due) : undefined}
      chipClassName={`due${late ? " late" : today ? " today" : ""}`}
      ariaLabel={due ? `À rendre le ${due} (changer)` : "Donner une échéance"}
    />
  );
}

/**
 * Intitulé d'une tâche, modifiable : double-clic (ou crayon) pour l'éditer,
 * Entrée pour enregistrer, Échap pour annuler. Le texte long passe à la ligne.
 */
function TaskTitle({ task, editing, onEditing }: { task: Task; editing: boolean; onEditing: (v: boolean) => void }) {
  const [value, setValue] = useState(task.title);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) return;
    setValue(task.title);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [editing]);

  // La zone de saisie grandit avec le texte.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, editing]);

  const save = async () => {
    const t = value.replace(/\s+/g, " ").trim();
    onEditing(false);
    if (t && t !== task.title) await renameTask(task.id, t);
  };

  if (!editing) {
    return (
      <span className="task-title" onDoubleClick={() => onEditing(true)} title="Double-clic pour modifier">
        {task.title}
      </span>
    );
  }
  return (
    <textarea
      ref={ref}
      className="task-title-edit"
      value={value}
      rows={1}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onEditing(false);
        }
      }}
      aria-label="Modifier la tâche"
    />
  );
}

export function TaskList({ tasks, projects, projectId, showProject, placeholder, extraId = null, compact = false, plannedToday = false }: Props) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<Date | null>(null);
  const [planned, setPlanned] = useState<Date | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const pending = tasks.filter((t) => !t.done);
  // Terminées : la plus récemment cochée en premier (dates SQLite « AAAA-MM-JJ HH:MM:SS », triables telles quelles).
  const done = tasks
    .filter((t) => t.done)
    .sort((a, b) => (b.completed_at ?? "").localeCompare(a.completed_at ?? ""));
  const now = new Date();
  const late = pending.filter((t) => isTaskLate(t, now));
  const groups = [
    { label: "En retard", items: late, late: true },
    { label: "Aujourd'hui", items: pending.filter((t) => !isTaskLate(t, now) && taskBucket(t, now) === "today") },
    { label: "Plus tard", items: pending.filter((t) => taskBucket(t, now) === "later") },
    { label: "Sans date", items: pending.filter((t) => taskBucket(t, now) === "none") },
  ].filter((g) => g.items.length);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    setDue(null);
    setPlanned(null);
    const day = planned ? toIsoDay(planned) : plannedToday ? toIsoDay(new Date()) : null;
    await createTask(t, projectId, due ? toIsoDay(due) : null, extraId, day);
  };

  const mobile = isMobileApp();

  /** Téléphone : toucher la tâche ouvre sa fiche ; le rond la coche ; les dates restent touchables. */
  const mobileRow = (task: Task) => {
    const project = task.project_id != null ? byId.get(task.project_id) : undefined;
    return (
      <motion.li
        key={task.id}
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: 20, transition: { duration: 0.12 } }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={`m-task ${task.done ? "task done" : isTaskLate(task) ? "task late" : "task"}`}
        onClick={() => openTask(task)}
      >
        <motion.button
          className="check"
          whileTap={{ scale: 0.85 }}
          onClick={(e) => {
            e.stopPropagation();
            void toggleTask(task);
          }}
          aria-label={task.done ? "Marquer à faire" : "Marquer faite"}
        >
          {task.done ? <Check size={13} strokeWidth={3} /> : null}
        </motion.button>
        <span className="m-task-body">
          <span className="task-title">{task.title}</span>
          <span className="m-task-meta" onClick={(e) => e.stopPropagation()}>
            {showProject && project && (
              <span className="tag-pill" title={project.name}>
                <i style={{ background: project.color }} />
                <span className="tag-pill-name">{project.name}</span>
              </span>
            )}
            {(!task.done || task.planned_date) && <PlanChip task={task} />}
            {(!task.done || task.due_date) && <DueChip task={task} />}
          </span>
        </span>
        <button
          type="button"
          className="m-task-open"
          onClick={(e) => {
            e.stopPropagation();
            openTask(task);
          }}
          aria-label="Voir la tâche"
        >
          <Eye size={17} />
        </button>
      </motion.li>
    );
  };

  const row = (task: Task) => {
    if (mobile) return mobileRow(task);
    const project = task.project_id != null ? byId.get(task.project_id) : undefined;
    return (
      <motion.li
        key={task.id}
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: 20, transition: { duration: 0.12 } }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={task.done ? "task done" : isTaskLate(task) ? "task late" : "task"}
      >
        <motion.button
          className="check"
          whileTap={{ scale: 0.85 }}
          onClick={() => toggleTask(task)}
          aria-label={task.done ? "Marquer à faire" : "Marquer faite"}
        >
          {task.done ? <Check size={11} strokeWidth={3} /> : null}
        </motion.button>
        <TaskTitle task={task} editing={editingId === task.id} onEditing={(v) => setEditingId(v ? task.id : null)} />
        {/* Projet et dates groupés à droite : ils s'empilent au lieu d'écraser l'intitulé. */}
        <span className="task-meta">
          {showProject && (
            <span className="task-project">
              {project && (
                <span className="tag-pill" title={project.name}>
                  <i style={{ background: project.color }} />
                  <span className="tag-pill-name">{project.name}</span>
                </span>
              )}
            </span>
          )}
          {/* Les deux dates posées : l'une sous l'autre. Sinon, sur une ligne (la vide n'est qu'une icône). */}
          <span className={task.planned_date && task.due_date ? "task-dates stacked" : "task-dates"}>
            {/* Tâche faite sans cette date : une case vide garde les colonnes alignées. */}
            {!task.done || task.planned_date ? <PlanChip task={task} /> : <span className="date-slot" />}
            {!task.done || task.due_date ? <DueChip task={task} /> : <span className="date-slot" />}
          </span>
        </span>
        {editingId !== task.id && (
          <button className="icon-btn edit" onClick={() => setEditingId(task.id)} aria-label="Modifier la tâche">
            <Pencil size={13} />
          </button>
        )}
        <ConfirmDelete onConfirm={() => deleteTask(task.id)} ariaLabel="Supprimer la tâche" />
      </motion.li>
    );
  };

  return (
    <div className="task-list">
      {mobile ? (
        <button type="button" className="m-task-add" onClick={() => openAddTask({ projectId, extraId, plannedToday })}>
          <Plus size={18} /> {extraId != null ? "Ajouter une sous-tâche" : "Ajouter une tâche"}
        </button>
      ) : (
        <form
          className="todo-add"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Plus size={14} className="tile-icon" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={placeholder ?? "Nouvelle tâche…"} />
          <DatePicker
            variant="chip"
            clearable
            icon={PLAN_ICON}
            title="Jour prévu : quand tu comptes la faire"
            value={planned}
            onChange={setPlanned}
            chipLabel={planned ? relativeDay(toIsoDay(planned)) : undefined}
            chipClassName="plan"
            ariaLabel="Jour prévu de la nouvelle tâche"
          />
          <DatePicker
            variant="chip"
            clearable
            icon={DUE_ICON}
            title="Échéance : date limite"
            value={due}
            onChange={setDue}
            chipLabel={due ? relativeDay(toIsoDay(due)) : undefined}
            chipClassName="due"
            ariaLabel="Échéance de la nouvelle tâche"
          />
          <button type="submit" className="todo-send" disabled={!title.trim()} aria-label="Ajouter la tâche">
            <ArrowRight size={14} strokeWidth={2.5} />
          </button>
        </form>
      )}

      {compact ? (
        <ul className="tasks compact">
          <AnimatePresence initial={false}>{[...pending, ...done].map(row)}</AnimatePresence>
        </ul>
      ) : tasks.length === 0 ? (
        <EmptyState mood="happy" title="Rien à faire" hint="Ajoute ta première tâche ci-dessus, ou demande-la à l'IA." />
      ) : (
        <ul className="tasks">
          <AnimatePresence initial={false}>
            {groups.flatMap((g) => [
              <li key={`label-${g.label}`} className={"late" in g ? "list-label late" : "list-label"}>
                {g.label} · {g.items.length}
              </li>,
              ...g.items.map(row),
            ])}
          </AnimatePresence>
          {pending.length === 0 && <li className="list-note">Tout est fait. Bien joué !</li>}
          {done.length > 0 && <li className="list-label">Terminées · {done.length}</li>}
          <AnimatePresence initial={false}>{done.map(row)}</AnimatePresence>
        </ul>
      )}
    </div>
  );
}
