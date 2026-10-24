import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Bot as BotIcon, FolderKanban, ListChecks, Settings2, Sun } from "lucide-react";
import { useData, type Data } from "../useData";
import { useTheme } from "../theme";
import { Bot } from "../components/Bot";
import { TaskList } from "../views/TaskList";
import { isTaskLate, lateByProject, taskBucket } from "../projects";

/**
 * Application Android : une seule fenêtre plein écran, des onglets en bas (à portée de pouce).
 * Étape 1 : Aujourd'hui et Tâches ; les autres onglets arrivent ensuite.
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
  const [tab, setTab] = useState<TabId>("today");

  return (
    <div className="m-shell">
      <header className="m-head">
        <Bot mood="idle" size={26} />
        <span className="m-title">{TABS.find((t) => t.id === tab)!.label}</span>
      </header>

      <main className="m-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            className="m-page"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.18 }}
          >
            {tab === "today" && <TodayPage {...data} />}
            {tab === "tasks" && <TaskList tasks={data.tasks} projects={data.projects} projectId={null} showProject />}
            {tab !== "today" && tab !== "tasks" && <Soon />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="m-tabs" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={id === tab ? "m-tab active" : "m-tab"} onClick={() => setTab(id)} aria-current={id === tab ? "page" : undefined}>
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Aujourd'hui : retards en tête, puis les tâches du jour, avec ajout rapide. */
function TodayPage({ tasks, projects }: Data) {
  const now = new Date();
  const today = tasks.filter((t) => !t.done && taskBucket(t, now) === "today");
  const late = lateByProject(tasks, now);
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const doneToday = tasks.filter((t) => t.done && t.completed_at && new Date(t.completed_at + "Z").toDateString() === now.toDateString());
  const shown = [...today.sort((a, b) => Number(isTaskLate(b, now)) - Number(isTaskLate(a, now))), ...doneToday];

  return (
    <div className="m-today">
      <div className="m-greeting">
        <span className="m-date">{now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
        <b>
          {today.length ? `${today.length} tâche${today.length > 1 ? "s" : ""} aujourd'hui` : "Rien de prévu aujourd'hui"}
        </b>
      </div>
      {late.total > 0 && (
        <div className="late-banner m-late">
          <AlertTriangle size={14} />
          <span>
            <b>
              {late.total} en retard
            </b>
            {" · "}
            {late.groups
              .slice(0, 3)
              .map(([id, n]) => `${id == null ? "sans projet" : nameOf.get(id)} ${n}`)
              .join(" · ")}
          </span>
        </div>
      )}
      <TaskList tasks={shown} projects={projects} projectId={null} showProject compact plannedToday placeholder="Ajouter une tâche pour aujourd'hui…" />
    </div>
  );
}

function Soon() {
  return (
    <div className="m-soon">
      <Bot mood="happy" size={56} />
      <b>Bientôt ici</b>
      <span className="muted small">Cet onglet arrive dans une prochaine étape.</span>
    </div>
  );
}
