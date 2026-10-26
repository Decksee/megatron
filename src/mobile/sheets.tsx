import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { ArrowUp, CalendarDays, Check, Flag, RotateCcw, Trash2, X } from "lucide-react";
import { createTask, deleteTask, renameTask, setTaskDue, setTaskExtra, setTaskPlanned, toggleTask, type Project, type Task } from "../db";
import { ScrollChips } from "../components/ScrollChips";
import { DatePicker } from "../components/DatePicker";
import { fromIsoDay, relativeDay, toIsoDay } from "../projects";
import { useBack } from "./useBack";

// ---------- Panneau du bas, commun à toute l'appli ----------

/**
 * Panneau qui monte du bas de l'écran : se ferme en touchant à côté, en le tirant vers le bas
 * (par sa poignée ou son titre) ou avec le retour d'Android.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  onSubmit,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  onSubmit?: () => void;
  className?: string;
}) {
  useBack(open, onClose);
  const drag = useDragControls();
  const Body = onSubmit ? motion.form : motion.div;
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="m-sheet-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          />
          <Body
            key="sheet"
            className={className ? `m-sheet ${className}` : "m-sheet"}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: { type: "tween", duration: 0.22, ease: [0.4, 0, 1, 1] } }}
            transition={{ type: "spring", stiffness: 300, damping: 34, mass: 0.9 }}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.9 }}
            onDragEnd={(_, info) => {
              // Tiré assez loin ou assez vite vers le bas : on ferme ; sinon il revient en place.
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              onSubmit?.();
            }}
          >
            <div className="m-sheet-handle" onPointerDown={(e) => drag.start(e)}>
              <div className="m-sheet-grip" />
            </div>
            {title && (
              <div className="m-sheet-head" onPointerDown={(e) => drag.start(e)}>
                <b>{title}</b>
                <button type="button" className="icon-round" onClick={onClose} aria-label="Fermer">
                  <X size={16} />
                </button>
              </div>
            )}
            {children}
          </Body>
        </>
      )}
    </AnimatePresence>
  );
}

// ---------- Ouverture depuis n'importe quel écran ----------

type Request =
  | { kind: "task"; id: number }
  | { kind: "add"; projectId: number | null; extraId: number | null; plannedToday: boolean }
  | { kind: "confirm"; title: string; detail?: string; action: string; resolve: (ok: boolean) => void };

let current: Request | null = null;
const listeners = new Set<() => void>();
const set = (r: Request | null) => {
  current = r;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Fiche d'une tâche : intitulé, projet, dates, faite, suppression. */
export const openTask = (task: Task) => set({ kind: "task", id: task.id });
/** Fiche d'une tâche à partir de son numéro (bouton « Replanifier » d'une notification). */
export const openTaskById = (id: number) => set({ kind: "task", id });
/** Nouvelle tâche, rattachée au projet (ou à l'extra) de l'écran en cours. */
export const openAddTask = (opts: { projectId?: number | null; extraId?: number | null; plannedToday?: boolean } = {}) =>
  set({ kind: "add", projectId: opts.projectId ?? null, extraId: opts.extraId ?? null, plannedToday: !!opts.plannedToday });

/** Demande de confirmation dans un panneau (toutes les suppressions sur téléphone). */
export function confirmSheet(opts: { title: string; detail?: string; action?: string }): Promise<boolean> {
  current?.kind === "confirm" && current.resolve(false);
  return new Promise((resolve) => set({ kind: "confirm", title: opts.title, detail: opts.detail, action: opts.action ?? "Supprimer", resolve }));
}

/** Les panneaux eux-mêmes : à poser une fois dans l'appli. */
export function MobileSheets({ tasks, projects }: { tasks: Task[]; projects: Project[] }) {
  const req = useSyncExternalStore(subscribe, () => current);
  const close = () => set(null);
  const task = req?.kind === "task" ? tasks.find((t) => t.id === req.id) : undefined;

  return (
    <>
      <TaskSheet task={task} projects={projects} onClose={close} />
      <AddTaskSheet request={req?.kind === "add" ? req : null} projects={projects} onClose={close} />
      <ConfirmSheet
        request={req?.kind === "confirm" ? req : null}
        onAnswer={(ok) => {
          if (req?.kind === "confirm") req.resolve(ok);
          close();
        }}
      />
    </>
  );
}

// ---------- Dates : raccourcis au pouce + calendrier ----------

const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toIsoDay(d);
};

function DayPicker({
  label,
  icon,
  value,
  onChange,
  className,
}: {
  label: string;
  icon: ReactNode;
  value: string | null;
  onChange: (day: string | null) => void;
  className: string;
}) {
  const today = addDays(0);
  const tomorrow = addDays(1);
  const other = value && value !== today && value !== tomorrow;
  // Toucher le choix actif l'enlève aussi.
  const opt = (day: string, text: string) => (
    <button type="button" className={value === day ? "chip active" : "chip"} onClick={() => onChange(value === day ? null : day)}>
      {text}
    </button>
  );
  return (
    <div className="m-field">
      <span className="m-field-label">
        {icon} {label}
        {value && (
          <button type="button" className="m-field-clear" onClick={() => onChange(null)}>
            Retirer
          </button>
        )}
      </span>
      <div className="m-day-options">
        {opt(today, "Aujourd'hui")}
        {opt(tomorrow, "Demain")}
        <DatePicker
          variant="chip"
          icon={<CalendarDays size={14} className="select-chevron" aria-hidden="true" />}
          value={value ? fromIsoDay(value) : null}
          onChange={(d) => onChange(d ? toIsoDay(d) : null)}
          chipLabel={other ? relativeDay(value!) : "Autre…"}
          chipClassName={other ? `${className} set m-day-other active` : `${className} m-day-other`}
          ariaLabel={`${label} : choisir une date`}
        />
      </div>
    </div>
  );
}

