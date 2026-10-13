/**
 * Données d'exemple pour prévisualiser l'interface dans un navigateur (hors Tauri, en dev uniquement).
 * Jamais utilisées dans l'app : la vraie base est SQLite.
 */
import type { FocusSession, Project, Reminder, Settings, Task, TimeEntry, Timer } from "../db";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const inMin = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();
const sqlAgo = (minutes: number) => ago(minutes).slice(0, 19).replace("T", " ");
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const SAMPLE_PROJECTS: Project[] = [
  { id: 1, name: "Site vitrine Atelier Lune", client: "Atelier Lune", price: 2400, currency: "EUR", status: "active", start_date: null, paid_at: null, deadline: day(4), notes: "Maquettes validées, reste l'intégration.", color: "#0a84ff", created_at: sqlAgo(9000) },
  { id: 2, name: "Identité visuelle Brasserie", client: "La Mousse", price: 1200, currency: "EUR", status: "active", start_date: null, paid_at: null, deadline: day(12), notes: "", color: "#ff9f0a", created_at: sqlAgo(6000) },
  { id: 3, name: "Appli de réservation", client: "Studio Nova", price: 5800, currency: "EUR", status: "paused", start_date: null, paid_at: null, deadline: null, notes: "En attente du contenu client.", color: "#bf5af2", created_at: sqlAgo(20000) },
  { id: 4, name: "Logo Atelier Lune", client: "Atelier Lune", price: 800, currency: "EUR", status: "paid", start_date: null, paid_at: sqlAgo(30000), deadline: null, notes: "", color: "#34c759", created_at: sqlAgo(60000) },
  { id: 5, name: "Menu La Mousse", client: "La Mousse", price: 450, currency: "EUR", status: "unpaid", start_date: null, paid_at: null, deadline: null, notes: "", color: "#ff375f", created_at: sqlAgo(15000) },
];

export const SAMPLE_TASKS: Task[] = [
  { id: 1, project_id: 1, title: "Intégrer la page d'accueil", done: 0, due_date: null, created_at: sqlAgo(300), completed_at: null },
  { id: 2, project_id: 1, title: "Formulaire de contact", done: 0, due_date: null, created_at: sqlAgo(280), completed_at: null },
  { id: 3, project_id: 2, title: "Envoyer 3 pistes de logo", done: 1, due_date: null, created_at: sqlAgo(900), completed_at: sqlAgo(60) },
  { id: 4, project_id: null, title: "Relancer la facture de mars", done: 0, due_date: null, created_at: sqlAgo(120), completed_at: null },
  { id: 5, project_id: 2, title: "Choisir la typographie", done: 0, due_date: null, created_at: sqlAgo(100), completed_at: null },
  { id: 6, project_id: 1, title: "Optimiser les images", done: 1, due_date: null, created_at: sqlAgo(2000), completed_at: sqlAgo(1500) },
];

export const SAMPLE_ENTRIES: TimeEntry[] = [
  { id: 1, project_id: 1, started_at: ago(52), ended_at: null, note: "" },
  { id: 2, project_id: 1, started_at: ago(240), ended_at: ago(130), note: "" },
  { id: 3, project_id: 2, started_at: ago(400), ended_at: ago(330), note: "" },
  { id: 4, project_id: 2, started_at: ago(1600), ended_at: ago(1450), note: "" },
  { id: 5, project_id: 1, started_at: ago(2900), ended_at: ago(2700), note: "" },
  { id: 6, project_id: null, started_at: ago(3000), ended_at: ago(2960), note: "" },
  { id: 7, project_id: 3, started_at: ago(4400), ended_at: ago(4200), note: "" },
];

export const SAMPLE_TIMERS: Timer[] = [
  { id: 1, project_id: 1, created_at: ago(52) },
  { id: 2, project_id: 2, created_at: ago(400) },
];

export const SAMPLE_REMINDERS: Reminder[] = [
  { id: 1, title: "Appel avec Atelier Lune", due_at: inMin(90), repeat: "none", project_id: 1, done: 0, notified_at: null, created_at: sqlAgo(600) },
  { id: 2, title: "Point hebdo", due_at: inMin(60 * 24 + 30), repeat: "weekly", project_id: null, done: 0, notified_at: null, created_at: sqlAgo(9000) },
  { id: 3, title: "Envoyer le devis", due_at: ago(600), repeat: "none", project_id: 2, done: 1, notified_at: ago(600), created_at: sqlAgo(1200) },
];

export const SAMPLE_FOCUS: FocusSession[] = [
  { id: 1, project_id: 1, started_at: ago(200), ended_at: ago(150), planned_minutes: 50, budget_minutes: 5, mode: "alert", distraction_ms: 140_000, distractions: '{"youtube":140000}', completed: 1 },
];

export const SAMPLE_SETTINGS: Settings = { focus_summary_seen: "1" };
