import { addPayment, setProjectStatus, type Extra, type Payment, type Project, type ProjectStatus, type Settings } from "./db";

// ---------- Type d'usage ----------

/** Pour qui sont les projets : des clients (freelance), des cours (études) ou soi-même (perso). */
export type Usage = "freelance" | "studies" | "personal";

export interface UsageProfile {
  label: string;
  hint: string;
  /** Libellé du champ « client » (null : champ masqué). */
  clientLabel: string | null;
  clientPlaceholder: string;
  /** Nom de l'espace qui regroupe les projets par client (null : pas d'espace). */
  clientsLabel: string | null;
  /** Prix, devise, extras et paiements. */
  money: boolean;
  statuses: ProjectStatus[];
  doneLabel: string;
  deadlineLabel: string;
  nextDeadlineLabel: string;
  noDeadline: string;
}

export const USAGES: Record<Usage, UsageProfile> = {
  freelance: {
    label: "Freelance",
    hint: "Projets clients, prix et paiements.",
    clientLabel: "Client",
    clientPlaceholder: "Nom du client",
    clientsLabel: "Clients",
    money: true,
    statuses: ["todo", "active", "paused", "unpaid", "paid"],
    doneLabel: "Terminé",
    deadlineLabel: "Deadline",
    nextDeadlineLabel: "Prochaine deadline",
    noDeadline: "Pas de deadline",
  },
  studies: {
    label: "Études",
    hint: "Projets de cours, par matière, avec leurs dates de rendu.",
    clientLabel: "Matière / cours",
    clientPlaceholder: "Ex. : Marketing, Maths…",
    clientsLabel: "Matières",
    money: false,
    statuses: ["todo", "active", "paused", "done"],
    doneLabel: "Rendu",
    deadlineLabel: "Date de rendu",
    nextDeadlineLabel: "Prochain rendu",
    noDeadline: "Pas de date de rendu",
  },
  personal: {
    label: "Perso",
    hint: "Tes projets à toi, sans client ni prix.",
    clientLabel: null,
    clientPlaceholder: "",
    clientsLabel: null,
    money: false,
    statuses: ["todo", "active", "paused", "done"],
    doneLabel: "Terminé",
    deadlineLabel: "Échéance",
    nextDeadlineLabel: "Prochaine échéance",
    noDeadline: "Pas d'échéance",
  },
};

export const usageOf = (settings: Settings): Usage => {
  const u = settings.usage as Usage | undefined;
  return u && u in USAGES ? u : "freelance";
};
export const usageProfile = (settings: Settings) => USAGES[usageOf(settings)];

// ---------- Statuts ----------

const STATUS_META: Record<ProjectStatus, { label: string; color: string }> = {
  todo: { label: "À démarrer", color: "#64d2ff" },
  active: { label: "En cours", color: "#30d158" },
  paused: { label: "En pause", color: "#ff9f0a" },
  unpaid: { label: "Attente de paiement", color: "#ff6482" },
  paid: { label: "Payé", color: "#8e8e93" },
  done: { label: "Terminé", color: "#8e8e93" },
};

/** Les statuts proposés pour ce type d'usage, dans l'ordre de la vie d'un projet. */
export const statusesFor = (profile: UsageProfile) =>
  profile.statuses.map((value) => ({ value, label: statusLabel(profile, value), color: STATUS_META[value].color }));

/**
 * Libellé d'un statut selon le type d'usage : sans argent en jeu, « Attente de paiement » et « Payé »
 * (projets créés avant de changer de type) s'affichent comme terminés.
 */
export function statusLabel(profile: UsageProfile, status: ProjectStatus) {
  if (status === "done" || (!profile.money && (status === "unpaid" || status === "paid"))) return profile.doneLabel;
  return STATUS_META[status]?.label ?? status;
}

/** Statut tel qu'on le filtre et le regroupe (sans argent : payé = attente = terminé). */
export const displayStatus = (profile: UsageProfile, status: ProjectStatus): ProjectStatus =>
  !profile.money && (status === "unpaid" || status === "paid") ? "done" : status;

