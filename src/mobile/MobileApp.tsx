import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlarmClock, AlertTriangle, Bot as BotIcon, ChevronLeft, FolderKanban, ListChecks, Plus, Settings2, Sun, Target } from "lucide-react";
import { useData, type Data } from "../useData";
import { WRITE_ERROR } from "../db";
import { useTheme } from "../theme";
import { Bot } from "../components/Bot";
import { ScrollChips } from "../components/ScrollChips";
import { TaskList } from "../views/TaskList";
import { Projects } from "../views/Projects";
import { ProgressRing } from "../views/Today";
import { MobileSettings } from "./MobileSettings";
import { MobileFocus } from "./MobileFocus";
import { MobileChat } from "./MobileChat";
import { useBack } from "./useBack";
import { MobileSheets, openAddTask } from "./sheets";
import { MobileOnboarding, needsOnboarding } from "./MobileOnboarding";
import { native } from "./native";
import { Time } from "../views/Time";
import { Reminders } from "../views/Reminders";
import { useNativeSync } from "./useNativeSync";
import { isTaskLate, lateByProject, taskBucket } from "../projects";

/**
 * Application Android : une seule fenêtre plein écran, des onglets en bas et un bouton « + » à portée de pouce.
 * Rappels et Réglages s'ouvrent depuis l'en-tête (réveil, réglages), avec un retour.
 */
