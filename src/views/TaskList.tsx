import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, Plus, X } from "lucide-react";
import { createTask, deleteTask, setTaskDue, toggleTask, type Project, type Task } from "../db";
import { EmptyState } from "../components/EmptyState";
import { DatePicker } from "../components/DatePicker";
import { fromIsoDay, isOverdue, relativeDay, toIsoDay } from "../projects";

interface Props {
  tasks: Task[];
  projects: Project[];
  /** Projet auquel rattacher les nouvelles tâches (null = sans projet). */
  projectId: number | null;
  /** Affiche l'étiquette du projet sur chaque tâche. */
  showProject?: boolean;
  placeholder?: string;
}

function DueChip({ task }: { task: Task }) {
  const due = task.due_date;
  const late = !!due && !task.done && isOverdue(due);
  const today = !!due && !task.done && due === toIsoDay(new Date());
  return (
    <DatePicker
      variant="chip"
      clearable
      value={due ? fromIsoDay(due) : null}
      onChange={(d) => setTaskDue(task.id, d ? toIsoDay(d) : null)}
      chipLabel={due ? relativeDay(due) : undefined}
      chipClassName={late ? "late" : today ? "today" : ""}
      ariaLabel={due ? `Pour le ${due} (changer)` : "Donner une date"}
    />
  );
}

export function TaskList({ tasks, projects, projectId, showProject, placeholder }: Props) {
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<Date | null>(null);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const pending = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    setDue(null);
    await createTask(t, projectId, due ? toIsoDay(due) : null);
  };

  const row = (task: Task) => {
    const project = task.project_id != null ? byId.get(task.project_id) : undefined;
    return (
      <motion.li
        key={task.id}
        layout
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, x: 20, transition: { duration: 0.12 } }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className={task.done ? "task done" : "task"}
      >
        <motion.button
          className="check"
          whileTap={{ scale: 0.85 }}
          onClick={() => toggleTask(task)}
          aria-label={task.done ? "Marquer à faire" : "Marquer faite"}
        >
          {task.done ? <Check size={11} strokeWidth={3} /> : null}
        </motion.button>
        <span className="task-title">{task.title}</span>
        {showProject && project && (
          <span className="tag-pill">
            <i style={{ background: project.color }} />
            {project.name}
          </span>
        )}
        {(!task.done || task.due_date) && <DueChip task={task} />}
        <button className="icon-btn" onClick={() => deleteTask(task.id)} aria-label="Supprimer la tâche">
          <X size={14} />
        </button>
      </motion.li>
    );
  };

  return (
    <div className="task-list">
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
          value={due}
          onChange={setDue}
          chipLabel={due ? relativeDay(toIsoDay(due)) : undefined}
          ariaLabel="Date de la nouvelle tâche"
        />
        <button type="submit" className="todo-send" disabled={!title.trim()} aria-label="Ajouter la tâche">
          <ArrowRight size={14} strokeWidth={2.5} />
        </button>
      </form>

      {tasks.length === 0 ? (
        <EmptyState mood="happy" title="Rien à faire" hint="Ajoute ta première tâche ci-dessus, ou demande-la à l'IA." />
      ) : (
        <ul className="tasks">
          {pending.length > 0 && <li className="list-label">À faire · {pending.length}</li>}
          <AnimatePresence initial={false}>{pending.map(row)}</AnimatePresence>
          {pending.length === 0 && <li className="list-note">Tout est fait. Bien joué !</li>}
          {done.length > 0 && <li className="list-label">Terminées · {done.length}</li>}
          <AnimatePresence initial={false}>{done.map(row)}</AnimatePresence>
        </ul>
      )}
    </div>
  );
}
