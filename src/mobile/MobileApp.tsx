import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { AlertTriangle, ArrowUp, Bot as BotIcon, CalendarDays, Flag, FolderKanban, ListChecks, Plus, Settings2, Sun, X } from "lucide-react";
import { useData, type Data } from "../useData";
import { useTheme } from "../theme";
import { Bot } from "../components/Bot";
import { ScrollChips } from "../components/ScrollChips";
import { DatePicker } from "../components/DatePicker";
import { TaskList } from "../views/TaskList";
import { Projects } from "../views/Projects";
import { ProgressRing } from "../views/Today";
import { MobileSettings } from "./MobileSettings";
import { useNativeSync } from "./useNativeSync";
import { createTask } from "../db";
import { isTaskLate, lateByProject, relativeDay, taskBucket, toIsoDay } from "../projects";

/**
 * Application Android : une seule fenêtre plein écran, des onglets en bas et un bouton « + » à portée de pouce.
 */
const TABS = [
  { id: "today", label: "Aujourd'hui", icon: Sun },
  { id: "tasks", label: "Tâches", icon: ListChecks },
  { id: "projects", label: "Projets", icon: FolderKanban },
  { id: "ai", label: "IA", icon: BotIcon },
  { id: "settings", label: "Réglages", icon: Settings2 },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function MobileApp() {
  const data = useData();
  useTheme(data.settings);
  useNativeSync();
  const [tab, setTab] = useState<TabId>("today");
  const [adding, setAdding] = useState(false);
  const showFab = tab === "today" || tab === "tasks";

  return (
    <div className="m-shell">
      <header className="m-head">
        <span className="m-title">{TABS.find((t) => t.id === tab)!.label}</span>
        <Bot mood="idle" size={28} />
      </header>

      <main className="m-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="m-page"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {tab === "today" && <TodayPage {...data} />}
            {tab === "tasks" && <TasksPage {...data} />}
            {tab === "projects" && <Projects {...data} />}
            {tab === "settings" && <MobileSettings {...data} />}
            {tab === "ai" && <Soon />}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showFab && !adding && (
          <motion.button
            className="m-fab"
            onClick={() => setAdding(true)}
            aria-label="Ajouter une tâche"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            whileTap={{ scale: 0.9 }}
          >
            <Plus size={26} strokeWidth={2.4} />
          </motion.button>
        )}
      </AnimatePresence>
      <AddTaskSheet open={adding} onClose={() => setAdding(false)} projects={data.projects} plannedToday={tab === "today"} />

      <nav className="m-tabs" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={id === tab ? "m-tab active" : "m-tab"} onClick={() => setTab(id)} aria-current={id === tab ? "page" : undefined}>
            <span className="m-tab-icon">
              {id === tab && <motion.span layoutId="m-tab-pill" className="m-tab-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <Icon size={21} strokeWidth={id === tab ? 2.4 : 2} />
            </span>
            <span className="m-tab-label">{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

/** Aujourd'hui : un résumé (anneau de progression), les retards, puis les tâches du jour. */
function TodayPage({ tasks, projects }: Data) {
  const now = new Date();
  const today = tasks.filter((t) => !t.done && taskBucket(t, now) === "today");
  const late = lateByProject(tasks, now);
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const doneToday = tasks.filter((t) => t.done && t.completed_at && new Date(t.completed_at + "Z").toDateString() === now.toDateString());
  const total = today.length + doneToday.length;
  const shown = [...[...today].sort((a, b) => Number(isTaskLate(b, now)) - Number(isTaskLate(a, now))), ...doneToday];

  return (
    <div className="m-today">
      <section className="m-hero">
        <div className="m-hero-text">
          <span className="m-hello">{greeting(now)} 👋</span>
          <span className="m-date">{now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
          <b className="m-hero-count">
            {today.length ? `${today.length} tâche${today.length > 1 ? "s" : ""} à faire` : total ? "Tout est fait 🎉" : "Rien de prévu"}
          </b>
        </div>
        <ProgressRing ratio={total ? doneToday.length / total : 0} size={64} stroke={6}>
          <span className="m-ring-label">
            {doneToday.length}/{total}
          </span>
        </ProgressRing>
      </section>

      {late.total > 0 && (
        <div className="m-late">
          <AlertTriangle size={16} />
          <span>
            <b>
              {late.total} tâche{late.total > 1 ? "s" : ""} en retard
            </b>
            <span className="m-late-detail">
              {late.groups
                .slice(0, 3)
                .map(([id, n]) => `${id == null ? "sans projet" : nameOf.get(id)} ${n}`)
                .join(" · ")}
            </span>
          </span>
        </div>
      )}

      {shown.length ? (
        <TaskList tasks={shown} projects={projects} projectId={null} showProject compact plannedToday />
      ) : (
        <div className="m-empty">
          <Bot mood="happy" size={56} />
          <b>Journée libre</b>
          <span className="muted small">Touche « + » pour ajouter une tâche.</span>
        </div>
      )}
    </div>
  );
}

type Filter = "all" | "none" | number;

/** Toutes les tâches, filtrables par projet au doigt. */
function TasksPage({ tasks, projects }: Data) {
  const [filter, setFilter] = useState<Filter>("all");
  const active = projects.filter((p) => p.status === "active");
  const visible = tasks.filter((t) => (filter === "all" ? true : filter === "none" ? t.project_id == null : t.project_id === filter));
  const chip = (value: Filter, label: string, color?: string) => (
    <button key={String(value)} className={filter === value ? "chip active" : "chip"} onClick={() => setFilter(value)}>
      {color && <span className="chip-dot" style={{ background: color }} />}
      {label}
    </button>
  );
  return (
    <div className="m-tasks">
      <ScrollChips>
        {chip("all", "Toutes")}
        {chip("none", "Sans projet")}
        {active.map((p) => chip(p.id, p.name, p.color))}
      </ScrollChips>
      <TaskList tasks={visible} projects={projects} projectId={typeof filter === "number" ? filter : null} showProject={filter === "all"} />
    </div>
  );
}

/** Panneau qui glisse depuis le bas pour ajouter une tâche : intitulé, projet, jour prévu, échéance. */
function AddTaskSheet({
  open,
  onClose,
  projects,
  plannedToday,
}: {
  open: boolean;
  onClose: () => void;
  projects: Data["projects"];
  plannedToday: boolean;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState<number | null>(null);
  const [planned, setPlanned] = useState<Date | null>(null);
  const [due, setDue] = useState<Date | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  // Le panneau se saisit par sa poignée (ou son titre) : la zone de saisie et les projets restent utilisables.
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setProjectId(null);
    setDue(null);
    setPlanned(plannedToday ? new Date() : null);
    requestAnimationFrame(() => input.current?.focus());
  }, [open, plannedToday]);

  const save = async () => {
    const t = title.trim();
    if (!t) return;
    await createTask(t, projectId, due ? toIsoDay(due) : null, null, planned ? toIsoDay(planned) : null);
    onClose();
  };
  const active = projects.filter((p) => p.status === "active");

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="m-sheet-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
          />
          <motion.form
            className="m-sheet"
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
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="m-sheet-handle" onPointerDown={(e) => drag.start(e)}>
              <div className="m-sheet-grip" />
            </div>
            <div className="m-sheet-head" onPointerDown={(e) => drag.start(e)}>
              <b>Nouvelle tâche</b>
              <button type="button" className="icon-round" onClick={onClose} aria-label="Fermer">
                <X size={16} />
              </button>
            </div>
            <textarea
              ref={input}
              className="m-sheet-input"
              rows={2}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Que dois-tu faire ?"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void save();
                }
              }}
            />
            {active.length > 0 && (
              <ScrollChips>
                <button type="button" className={projectId == null ? "chip active" : "chip"} onClick={() => setProjectId(null)}>
                  Sans projet
                </button>
                {active.map((p) => (
                  <button type="button" key={p.id} className={projectId === p.id ? "chip active" : "chip"} onClick={() => setProjectId(p.id)}>
                    <span className="chip-dot" style={{ background: p.color }} />
                    {p.name}
                  </button>
                ))}
              </ScrollChips>
            )}
            <div className="m-sheet-dates">
              <DatePicker
                variant="chip"
                clearable
                icon={<CalendarDays size={14} className="select-chevron" aria-hidden="true" />}
                value={planned}
                onChange={setPlanned}
                chipLabel={planned ? relativeDay(toIsoDay(planned)) : "Jour prévu"}
                chipClassName="plan"
                ariaLabel="Jour prévu"
              />
              <DatePicker
                variant="chip"
                clearable
                icon={<Flag size={13} className="select-chevron" aria-hidden="true" />}
                value={due}
                onChange={setDue}
                chipLabel={due ? relativeDay(toIsoDay(due)) : "Échéance"}
                chipClassName="due"
                ariaLabel="Échéance"
              />
              <button type="submit" className="m-sheet-send" disabled={!title.trim()} aria-label="Ajouter">
                <ArrowUp size={20} strokeWidth={2.6} />
              </button>
            </div>
          </motion.form>
        </>
      )}
    </AnimatePresence>
  );
}

function Soon() {
  return (
    <div className="m-empty">
      <Bot mood="happy" size={56} />
      <b>Bientôt ici</b>
      <span className="muted small">Cet onglet arrive dans une prochaine étape.</span>
    </div>
  );
}