export const statusColor = (status: ProjectStatus) => STATUS_META[status]?.color ?? "#8e8e93";

/** Compatibilité : libellés « freelance » (IA, Telegram). */
export const STATUS_LABEL = Object.fromEntries(
  (Object.keys(STATUS_META) as ProjectStatus[]).map((s) => [s, STATUS_META[s].label]),
) as Record<ProjectStatus, string>;

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

/**
 * Où ranger une tâche à faire :
 * « today » : prévue aujourd'hui ou avant (reportée), ou dont l'échéance est aujourd'hui ou dépassée ;
 * « later » : prévue (ou à rendre) un jour suivant ; « none » : ni jour prévu ni échéance.
 */
export function taskBucket(t: { planned_date: string | null; due_date: string | null }, now = new Date()) {
  const today = toIsoDay(now);
  if ((t.planned_date && t.planned_date <= today) || (t.due_date && t.due_date <= today)) return "today";
  if (t.planned_date || t.due_date) return "later";
  return "none";
}

export const formatMoney = (value: number, currency = "EUR") =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

// ---------- Argent : prix total, payé, reste ----------

/** Ce qu'il faut pour calculer l'argent d'un projet. */
export interface Ledger {
  extras: Extra[];
  payments: Payment[];
}

export interface ProjectMoney {
  base: number;
  extras: number;
  total: number;
  paid: number;
  /** Reste dû (jamais négatif). */
  remaining: number;
  /** Part déjà payée (0 à 1). */
  ratio: number;
}

/** Prix total (base + extras), déjà payé et reste dû pour un projet. */
export function projectMoney(p: Project, ledger: Ledger): ProjectMoney {
  const extras = ledger.extras.filter((x) => x.project_id === p.id).reduce((s, x) => s + x.price, 0);
  const paid = ledger.payments.filter((x) => x.project_id === p.id).reduce((s, x) => s + x.amount, 0);
  const total = p.price + extras;
  const remaining = Math.max(0, Math.round((total - paid) * 100) / 100);
  return { base: p.price, extras, total, paid, remaining, ratio: total > 0 ? Math.min(1, paid / total) : 0 };
}

/** Travail livré, en attente d'argent (ce qu'on te doit). */
const delivered = (p: Project) => p.status === "unpaid" || p.status === "paid" || p.status === "done";

const addTo = (m: Record<string, number>, currency: string, value: number) => {
  if (value > 0) m[currency] = (m[currency] ?? 0) + value;
};

/**
 * Totaux d'une liste de projets, par devise :
 * - encaissé : l'argent vraiment reçu ;
 * - à encaisser : ce qui reste dû sur le travail livré ;
 * - en cours : ce qui reste à gagner sur les projets pas encore livrés ;
 * - dû : tout ce qui reste à recevoir, livré ou non (en cours + à encaisser).
 */
export function moneyTotals(projects: Project[], ledger: Ledger) {
  const paid: Record<string, number> = {};
  const pending: Record<string, number> = {};
  const ongoing: Record<string, number> = {};
  const total: Record<string, number> = {};
  const owed: Record<string, number> = {};
  for (const p of projects) {
    const m = projectMoney(p, ledger);
    addTo(paid, p.currency, m.paid);
    addTo(total, p.currency, m.total);
    addTo(delivered(p) ? pending : ongoing, p.currency, m.remaining);
    addTo(owed, p.currency, m.remaining);
  }
  return { paid, pending, ongoing, total, owed };
}

/** Projets dont il reste de l'argent à recevoir pour du travail livré. */
export const awaitingPayment = (projects: Project[], ledger: Ledger) =>
  projects.filter((p) => delivered(p) && projectMoney(p, ledger).remaining > 0);

