import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  DATA_CHANGED,
  listEntries,
  listFocusSessions,
  listMemories,
  listProjects,
  listReminders,
  listSettings,
  listTasks,
  listTimers,
  type FocusSession,
  type Memory,
  type Project,
  type Reminder,
  type Settings,
  type Task,
  type TimeEntry,
  type Timer,
} from "./db";

/** Toutes les données, rechargées dès qu'une fenêtre (n'importe quel écran) modifie la base. */
export function useData() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [settings, setSettings] = useState<Settings>({});
  const [timers, setTimers] = useState<Timer[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);

  const reload = useCallback(async () => {
    const [p, t, e, s, tm, f, r, m] = await Promise.all([
      listProjects(),
      listTasks(),
      listEntries(),
      listSettings(),
      listTimers(),
      listFocusSessions(),
      listReminders(),
      listMemories(),
    ]);
    setProjects(p);
    setTasks(t);
    setEntries(e);
    setSettings(s);
    setTimers(tm);
    setFocusSessions(f);
    setReminders(r);
    setMemories(m);
  }, []);

  useEffect(() => {
    // Aperçu dans un navigateur (dev) : données d'exemple, pas de base.
    if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
      import("./dev/sample").then((d) => {
        setProjects(d.SAMPLE_PROJECTS);
        setTasks(d.SAMPLE_TASKS);
        setEntries(d.SAMPLE_ENTRIES);
        setSettings(d.SAMPLE_SETTINGS);
        setTimers(d.SAMPLE_TIMERS);
        setFocusSessions(d.SAMPLE_FOCUS);
        setReminders(d.SAMPLE_REMINDERS);
      });
      return;
    }
    reload().catch(console.error);
    const unlisten = listen(DATA_CHANGED, () => reload().catch(console.error));
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [reload]);

  return { projects, tasks, entries, settings, timers, focusSessions, reminders, memories };
}

export type Data = ReturnType<typeof useData>;
