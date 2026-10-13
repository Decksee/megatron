import type { Project, ProjectStatus } from "./db";

/** Les statuts d'un projet, dans l'ordre de sa vie. */
export const STATUSES: { value: ProjectStatus; label: string; color: string }[] = [
  { value: "todo", label: "À démarrer", color: "#64d2ff" },
  { value: "active", label: "En cours", color: "#30d158" },
  { value: "paused", label: "En pause", color: "#ff9f0a" },
  { value: "unpaid", label: "Attente de paiement", color: "#ff6482" },
  { value: "paid", label: "Payé", color: "#8e8e93" },
];

export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.value, s.label])) as Record<ProjectStatus, string>;
export const STATUS_COLOR = Object.fromEntries(STATUSES.map((s) => [s.value, s.color])) as Record<ProjectStatus, string>;

/** Le travail n'est pas fini : on peut encore y passer du temps ou y ajouter des tâches. */
export const isOpen = (p: Pick<Project, "status">) => p.status === "todo" || p.status === "active" || p.status === "paused";

/** "2026-10-18" <-> Date locale (sans décalage de fuseau). */
export const fromIsoDay = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const toIsoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const formatDay = (iso: string) => fromIsoDay(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });

/** « Aujourd'hui », « Demain », « Hier », sinon « 18 oct. ». */
export function relativeDay(iso: string, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((fromIsoDay(iso).getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return "Demain";
  if (diff === -1) return "Hier";
  return formatDay(iso);
}

export const isOverdue = (iso: string, now = new Date()) => iso < toIsoDay(now);

export const formatMoney = (value: number, currency = "EUR") =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export interface ClientSummary {
  name: string;
  projects: Project[];
  /** Montants par devise. */
  paid: Record<string, number>;
  pending: Record<string, number>;
  ongoing: Record<string, number>;
  lastActivity: string;
}

const add = (m: Record<string, number>, p: Project) => {
  m[p.currency] = (m[p.currency] ?? 0) + p.price;
};

/** Les clients, déduits des projets (même nom, sans tenir compte de la casse). */
export function clientSummaries(projects: Project[]): ClientSummary[] {
  const byKey = new Map<string, ClientSummary>();
  for (const p of projects) {
    const name = p.client.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("fr");
    let c = byKey.get(key);
    if (!c) {
      c = { name, projects: [], paid: {}, pending: {}, ongoing: {}, lastActivity: p.created_at };
      byKey.set(key, c);
    }
    c.projects.push(p);
    if (p.status === "paid") add(c.paid, p);
    else if (p.status === "unpaid") add(c.pending, p);
    else add(c.ongoing, p);
    const last = p.paid_at ?? p.created_at;
    if (last > c.lastActivity) c.lastActivity = last;
  }
  const total = (c: ClientSummary) => Object.values(c.paid).reduce((s, v) => s + v, 0);
  return [...byKey.values()].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name));
}

/** Noms de clients déjà utilisés, pour l'autocomplétion. */
export const clientNames = (projects: Project[]) => clientSummaries(projects).map((c) => c.name);

/** « 1 200 € + 300 $ » */
export const formatAmounts = (m: Record<string, number>) => {
  const parts = Object.entries(m).filter(([, v]) => v > 0);
  return parts.length ? parts.map(([cur, v]) => formatMoney(v, cur)).join(" + ") : formatMoney(0);
};