function ProjectChips({ projects, value, onChange }: { projects: Project[]; value: number | null; onChange: (id: number | null) => void }) {
  const active = projects.filter((p) => p.status === "active" || p.id === value);
  if (!active.length) return null;
  return (
    <div className="m-field">
      <span className="m-field-label">Projet</span>
      <ScrollChips>
        <button type="button" className={value == null ? "chip active" : "chip"} onClick={() => onChange(null)}>
          Autre projet
        </button>
        {active.map((p) => (
          <button type="button" key={p.id} className={value === p.id ? "chip active" : "chip"} onClick={() => onChange(p.id)}>
            <span className="chip-dot" style={{ background: p.color }} />
            {p.name}
          </button>
        ))}
      </ScrollChips>
    </div>
  );
}

function useAutoGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);
  return ref;
}

// ---------- Fiche d'une tâche ----------

function TaskSheet({ task, projects, onClose }: { task: Task | undefined; projects: Project[]; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const ref = useAutoGrow(title);
  const id = task?.id;
  useEffect(() => {
    if (task) setTitle(task.title);
  }, [id]);

  // L'intitulé s'enregistre en quittant le champ ou en fermant : pas de bouton « Enregistrer » à chercher.
  const saveTitle = async () => {
    const t = title.replace(/\s+/g, " ").trim();
    if (task && t && t !== task.title) await renameTask(task.id, t);
  };
  const close = () => {
    void saveTitle();
    onClose();
  };
  const remove = async () => {
    if (!task) return;
    const ok = await confirmSheet({ title: "Supprimer cette tâche ?", detail: task.title });
    if (ok) await deleteTask(task.id);
    else set({ kind: "task", id: task.id });
  };

  return (
    <Sheet open={!!task} onClose={close} title="Tâche" className="m-sheet-tall">
      {task && (
        <>
          <textarea
            ref={ref}
            className="m-sheet-input"
            rows={1}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            aria-label="Intitulé de la tâche"
          />
          <ProjectChips projects={projects} value={task.project_id} onChange={(p) => setTaskExtra(task.id, p, null)} />
          <DayPicker
            label="Jour prévu"
            icon={<CalendarDays size={14} />}
            value={task.planned_date}
            onChange={(d) => setTaskPlanned(task.id, d)}
            className="plan"
          />
          <DayPicker label="Échéance" icon={<Flag size={13} />} value={task.due_date} onChange={(d) => setTaskDue(task.id, d)} className="due" />
          <div className="m-sheet-actions">
            <button type="button" className="m-action danger" onClick={remove}>
              <Trash2 size={18} /> Supprimer
            </button>
            <button
              type="button"
              className={task.done ? "m-action" : "m-action primary"}
              onClick={async () => {
                await saveTitle();
                await toggleTask(task);
                onClose();
              }}
            >
              {task.done ? <RotateCcw size={18} /> : <Check size={18} strokeWidth={2.6} />}
              {task.done ? "Remettre à faire" : "C'est fait"}
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}

// ---------- Nouvelle tâche ----------

function AddTaskSheet({
  request,
  projects,
  onClose,
}: {
  request: Extract<Request, { kind: "add" }> | null;
  projects: Project[];
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [planned, setPlanned] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  const ref = useAutoGrow(title);

  useEffect(() => {
    if (!request) return;
    setTitle("");
    setProjectId(request.projectId);
    setDue(null);
    setPlanned(request.plannedToday ? addDays(0) : null);
    requestAnimationFrame(() => ref.current?.focus());
  }, [request]);

  const save = async () => {
    const t = title.trim();
    if (!t || !request) return;
    await createTask(t, projectId, due, request.extraId, planned);
    onClose();
  };

  return (
    <Sheet open={!!request} onClose={onClose} title="Nouvelle tâche" onSubmit={save}>
      <textarea
        ref={ref}
        className="m-sheet-input"
        rows={1}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Que dois-tu faire ?"
        enterKeyHint="done"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      {request?.extraId == null && <ProjectChips projects={projects} value={projectId} onChange={setProjectId} />}
      <DayPicker label="Jour prévu" icon={<CalendarDays size={14} />} value={planned} onChange={setPlanned} className="plan" />
      <DayPicker label="Échéance" icon={<Flag size={13} />} value={due} onChange={setDue} className="due" />
      <button type="submit" className="m-start" disabled={!title.trim()}>
        <ArrowUp size={20} strokeWidth={2.6} /> Ajouter la tâche
      </button>
    </Sheet>
  );
}

// ---------- Confirmation ----------

function ConfirmSheet({ request, onAnswer }: { request: Extract<Request, { kind: "confirm" }> | null; onAnswer: (ok: boolean) => void }) {
  return (
    <Sheet open={!!request} onClose={() => onAnswer(false)}>
      {request && (
        <div className="m-confirm">
          <span className="m-confirm-icon">
            <Trash2 size={22} />
          </span>
          <b>{request.title}</b>
          {request.detail && <span className="muted">{request.detail}</span>}
          <span className="muted small">C'est définitif.</span>
          <div className="m-sheet-actions">
            <button type="button" className="m-action" onClick={() => onAnswer(false)}>
              Annuler
            </button>
            <button type="button" className="m-action danger solid" onClick={() => onAnswer(true)}>
              {request.action}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