const TABS = [
  { id: "today", label: "Aujourd'hui", icon: Sun },
  { id: "tasks", label: "Tâches", icon: ListChecks },
  { id: "projects", label: "Projets", icon: FolderKanban },
  { id: "focus", label: "Focus", icon: Target },
  { id: "ai", label: "IA", icon: BotIcon },
] as const;
type TabId = (typeof TABS)[number]["id"];
type Page = TabId | "reminders" | "settings";
const PAGE_TITLE: Record<Page, string> = {
  today: "Aujourd'hui",
  tasks: "Tâches",
  projects: "Projets",
  focus: "Focus",
  ai: "IA",
  reminders: "Rappels",
  settings: "Réglages",
};

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function MobileApp() {
  const data = useData();
  useTheme(data.settings);
  useNativeSync();
  const now = useNow();
  const [tab, setTab] = useState<TabId>("today");
  // Page ouverte par-dessus les onglets (Rappels, Réglages), sinon l'onglet courant.
  const [sub, setSub] = useState<"reminders" | "settings" | null>(null);
  const [focusView, setFocusView] = useState<"focus" | "time">("focus");
  // Écran de démarrage d'Android : il part dès que les vraies données sont affichées.
  const firstSettings = useRef(data.settings);
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || data.settings === firstSettings.current || !("__TAURI_INTERNALS__" in window)) return;
    announced.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => void native("appReady").catch(() => {})));
  }, [data.settings]);
  // Écriture en échec : message visible quelques secondes (sinon le formulaire reste ouvert sans explication).
  const [writeError, setWriteError] = useState<string | null>(null);
  useEffect(() => {
    let timer: number | undefined;
    const onError = (e: Event) => {
      setWriteError((e as CustomEvent<string>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setWriteError(null), 9000);
    };
    window.addEventListener(WRITE_ERROR, onError);
    return () => window.removeEventListener(WRITE_ERROR, onError);
  }, []);
  // Présentation au premier lancement, décidée une fois les réglages lus.
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useEffect(() => {
    if (onboarding !== null || data.settings === firstSettings.current) return;
    setOnboarding(needsOnboarding(data.settings));
  }, [data.settings]);
  // Widgets : « + » ouvre l'ajout de tâche, Focus et Prochain rappel ouvrent leur page.
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const check = () =>
      native<{ action: string | null }>("takeLaunchAction")
        .then((r) => {
          if (r.action === "add") {
            setSub(null);
            setTab("today");
            openAddTask({ plannedToday: true });
          } else if (r.action === "focus") {
            setSub(null);
            setTab("focus");
            setFocusView("focus");
          } else if (r.action === "reminders") {
            setSub("reminders");
          }
        })
        .catch(() => {});
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  // Retour Android : ferme la page ouverte, puis revient à Aujourd'hui, puis quitte l'appli.
  useBack(tab !== "today", () => setTab("today"));
  useBack(sub !== null, () => setSub(null));
  const page: Page = sub ?? tab;
  // Chaque page s'ouvre en haut (la zone de défilement est partagée entre les onglets).
  const contentRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [page]);
  const showFab = !sub && (tab === "today" || tab === "tasks");
  const remindersToday = data.reminders.filter((r) => !r.done && new Date(r.due_at).toDateString() === now.toDateString()).length;

  return (
    <div className="m-shell">
      <header className="m-head">
        {sub && (
          <button className="m-back" onClick={() => setSub(null)} aria-label="Retour">
            <ChevronLeft size={24} />
          </button>
        )}
        <span className="m-title">{PAGE_TITLE[page]}</span>
        <div className="m-head-actions">
          <button
            className={sub === "reminders" ? "m-head-btn active" : "m-head-btn"}
            onClick={() => setSub(sub === "reminders" ? null : "reminders")}
            aria-label="Rappels"
          >
            <AlarmClock size={21} />
            {remindersToday > 0 && <span className="m-badge">{remindersToday}</span>}
          </button>
          <button
            className={sub === "settings" ? "m-head-btn active" : "m-head-btn"}
            onClick={() => setSub(sub === "settings" ? null : "settings")}
            aria-label="Réglages"
          >
            <Settings2 size={21} />
          </button>
        </div>
      </header>

      <main className="m-content" ref={contentRef}>
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            className={page === "ai" ? "m-page m-page-chat" : "m-page"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.08 } }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            {page === "today" && <TodayPage {...data} />}
            {page === "tasks" && <TasksPage {...data} />}
            {page === "projects" && <Projects {...data} />}
            {page === "focus" && (
              <>
                <div className="segmented m-segmented">
                  {(["focus", "time"] as const).map((v) => (
                    <button key={v} className={focusView === v ? "seg active" : "seg"} onClick={() => setFocusView(v)}>
                      <span className="tab-label">{v === "focus" ? "Focus" : "Temps"}</span>
                    </button>
                  ))}
                </div>
                {focusView === "focus" ? <MobileFocus {...data} /> : <Time {...data} now={now} />}
              </>
            )}
            {page === "ai" && <MobileChat {...data} />}
            {page === "reminders" && <Reminders {...data} now={now} />}
            {page === "settings" && <MobileSettings {...data} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {showFab && (
          <motion.button
            className="m-fab"
            onClick={() => openAddTask({ plannedToday: tab === "today" })}
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
      <MobileSheets tasks={data.tasks} projects={data.projects} />
      <AnimatePresence>
        {writeError && (
          <motion.div
            className="m-toast"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            onClick={() => setWriteError(null)}
          >
            <AlertTriangle size={18} />
            <span>{writeError}</span>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {onboarding && <MobileOnboarding key="onboarding" settings={data.settings} onDone={() => setOnboarding(false)} />}
      </AnimatePresence>

      <nav className="m-tabs" aria-label="Sections">
        {TABS.map(({ id, label, icon: Icon }) => {
          const on = !sub && id === tab;
          return (
            <button
              key={id}
              className={on ? "m-tab active" : "m-tab"}
              onClick={() => {
                setTab(id);
                setSub(null);
              }}
              aria-current={on ? "page" : undefined}
            >
              <span className="m-tab-icon">
                {on && <motion.span layoutId="m-tab-pill" className="m-tab-pill" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <Icon size={21} strokeWidth={on ? 2.4 : 2} />
              </span>
              <span className="m-tab-label">{label}</span>
            </button>
          );
        })}
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
                .map(([id, n]) => `${id == null ? "Sans projet" : nameOf.get(id)}${late.groups.length > 1 ? ` (${n})` : ""}`)
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