export interface ClientSummary {
  name: string;
  projects: Project[];
  /** Montants par devise. */
  paid: Record<string, number>;
  pending: Record<string, number>;
  ongoing: Record<string, number>;
  lastActivity: string;
}

const NO_LEDGER: Ledger = { extras: [], payments: [] };

/** Les clients, déduits des projets (même nom, sans tenir compte de la casse). */
export function clientSummaries(projects: Project[], ledger: Ledger = NO_LEDGER): ClientSummary[] {
  const byKey = new Map<string, { name: string; projects: Project[]; lastActivity: string }>();
  for (const p of projects) {
    const name = p.client.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("fr");
    let c = byKey.get(key);
    if (!c) {
      c = { name, projects: [], lastActivity: p.created_at };
      byKey.set(key, c);
    }
    c.projects.push(p);
    const last = p.paid_at ?? p.created_at;
    if (last > c.lastActivity) c.lastActivity = last;
  }
  const summaries = [...byKey.values()].map((c) => {
    const t = moneyTotals(c.projects, ledger);
    return { ...c, paid: t.paid, pending: t.pending, ongoing: t.ongoing };
  });
  const sum = (m: Record<string, number>) => Object.values(m).reduce((s, v) => s + v, 0);
  return summaries.sort((a, b) => sum(b.paid) - sum(a.paid) || a.name.localeCompare(b.name));
}

/** Noms de clients déjà utilisés, pour l'autocomplétion. */
export const clientNames = (projects: Project[]) => clientSummaries(projects).map((c) => c.name);

/** « 1 200 € + 300 $ » */
export const formatAmounts = (m: Record<string, number>) => {
  const parts = Object.entries(m).filter(([, v]) => v > 0);
  return parts.length ? parts.map(([cur, v]) => formatMoney(v, cur)).join(" + ") : formatMoney(0);
};

/**
 * Parités fixes : le franc CFA (XOF à l'ouest, XAF au centre) est arrimé à l'euro, 1 € = 655,957 FCFA.
 * La conversion est donc exacte, sans taux du jour. Les autres devises ne se convertissent pas.
 */
const PEG: Record<string, number> = { EUR: 1, XOF: 655.957, XAF: 655.957 };
export type MoneyView = "EUR" | "XOF" | null;

/** Regroupe l'euro et le franc CFA dans la devise choisie (null : montants laissés par devise). */
export function convertAmounts(m: Record<string, number>, target: MoneyView) {
  if (!target) return m;
  const out: Record<string, number> = {};
  for (const [cur, v] of Object.entries(m)) {
    const key = PEG[cur] ? target : cur;
    out[key] = (out[key] ?? 0) + (PEG[cur] ? (v / PEG[cur]) * PEG[target] : v);
  }
  return out;
}

/** Vrai si des montants mêlent euro et franc CFA : la bascule € / FCFA a alors un sens. */
export function mixesEuroAndCfa(...maps: Record<string, number>[]) {
  const has = (c: string) => maps.some((m) => (m[c] ?? 0) > 0);
  return has("EUR") && (has("XOF") || has("XAF"));
}

// ---------- Paiements : statut tenu à jour ----------

/** Enregistre un paiement ; s'il solde un projet livré, celui-ci passe en « Payé ». */
export async function recordPayment(p: Project, amount: number, paidOn: string, ledger: Ledger, note = "") {
  await addPayment(p.id, amount, paidOn, note);
  const left = projectMoney(p, ledger).remaining - amount;
  if (left <= 0.005 && p.status === "unpaid") await setProjectStatus(p.id, "paid");
}

/** Change le statut ; passer en « Payé » enregistre le reste dû comme solde. */
export async function changeStatus(p: Project, status: ProjectStatus, ledger: Ledger) {
  if (status === "paid" && p.status !== "paid") {
    const { remaining } = projectMoney(p, ledger);
    if (remaining > 0) await addPayment(p.id, remaining, toIsoDay(new Date()), "Solde");
  }
  await setProjectStatus(p.id, status);
}
