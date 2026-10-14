import Database from "@tauri-apps/plugin-sql";
import { emit } from "@tauri-apps/api/event";

/**
 * À démarrer → En cours (ou en pause) → En attente de paiement → Payé (freelance),
 * ou → Terminé / Rendu (études, perso : pas d'argent en jeu).
 */
export type ProjectStatus = "todo" | "active" | "paused" | "unpaid" | "paid" | "done";

export interface Project {
  id: number;
  name: string;
  client: string;
  price: number;
  currency: string;
  status: ProjectStatus;
  /** Jours au format AAAA-MM-JJ. */
  start_date: string | null;
  deadline: string | null;
  /** Date du paiement (posée automatiquement en passant à « Payé »). */
  paid_at: string | null;
  notes: string;
  color: string;
  created_at: string;
}

export interface Task {
  id: number;
  project_id: number | null;
  title: string;
  done: number;
  /** Échéance au format AAAA-MM-JJ. */
  due_date: string | null;
  /** Extra du projet auquel la tâche appartient (null : tâche du projet de base). */
  extra_id: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface TimeEntry {
  id: number;
  project_id: number | null;
  /** ISO UTC (toISOString). */
  started_at: string;
  /** null = minuteur en cours. */
  ended_at: string | null;
  note: string;
}

export type Settings = Record<string, string>;

/** Un projet suivi en ce moment : il tourne s'il a une session ouverte, sinon il est en pause. */
export interface Timer {
  id: number;
  project_id: number | null;
  created_at: string;
}

export type FocusMode = "alert" | "block";

export interface FocusSession {
  id: number;
  project_id: number | null;
  started_at: string;
  /** null = session en cours. */
  ended_at: string | null;
  planned_minutes: number;
  /** Temps de distraction autorisé. */
  budget_minutes: number;
  mode: FocusMode;
  distraction_ms: number;
  /** JSON { "YouTube": ms, ... } */
  distractions: string;
  completed: number;
  /** En pause depuis (ISO), ou null. */
  paused_at: string | null;
  /** Temps total déjà passé en pause (pauses terminées). */
  paused_ms: number;
}

export type ReminderRepeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";

export interface Reminder {
  id: number;
  title: string;
  /** ISO UTC. */
  due_at: string;
  repeat: ReminderRepeat;
  project_id: number | null;
  done: number;
  /** due_at pour lequel la notification a déjà été envoyée. */
  notified_at: string | null;
  created_at: string;
}

export type ProjectInput = Omit<Project, "id" | "created_at" | "paid_at">;

/** Un extra (feature, module, avenant) ajouté à un projet, avec son propre prix. */
export interface Extra {
  id: number;
  project_id: number;
  title: string;
  price: number;
  done: number;
  created_at: string;
  completed_at: string | null;
}

/** Un paiement reçu pour un projet (acompte, solde…). */
export interface Payment {
  id: number;
  project_id: number;
  amount: number;
  /** Jour du paiement, AAAA-MM-JJ. */
  paid_on: string;
  note: string;
  created_at: string;
}

/** Ce que l'assistant a appris sur l'utilisateur (apprentissage). */
export interface Memory {
  id: number;
  text: string;
  created_at: string;
}

/** Toutes les fenêtres (une par écran) écoutent cet événement pour se resynchroniser. */
export const DATA_CHANGED = "data-changed";

export const PROJECT_COLORS = ["#0a84ff", "#34c759", "#ff9f0a", "#ff375f", "#bf5af2", "#64d2ff"];

let dbPromise: Promise<Database> | null = null;
function db() {
  dbPromise ??= Database.load("sqlite:megatron.db");
  return dbPromise;
}

async function write(sql: string, params: unknown[] = []) {
  const res = await (await db()).execute(sql, params);
  await emit(DATA_CHANGED);
  return res;
}

export async function listProjects() {
  return (await db()).select<Project[]>(
    "SELECT * FROM projects ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'todo' THEN 1 WHEN 'paused' THEN 2 WHEN 'unpaid' THEN 3 ELSE 4 END, created_at DESC",
  );
}

export async function listTasks() {
  // Les tâches datées d'abord (les plus proches en tête), puis les autres.
  return (await db()).select<Task[]>(
    "SELECT * FROM tasks ORDER BY done ASC, due_date IS NULL, due_date ASC, created_at DESC",
  );
}

export async function createProject(p: ProjectInput) {
  const res = await write(
    "INSERT INTO projects (name, client, price, currency, status, start_date, deadline, notes, color, paid_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $5 = 'paid' THEN datetime('now') END)",
    [p.name, p.client, p.price, p.currency, p.status, p.start_date, p.deadline, p.notes, p.color],
  );
  return res.lastInsertId as number;
}

export function updateProject(id: number, p: ProjectInput) {
  return write(
    "UPDATE projects SET name=$1, client=$2, price=$3, currency=$4, status=$5, start_date=$6, deadline=$7, notes=$8, color=$9, paid_at = CASE WHEN $5 = 'paid' THEN COALESCE(paid_at, datetime('now')) END WHERE id=$10",
    [p.name, p.client, p.price, p.currency, p.status, p.start_date, p.deadline, p.notes, p.color, id],
  );
}

/** Change seulement le statut (date de paiement posée ou retirée en conséquence). */
export function setProjectStatus(id: number, status: ProjectStatus) {
  return write(
    "UPDATE projects SET status=$1, paid_at = CASE WHEN $1 = 'paid' THEN COALESCE(paid_at, datetime('now')) END WHERE id=$2",
    [status, id],
  );
}

export async function deleteProject(id: number) {
  const d = await db();
  await d.execute("DELETE FROM tasks WHERE project_id=$1", [id]);
  await d.execute("DELETE FROM extras WHERE project_id=$1", [id]);
  await d.execute("DELETE FROM payments WHERE project_id=$1", [id]);
  // Le temps passé reste comptabilisé, juste détaché du projet.
  await d.execute("UPDATE time_entries SET ended_at=$1 WHERE ended_at IS NULL AND project_id=$2", [
    new Date().toISOString(),
    id,
  ]);
  await d.execute("DELETE FROM timers WHERE project_id=$1", [id]);
  await d.execute("UPDATE reminders SET project_id=NULL WHERE project_id=$1", [id]);
  await d.execute("UPDATE time_entries SET project_id=NULL WHERE project_id=$1", [id]);
  return write("DELETE FROM projects WHERE id=$1", [id]);
}

export function createTask(title: string, projectId: number | null, dueDate: string | null = null, extraId: number | null = null) {
  return write("INSERT INTO tasks (title, project_id, due_date, extra_id) VALUES ($1,$2,$3,$4)", [
    title,
    projectId,
    dueDate,
    extraId,
  ]);
}

export function setTaskDue(id: number, dueDate: string | null) {
  return write("UPDATE tasks SET due_date=$1 WHERE id=$2", [dueDate, id]);
}

export function toggleTask(task: Task) {
  return task.done
    ? write("UPDATE tasks SET done=0, completed_at=NULL WHERE id=$1", [task.id])
    : write("UPDATE tasks SET done=1, completed_at=datetime('now') WHERE id=$1", [task.id]);
}

export function deleteTask(id: number) {
  return write("DELETE FROM tasks WHERE id=$1", [id]);
}

// ---- Extras et paiements ----

export async function listExtras() {
  return (await db()).select<Extra[]>("SELECT * FROM extras ORDER BY created_at ASC, id ASC");
}

export async function createExtra(projectId: number, title: string, price: number) {
  const res = await write("INSERT INTO extras (project_id, title, price) VALUES ($1,$2,$3)", [projectId, title, price]);
  return res.lastInsertId as number;
}

export function updateExtra(id: number, title: string, price: number) {
  return write("UPDATE extras SET title=$1, price=$2 WHERE id=$3", [title, price, id]);
}

export function toggleExtra(extra: Extra) {
  return extra.done
    ? write("UPDATE extras SET done=0, completed_at=NULL WHERE id=$1", [extra.id])
    : write("UPDATE extras SET done=1, completed_at=datetime('now') WHERE id=$1", [extra.id]);
}

/** Supprime l'extra et ses tâches. */
export async function deleteExtra(id: number) {
  await (await db()).execute("DELETE FROM tasks WHERE extra_id=$1", [id]);
  return write("DELETE FROM extras WHERE id=$1", [id]);
}

export async function listPayments() {
  return (await db()).select<Payment[]>("SELECT * FROM payments ORDER BY paid_on ASC, id ASC");
}

export function addPayment(projectId: number, amount: number, paidOn: string, note = "") {
  return write("INSERT INTO payments (project_id, amount, paid_on, note) VALUES ($1,$2,$3,$4)", [projectId, amount, paidOn, note]);
}

export function deletePayment(id: number) {
  return write("DELETE FROM payments WHERE id=$1", [id]);
}

// ---- Suivi du temps ----

export async function listEntries() {
  return (await db()).select<TimeEntry[]>("SELECT * FROM time_entries ORDER BY started_at DESC");
}

export async function listTimers() {
  return (await db()).select<Timer[]>("SELECT * FROM timers ORDER BY created_at ASC");
}

// « project_id IS $1 » compare aussi correctement NULL (= sans projet).

/** Démarre (ou reprend) le minuteur d'un projet. Plusieurs projets peuvent tourner en même temps. */
export async function startTimer(projectId: number | null) {
  const d = await db();
  const now = new Date().toISOString();
  const existing = await d.select<Timer[]>("SELECT * FROM timers WHERE project_id IS $1", [projectId]);
  if (existing.length === 0) {
    await d.execute("INSERT INTO timers (project_id, created_at) VALUES ($1,$2)", [projectId, now]);
  }
  const open = await d.select<TimeEntry[]>(
    "SELECT * FROM time_entries WHERE ended_at IS NULL AND project_id IS $1",
    [projectId],
  );
  if (open.length === 0) {
    await d.execute("INSERT INTO time_entries (project_id, started_at) VALUES ($1,$2)", [projectId, now]);
  }
  await emit(DATA_CHANGED);
}

/** Met en pause : la session en cours se termine, le minuteur reste dans la liste. */
export function pauseTimer(projectId: number | null, at: Date = new Date()) {
  return write("UPDATE time_entries SET ended_at=$1 WHERE ended_at IS NULL AND project_id IS $2", [
    at.toISOString(),
    projectId,
  ]);
}

/** Met en pause tous les minuteurs qui tournent (pause auto). Renvoie les projets mis en pause. */
export async function pauseAll(at: Date = new Date()) {
  const open = await (await db()).select<TimeEntry[]>("SELECT * FROM time_entries WHERE ended_at IS NULL");
  await write("UPDATE time_entries SET ended_at=$1 WHERE ended_at IS NULL", [at.toISOString()]);
  return open.map((e) => e.project_id);
}

/** Reprend les minuteurs listés (ceux que la pause auto a coupés), s'ils existent encore. */
export async function resumeTimers(projectIds: (number | null)[]) {
  const tracked = new Set((await listTimers()).map((t) => t.project_id));
  for (const id of projectIds) if (tracked.has(id)) await startTimer(id);
}

/** Arrête : clôt la session et retire le minuteur. */
export async function stopTimer(projectId: number | null) {
  const d = await db();
  await d.execute("UPDATE time_entries SET ended_at=$1 WHERE ended_at IS NULL AND project_id IS $2", [
    new Date().toISOString(),
    projectId,
  ]);
  return write("DELETE FROM timers WHERE project_id IS $1", [projectId]);
}

export function deleteEntry(id: number) {
  return write("DELETE FROM time_entries WHERE id=$1", [id]);
}

// ---- Focus ----

export async function listFocusSessions() {
  return (await db()).select<FocusSession[]>("SELECT * FROM focus_sessions ORDER BY started_at DESC LIMIT 200");
}

export async function startFocus(opts: {
  projectId: number | null;
  plannedMinutes: number;
  budgetMinutes: number;
  mode: FocusMode;
}) {
  const d = await db();
  await d.execute("UPDATE focus_sessions SET ended_at=$1 WHERE ended_at IS NULL", [new Date().toISOString()]);
  await d.execute(
    "INSERT INTO focus_sessions (project_id, started_at, planned_minutes, budget_minutes, mode) VALUES ($1,$2,$3,$4,$5)",
    [opts.projectId, new Date().toISOString(), opts.plannedMinutes, opts.budgetMinutes, opts.mode],
  );
  if (opts.projectId != null) await startTimer(opts.projectId);
  await emit(DATA_CHANGED);
}

/** Sauvegarde silencieuse de la progression (pas d'événement : la fenêtre qui surveille diffuse l'état en direct). */
export async function saveFocusProgress(id: number, distractionMs: number, distractions: Record<string, number>) {
  await (await db()).execute("UPDATE focus_sessions SET distraction_ms=$1, distractions=$2 WHERE id=$3", [
    Math.round(distractionMs),
    JSON.stringify(distractions),
    id,
  ]);
}

/** Met le focus en pause : le temps s'arrête, les distractions ne comptent plus, le minuteur du projet aussi. */
export async function pauseFocus(session: FocusSession) {
  if (session.paused_at || session.ended_at) return;
  await (await db()).execute("UPDATE focus_sessions SET paused_at=$1 WHERE id=$2", [new Date().toISOString(), session.id]);
  if (session.project_id != null) await pauseTimer(session.project_id);
  await emit(DATA_CHANGED);
}

/** Reprend le focus là où il en était. */
export async function resumeFocus(session: FocusSession) {
  if (!session.paused_at || session.ended_at) return;
  const pause = Date.now() - new Date(session.paused_at).getTime();
  await (await db()).execute("UPDATE focus_sessions SET paused_at=NULL, paused_ms=paused_ms+$1 WHERE id=$2", [
    Math.max(0, Math.round(pause)),
    session.id,
  ]);
  if (session.project_id != null) await startTimer(session.project_id);
  await emit(DATA_CHANGED);
}

export async function endFocus(session: FocusSession, completed: boolean) {
  const d = await db();
  await d.execute("UPDATE focus_sessions SET ended_at=$1, completed=$2 WHERE id=$3 AND ended_at IS NULL", [
    new Date().toISOString(),
    completed ? 1 : 0,
    session.id,
  ]);
  if (session.project_id != null) await pauseTimer(session.project_id);
  await emit(DATA_CHANGED);
}

export function deleteFocusSession(id: number) {
  return write("DELETE FROM focus_sessions WHERE id=$1", [id]);
}

// ---- Rappels ----

export async function listReminders() {
  return (await db()).select<Reminder[]>("SELECT * FROM reminders ORDER BY done ASC, due_at ASC");
}

export function createReminder(r: { title: string; dueAt: Date; repeat: ReminderRepeat; projectId: number | null }) {
  return write("INSERT INTO reminders (title, due_at, repeat, project_id) VALUES ($1,$2,$3,$4)", [
    r.title,
    r.dueAt.toISOString(),
    r.repeat,
    r.projectId,
  ]);
}

/** Prochaine occurrence strictement dans le futur. */
export function nextOccurrence(from: Date, repeat: ReminderRepeat, now = new Date()) {
  const d = new Date(from);
  const step = () => {
    if (repeat === "daily") d.setDate(d.getDate() + 1);
    else if (repeat === "weekly") d.setDate(d.getDate() + 7);
    else if (repeat === "monthly") d.setMonth(d.getMonth() + 1);
    else if (repeat === "weekdays") {
      do d.setDate(d.getDate() + 1);
      while (d.getDay() === 0 || d.getDay() === 6);
    }
  };
  do step();
  while (d <= now);
  return d;
}

/** « Fait » : un rappel répété passe à sa prochaine occurrence, sinon il est terminé. */
export function completeReminder(r: Reminder) {
  if (r.repeat === "none") return write("UPDATE reminders SET done=1 WHERE id=$1", [r.id]);
  return write("UPDATE reminders SET due_at=$1, notified_at=NULL WHERE id=$2", [
    nextOccurrence(new Date(r.due_at), r.repeat).toISOString(),
    r.id,
  ]);
}

export function snoozeReminder(r: Reminder, minutes: number) {
  return write("UPDATE reminders SET due_at=$1, notified_at=NULL WHERE id=$2", [
    new Date(Date.now() + minutes * 60_000).toISOString(),
    r.id,
  ]);
}

export function markReminderNotified(r: Reminder) {
  return write("UPDATE reminders SET notified_at=due_at WHERE id=$1", [r.id]);
}

export function deleteReminder(id: number) {
  return write("DELETE FROM reminders WHERE id=$1", [id]);
}

// ---- Mémoire de l'assistant ----

export async function listMemories() {
  return (await db()).select<Memory[]>("SELECT * FROM memories ORDER BY created_at ASC, id ASC");
}

export function addMemory(text: string) {
  return write("INSERT INTO memories (text) VALUES ($1)", [text]);
}

export function deleteMemory(id: number) {
  return write("DELETE FROM memories WHERE id=$1", [id]);
}

export function clearMemories() {
  return write("DELETE FROM memories");
}

// ---- Conversation avec l'assistant (gardée d'une session à l'autre) ----

/** JSON de la conversation, ou null s'il n'y en a pas. */
export async function loadConversation(): Promise<string | null> {
  const rows = await (await db()).select<{ data: string }[]>("SELECT data FROM conversation WHERE id = 1");
  return rows[0]?.data ?? null;
}

/** Sans événement DATA_CHANGED : les fenêtres se synchronisent déjà en direct. */
export async function saveConversation(data: string) {
  await (await db()).execute(
    "INSERT INTO conversation (id, data, updated_at) VALUES (1, $1, datetime('now')) ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
    [data],
  );
}

// ---- Réglages ----

export async function listSettings(): Promise<Settings> {
  const rows = await (await db()).select<{ key: string; value: string }[]>("SELECT * FROM settings");
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function setSetting(key: string, value: string) {
  return write(
    "INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, value],
  );
}

// ---- Sauvegarde / restauration ----

const nowSql = () => new Date().toISOString().slice(0, 19).replace("T", " ");

export interface Backup {
  app: "megatron";
  version: 8;
  exported_at: string;
  projects: Project[];
  tasks: Task[];
  time_entries: TimeEntry[];
  timers: Timer[];
  focus_sessions: FocusSession[];
  reminders: Reminder[];
  memories?: Memory[];
  extras?: Extra[];
  payments?: Payment[];
  settings: Settings;
}

export async function exportBackup(): Promise<Backup> {
  const [projects, tasks, time_entries, timers, focus_sessions, reminders, settings, memories, extras, payments] = await Promise.all([
    listProjects(),
    listTasks(),
    listEntries(),
    listTimers(),
    (await db()).select<FocusSession[]>("SELECT * FROM focus_sessions ORDER BY started_at"),
    listReminders(),
    listSettings(),
    listMemories(),
    listExtras(),
    listPayments(),
  ]);
  return {
    app: "megatron",
    version: 8,
    exported_at: new Date().toISOString(),
    projects,
    tasks,
    time_entries,
    timers,
    focus_sessions,
    reminders,
    memories,
    extras,
    payments,
    settings,
  };
}

/** Remplace toutes les données par celles du fichier (les ids sont conservés). */
export async function importBackup(raw: unknown) {
  const b = raw as Partial<Backup>;
  if (b?.app !== "megatron" || !Array.isArray(b.projects) || !Array.isArray(b.tasks)) {
    throw new Error("Ce fichier n'est pas une sauvegarde Mégatron.");
  }
  const d = await db();
  await d.execute("DELETE FROM memories");
  await d.execute("DELETE FROM payments");
  await d.execute("DELETE FROM tasks");
  await d.execute("DELETE FROM extras");
  await d.execute("DELETE FROM reminders");
  await d.execute("DELETE FROM focus_sessions");
  await d.execute("DELETE FROM timers");
  await d.execute("DELETE FROM time_entries");
  await d.execute("DELETE FROM settings");
  await d.execute("DELETE FROM tasks");
  await d.execute("DELETE FROM projects");
  for (const p of b.projects) {
    await d.execute(
      "INSERT INTO projects (id, name, client, price, currency, status, start_date, deadline, paid_at, notes, color, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [p.id, p.name, p.client ?? "", p.price ?? 0, p.currency ?? "EUR",
        (p.status as string) === "done" ? "unpaid" : (p.status ?? "active"), p.start_date ?? null,
        p.deadline ?? null, p.paid_at ?? null, p.notes ?? "", p.color ?? PROJECT_COLORS[0], p.created_at ?? nowSql()],
    );
  }
  for (const x of Array.isArray(b.extras) ? b.extras : []) {
    await d.execute(
      "INSERT INTO extras (id, project_id, title, price, done, created_at, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [x.id, x.project_id, x.title, x.price ?? 0, x.done ? 1 : 0, x.created_at ?? nowSql(), x.completed_at ?? null],
    );
  }
  for (const pay of Array.isArray(b.payments) ? b.payments : []) {
    await d.execute(
      "INSERT INTO payments (id, project_id, amount, paid_on, note, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [pay.id, pay.project_id, pay.amount, pay.paid_on, pay.note ?? "", pay.created_at ?? nowSql()],
    );
  }
  for (const t of b.tasks) {
    await d.execute(
      "INSERT INTO tasks (id, project_id, title, done, due_date, extra_id, created_at, completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [t.id, t.project_id ?? null, t.title, t.done ? 1 : 0, t.due_date ?? null, t.extra_id ?? null, t.created_at ?? nowSql(),
        t.completed_at ?? null],
    );
  }
  // Les sauvegardes v1 n'ont ni temps ni réglages.
  const entries = Array.isArray(b.time_entries) ? b.time_entries : [];
  for (const e of entries) {
    await d.execute(
      "INSERT INTO time_entries (id, project_id, started_at, ended_at, note) VALUES ($1,$2,$3,$4,$5)",
      [e.id, e.project_id ?? null, e.started_at, e.ended_at ?? null, e.note ?? ""],
    );
  }
  // Les sauvegardes v2 n'ont pas de minuteurs : on en recrée un par session restée ouverte.
  const timers: Pick<Timer, "project_id" | "created_at">[] = Array.isArray(b.timers)
    ? b.timers
    : entries.filter((e) => !e.ended_at).map((e) => ({ project_id: e.project_id, created_at: e.started_at }));
  for (const t of timers) {
    await d.execute("INSERT INTO timers (project_id, created_at) VALUES ($1,$2)", [t.project_id ?? null, t.created_at]);
  }
  for (const f of Array.isArray(b.focus_sessions) ? b.focus_sessions : []) {
    await d.execute(
      "INSERT INTO focus_sessions (id, project_id, started_at, ended_at, planned_minutes, budget_minutes, mode, distraction_ms, distractions, completed, paused_at, paused_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
      [f.id, f.project_id ?? null, f.started_at, f.ended_at ?? null, f.planned_minutes, f.budget_minutes,
        f.mode ?? "alert", f.distraction_ms ?? 0, f.distractions ?? "{}", f.completed ? 1 : 0, f.paused_at ?? null,
        f.paused_ms ?? 0],
    );
  }
  for (const r of Array.isArray(b.reminders) ? b.reminders : []) {
    await d.execute(
      "INSERT INTO reminders (id, title, due_at, repeat, project_id, done, notified_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [r.id, r.title, r.due_at, r.repeat ?? "none", r.project_id ?? null, r.done ? 1 : 0, r.notified_at ?? null,
        r.created_at ?? nowSql()],
    );
  }
  for (const m of Array.isArray(b.memories) ? b.memories : []) {
    await d.execute("INSERT INTO memories (id, text, created_at) VALUES ($1,$2,$3)", [m.id, m.text, m.created_at ?? nowSql()]);
  }
  for (const [key, value] of Object.entries(b.settings ?? {})) {
    await d.execute("INSERT INTO settings (key, value) VALUES ($1,$2)", [key, String(value)]);
  }
  await emit(DATA_CHANGED);
  return { projects: b.projects.length, tasks: b.tasks.length, entries: entries.length };
}
