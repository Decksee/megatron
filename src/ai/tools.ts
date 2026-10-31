import { invoke } from "@tauri-apps/api/core";
import {
  addMemory,
  createExtra,
  createProject,
  updateExtra,
  updateProject,
  listExtras,
  listPayments,
  deleteMemory,
  deleteProject,
  deleteTask,
  deleteExtra,
  deletePayment,
  deleteReminder,
  completeReminder,
  snoozeReminder,
  updateReminder,
  toggleExtra,
  renameTask,
  setTaskDue,
  setTaskPlanned,
  setTaskExtra,
  listMemories,
  createReminder,
  createTask,
  endFocus,
  listEntries,
  listFocusSessions,
  listProjects,
  listReminders,
  listTasks,
  listTimers,
  pauseFocus,
  pauseTimer,
  PROJECT_COLORS,
  resumeFocus,
  startFocus,
  startTimer,
  stopTimer,
  toggleTask,
  type FocusMode,
  type Project,
  type ProjectStatus,
  type ReminderRepeat,
  ruleOf,
} from "../db";
import { ruleLabel } from "../reminders";
import { changeStatus, projectMoney, recordPayment, STATUS_LABEL, taskBucket } from "../projects";
import { formatDuration, isRunning, overlapMs, periodBuckets, totalMs, type Period } from "../time";
import type { ToolDef } from "./providers";
import { requestEndConversation, requestFile } from "./session";

/** Ce que l'outil renvoie au modèle, et la petite ligne affichée dans la conversation. */
export interface ToolOutput {
  result: string;
  label: string;
}

const DAY_NAMES: Record<string, number> = { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };

/** Jours et répétition dans la journée donnés à l'IA → champs du rappel (seulement ceux qu'elle a fournis). */
function ruleArgs(a: Record<string, unknown>) {
  const out: { days?: number[]; everyMin?: number; until?: string } = {};
  if (typeof a.jours === "string" && a.jours.trim()) {
    out.days = a.jours
      .toLowerCase()
      .split(/[,;\s]+/)
      .map((j) => DAY_NAMES[j.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/, "")])
      .filter((n) => n !== undefined);
  }
  if (a.toutes_les_minutes !== undefined) out.everyMin = Math.max(0, Number(a.toutes_les_minutes) || 0);
  if (typeof a.jusqu_a === "string") out.until = /^\d{1,2}:\d{2}$/.test(a.jusqu_a.trim()) ? a.jusqu_a.trim().padStart(5, "0") : "";
  return out;
}

const str = (desc: string, extra: object = {}) => ({ type: "string", description: desc, ...extra });
const num = (desc: string) => ({ type: "number", description: desc });
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolDef["parameters"] => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

/** Outils de l'apprentissage, retirés quand il est désactivé. */
export const MEMORY_TOOLS = ["retenir", "oublier"];

export const TOOLS: ToolDef[] = [
  {
    name: "pause_focus",
    description: "Met en pause la session de focus en cours (le temps et les distractions ne comptent plus).",
    parameters: obj({}),
  },
  {
    name: "reprendre_focus",
    description: "Reprend la session de focus mise en pause.",
    parameters: obj({}),
  },
  {
    name: "terminer_conversation",
    description:
      "Termine la conversation vocale quand l'utilisateur a fini ou dit au revoir (quelle que soit la formule). Réponds d'abord par une courte formule d'au revoir.",
    parameters: obj({}),
  },
  {
    name: "supprimer_projet",
    description:
      "Supprime définitivement un projet, avec ses tâches, ses extras et ses paiements (le temps passé reste comptabilisé, sans projet). Demande TOUJOURS confirmation à l'utilisateur en nommant le projet, puis appelle l'outil avec confirme=true seulement s'il a dit oui.",
    parameters: obj(
      {
        projet: str("Nom du projet à supprimer"),
        confirme: { type: "boolean", description: "true seulement après que l'utilisateur a confirmé la suppression" },
      },
      ["projet", "confirme"],
    ),
  },
  {
    name: "modifier_tache",
    description:
      "Modifie une tâche retrouvée par son intitulé (même approximatif) : son intitulé, son jour prévu, son échéance, l'extra auquel elle est rattachée, ou la rouvre (faite=false). Ne renseigne que ce qui change.",
    parameters: obj(
      {
        titre: str("Intitulé actuel ou mots-clés"),
        projet: str("Projet de la tâche (optionnel ; à donner quand plusieurs tâches portent le même nom)"),
        nouveau_titre: str("Nouvel intitulé (optionnel)"),
        jour: str("Nouveau jour prévu AAAA-MM-JJ (optionnel ; « aucune » pour le retirer)"),
        echeance: str("Nouvelle échéance AAAA-MM-JJ (optionnel ; « aucune » pour la retirer)"),
        extra: str("Extra auquel rattacher la tâche (optionnel ; « aucun » pour la remettre sur le projet de base)"),
        faite: { type: "boolean", description: "true pour la cocher, false pour la rouvrir (optionnel)" },
      },
      ["titre"],
    ),
  },
  {
    name: "supprimer_tache",
    description: "Supprime une tâche (pas seulement la cocher), retrouvée par son intitulé. À utiliser quand l'utilisateur demande explicitement de la supprimer ou de la retirer.",
    parameters: obj(
      {
        titre: str("Intitulé ou mots-clés de la tâche"),
        projet: str("Projet de la tâche (optionnel ; à donner quand plusieurs tâches portent le même nom)"),
      },
      ["titre"],
    ),
  },
  {
    name: "demander_fichier",
    description:
      "Quand l'utilisateur veut t'envoyer un fichier (document, image, PDF…) et ne l'a pas encore joint : affiche une zone où il peut le déposer. Dis-lui ensuite de le glisser sur la pastille ou dans la discussion.",
    parameters: obj({}),
  },
  {
    name: "retenir",
    description:
      "Retient durablement une information sur l'utilisateur (préférence, habitude, client, façon de travailler), en une phrase courte à la troisième personne.",
    parameters: obj({ fait: str("L'information à retenir, ex. « Il facture ses clients à 450 € la journée »") }, ["fait"]),
  },
  {
    name: "oublier",
    description: "Oublie une information retenue sur l'utilisateur, retrouvée par mots-clés.",
    parameters: obj({ sujet: str("Mots-clés de l'information à oublier") }, ["sujet"]),
  },
  {
    name: "ajouter_tache",
    description:
      "Ajoute une tâche, éventuellement rattachée à un projet, voire à un extra de ce projet (elle apparaît alors sous l'extra : inutile de préfixer l'intitulé par son nom). Deux dates distinctes : le jour prévu (quand l'utilisateur compte la faire : « aujourd'hui », « demain », « jeudi ») et l'échéance (date limite : « à rendre pour », « avant le », « deadline »).",
    parameters: obj(
      {
        titre: str("Intitulé de la tâche"),
        projet: str("Nom du projet (optionnel)"),
        extra: str("Extra du projet auquel rattacher la tâche (optionnel)"),
        jour: str("Jour prévu pour la faire, AAAA-MM-JJ (optionnel)"),
        echeance: str("Date limite, AAAA-MM-JJ (optionnel)"),
      },
      ["titre"],
    ),
  },
  {
    name: "lister_taches",
    description:
      "Liste les tâches (à faire par défaut), éventuellement celles d'un projet ou de la journée, avec leurs dates de création, jour prévu, échéance et réalisation.",
    parameters: obj({
      projet: str("Nom du projet (optionnel)"),
      aujourdhui: { type: "boolean", description: "Seulement les tâches de la journée (prévues aujourd'hui ou reportées, ou à rendre aujourd'hui ou en retard)" },
      inclure_faites: { type: "boolean", description: "Inclure aussi les tâches terminées" },
    }),
  },
  {
    name: "terminer_tache",
    description: "Coche une tâche à faire comme terminée, retrouvée par son intitulé (même approximatif).",
    parameters: obj(
      {
        titre: str("Intitulé ou mots-clés de la tâche"),
        projet: str("Projet de la tâche (optionnel ; à donner quand plusieurs tâches portent le même nom)"),
      },
      ["titre"],
    ),
  },
  {
    name: "lister_projets",
    description: "Liste les projets avec client, prix, statut, dates et avancement des tâches.",
    parameters: obj({}),
  },
  {
    name: "ajouter_extra",
    description:
      "Ajoute un extra à un projet (feature, module ou avenant demandé en plus), avec son prix, éventuellement découpé en tâches. Son prix s'ajoute au total du projet.",
    parameters: obj(
      {
        projet: str("Nom du projet"),
        titre: str("Nom de l'extra, ex. « Page blog »"),
        prix: num("Prix de l'extra"),
        taches: { type: "array", items: { type: "string" }, description: "Tâches qui découpent l'extra (optionnel)" },
      },
      ["projet", "titre"],
    ),
  },
  {
    name: "enregistrer_paiement",
    description:
      "Enregistre un paiement reçu pour un projet (acompte, solde…). Sans montant, c'est tout le reste dû. Le projet passe en « Payé » s'il est soldé.",
    parameters: obj(
      {
        projet: str("Nom du projet"),
        montant: num("Montant reçu (optionnel : par défaut, tout le reste dû)"),
        date: str("Date du paiement au format AAAA-MM-JJ (optionnel : aujourd'hui)"),
        note: str("Note, ex. « Acompte » (optionnel)"),
      },
      ["projet"],
    ),
  },
  {
    name: "changer_statut_projet",
    description:
      "Change le statut d'un projet : a_demarrer, en_cours, en_pause, termine (fini ou rendu, sans argent en jeu), attente_paiement (travail livré, pas encore payé) ou paye.",
    parameters: obj(
      {
        projet: str("Nom du projet"),
        statut: str("Nouveau statut", { enum: ["a_demarrer", "en_cours", "en_pause", "termine", "attente_paiement", "paye"] }),
      },
      ["projet", "statut"],
    ),
  },
  {
    name: "modifier_projet",
    description:
      "Modifie un projet existant (le renommer, changer son client, son prix, sa devise, ses dates ou ses notes) sans rien supprimer : tâches, extras et paiements sont conservés. Ne renseigne que les champs à changer.",
    parameters: obj(
      {
        projet: str("Nom actuel du projet"),
        nouveau_nom: str("Nouveau nom (optionnel)"),
        client: str("Nouveau client (optionnel ; chaîne vide pour le retirer)"),
        prix: num("Nouveau prix de base (optionnel)"),
        devise: str("Nouvelle devise (optionnel)", { enum: ["EUR", "XOF", "XAF", "USD", "GBP", "CHF", "CAD"] }),
        debut: str("Nouvelle date de début AAAA-MM-JJ (optionnel ; « aucune » pour la retirer)"),
        deadline: str("Nouvelle deadline AAAA-MM-JJ (optionnel ; « aucune » pour la retirer)"),
        notes: str("Nouvelles notes (optionnel)"),
      },
      ["projet"],
    ),
  },
  {
    name: "modifier_extra",
    description: "Modifie le nom ou le prix d'un extra d'un projet, ou le marque livré / pas livré.",
    parameters: obj(
      {
        projet: str("Nom du projet"),
        extra: str("Nom actuel de l'extra (ou mots-clés)"),
        nouveau_nom: str("Nouveau nom (optionnel)"),
        prix: num("Nouveau prix (optionnel)"),
        livre: { type: "boolean", description: "true : extra livré ; false : pas encore livré (optionnel)" },
      },
      ["projet", "extra"],
    ),
  },
  {
    name: "supprimer_extra",
    description:
      "Supprime un extra d'un projet avec ses tâches. Demande TOUJOURS confirmation à l'utilisateur en nommant l'extra, puis appelle l'outil avec confirme=true seulement s'il a dit oui.",
    parameters: obj(
      {
        projet: str("Nom du projet"),
        extra: str("Nom de l'extra (ou mots-clés)"),
        confirme: { type: "boolean", description: "true seulement après confirmation de l'utilisateur" },
      },
      ["projet", "extra", "confirme"],
    ),
  },
  {
    name: "lister_paiements",
    description: "Liste les paiements reçus (acomptes, soldes) d'un projet, ou de tous les projets.",
    parameters: obj({ projet: str("Nom du projet (optionnel)") }),
  },
  {
    name: "supprimer_paiement",
    description:
      "Supprime un paiement enregistré par erreur, retrouvé par son projet et son montant (et sa date s'il y en a plusieurs). Demande TOUJOURS confirmation avant, puis appelle l'outil avec confirme=true.",
    parameters: obj(
      {
        projet: str("Nom du projet"),
        montant: num("Montant du paiement"),
        date: str("Date du paiement AAAA-MM-JJ (optionnel)"),
        confirme: { type: "boolean", description: "true seulement après confirmation de l'utilisateur" },
      },
      ["projet", "montant", "confirme"],
    ),
  },
  {
    name: "creer_projet",
    description: "Crée un projet client.",
    parameters: obj(
      {
        nom: str("Nom du projet"),
        client: str("Nom du client (optionnel)"),
        prix: num("Prix du projet (optionnel)"),
        devise: str("Devise (XOF = franc CFA d'Afrique de l'Ouest, XAF = franc CFA d'Afrique centrale)", { enum: ["EUR", "XOF", "XAF", "USD", "GBP", "CHF", "CAD"] }),
        deadline: str("Date limite au format AAAA-MM-JJ (optionnel)"),
        debut: str("Date de début au format AAAA-MM-JJ (optionnel)"),
        statut: str("Statut de départ (en_cours par défaut)", { enum: ["a_demarrer", "en_cours"] }),
        notes: str("Notes ou description du projet (optionnel)"),
      },
      ["nom"],
    ),
  },
  {
    name: "demarrer_minuteur",
    description: "Démarre (ou reprend) le minuteur de temps de travail d'un projet. Plusieurs projets peuvent tourner en même temps.",
    parameters: obj({ projet: str("Nom du projet ; vide = sans projet") }),
  },
  {
    name: "pause_minuteur",
    description: "Met en pause le minuteur d'un projet, ou tous les minuteurs si aucun projet n'est donné.",
    parameters: obj({ projet: str("Nom du projet (optionnel)") }),
  },
  {
    name: "arreter_minuteur",
    description: "Arrête le minuteur d'un projet, ou tous les minuteurs si aucun projet n'est donné.",
    parameters: obj({ projet: str("Nom du projet (optionnel)") }),
  },
  {
    name: "lancer_focus",
    description: "Lance une session de concentration chronométrée avec détection des distractions.",
    parameters: obj(
      {
        minutes: num("Durée en minutes (25, 50 ou 90 sont courants)"),
        projet: str("Nom du projet (optionnel, lance aussi son minuteur)"),
        distraction_autorisee: num("Minutes de distraction autorisées (défaut 5)"),
        mode: str("Quand le budget est dépassé : alerter ou bloquer les distractions", { enum: ["alerter", "bloquer"] }),
      },
      ["minutes"],
    ),
  },
  { name: "arreter_focus", description: "Termine la session de focus en cours.", parameters: obj({}) },
  {
    name: "creer_rappel",
    description:
      "Crée un rappel qui s'affichera dans l'encoche et en notification. Il peut se répéter certains jours (repetition = days + jours) " +
      "et plusieurs fois dans la journée (toutes_les_minutes, jusqu_a), ex. « chaque heure le lundi de 9 h à 18 h ».",
    parameters: obj(
      {
        titre: str("Ce qu'il faut rappeler"),
        quand: str("Date et heure locales du premier rappel, format AAAA-MM-JJTHH:MM"),
        repetition: str("Répétition", { enum: ["none", "daily", "weekdays", "days", "weekly", "monthly"] }),
        jours: str("Si repetition = days : jours de la semaine, séparés par des virgules (ex. « lundi,samedi »)"),
        toutes_les_minutes: num("Répéter dans la journée toutes les N minutes (ex. 60 = chaque heure) ; 0 ou absent = une fois"),
        jusqu_a: str("Avec toutes_les_minutes : heure de fin dans la journée, HH:MM (ex. 18:00) ; absent = jusqu'à minuit"),
        projet: str("Nom du projet (optionnel)"),
      },
      ["titre", "quand"],
    ),
  },
  { name: "lister_rappels", description: "Liste les rappels à venir.", parameters: obj({}) },
  {
    name: "gerer_rappel",
    description:
      "Agit sur un rappel retrouvé par son intitulé : le marquer fait (un rappel répété passe à la prochaine fois), le reporter de quelques minutes, le modifier (texte, date et heure, répétition, projet) ou le supprimer.",
    parameters: obj(
      {
        titre: str("Intitulé ou mots-clés du rappel"),
        action: str("Action", { enum: ["fait", "reporter", "modifier", "supprimer"] }),
        minutes: num("Pour reporter : nombre de minutes (défaut 10)"),
        nouveau_titre: str("Pour modifier : nouveau texte (optionnel)"),
        quand: str("Pour modifier : nouvelle date et heure ISO 8601 locale, ex. 2026-10-15T14:30 (optionnel)"),
        repetition: str("Pour modifier : répétition (optionnel)", { enum: ["none", "daily", "weekdays", "days", "weekly", "monthly"] }),
        jours: str("Si repetition = days : jours de la semaine, séparés par des virgules (ex. « lundi,samedi »)"),
        toutes_les_minutes: num("Répéter dans la journée toutes les N minutes (ex. 60 = chaque heure) ; 0 ou absent = une fois"),
        jusqu_a: str("Avec toutes_les_minutes : heure de fin dans la journée, HH:MM (ex. 18:00) ; absent = jusqu'à minuit"),
        projet: str("Pour modifier : projet (optionnel ; « aucun » pour le retirer)"),
      },
      ["titre", "action"],
    ),
  },
  {
    name: "capture_ecran",
    description: "Ouvre l'outil de capture d'écran de Windows pour sélectionner une zone.",
    parameters: obj({}),
  },
  {
    name: "stats_temps",
    description: "Temps de travail sur une période : total réel et répartition par projet, minuteurs en cours.",
    parameters: obj({ periode: str("Période", { enum: ["jour", "semaine", "mois"] }) }, ["periode"]),
  },
  {
    name: "ouvrir_app",
    description: "Ouvre une application installée sur le PC (Spotify, Word, Discord, Calculatrice…).",
    parameters: obj({ nom: str("Nom de l'application") }, ["nom"]),
  },
  {
    name: "ouvrir_site",
    description: "Ouvre une adresse web dans le navigateur par défaut.",
    parameters: obj({ url: str("Adresse complète commençant par https://") }, ["url"]),
  },
  {
    name: "rechercher",
    description: "Lance une recherche dans le navigateur.",
    parameters: obj(
      {
        requete: str("Ce qu'il faut chercher"),
        site: str("Où chercher (défaut google)", { enum: ["google", "youtube", "images", "maps", "wikipedia", "amazon"] }),
      },
      ["requete"],
    ),
  },
  {
    name: "ouvrir_dossier",
    description: "Ouvre un dossier personnel dans l'Explorateur.",
    parameters: obj(
      { dossier: str("Dossier", { enum: ["documents", "telechargements", "bureau", "images", "musique", "videos"] }) },
      ["dossier"],
    ),
  },
  {
    name: "controle_media",
    description: "Contrôle la musique ou le son : lecture/pause, piste suivante/précédente, volume, muet.",
    parameters: obj(
      {
        action: str("Action", { enum: ["lecture_pause", "suivant", "precedent", "volume_plus", "volume_moins", "muet"] }),
        fois: num("Pour le volume : nombre de crans de 2 % (défaut 5)"),
        niveau: num("Volume exact en pourcentage, 0 à 100 (remplace action et fois)"),
      },
      [],
    ),
  },
  { name: "verrouiller_pc", description: "Verrouille la session Windows.", parameters: obj({}) },
];

// ---------- Exécution ----------

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

function bestMatch<T>(items: T[], query: string, text: (t: T) => string): T | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const words = q.split(/\s+/);
  let best: { item: T; score: number } | undefined;
  for (const item of items) {
    const n = norm(text(item));
    const score = n === q ? 4 : n.startsWith(q) ? 3 : n.includes(q) ? 2 : words.every((w) => n.includes(w)) ? 1 : 0;
    if (score && (!best || score > best.score)) best = { item, score };
  }
  return best?.item;
}

/** Les éléments qui obtiennent le meilleur score (plusieurs en cas d'homonymes). */
function topMatches<T>(items: T[], query: string, text: (t: T) => string): T[] {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored = items
    .map((item) => {
      const n = norm(text(item));
      return { item, score: n === q ? 4 : n.startsWith(q) ? 3 : n.includes(q) ? 2 : words.every((w) => n.includes(w)) ? 1 : 0 };
    })
    .filter((x) => x.score);
  const max = Math.max(0, ...scored.map((x) => x.score));
  return scored.filter((x) => x.score === max).map((x) => x.item);
}

/**
 * Retrouve une tâche par son intitulé, dans le projet donné s'il y en a un. Si plusieurs tâches de projets
 * différents correspondent autant, on ne devine pas : l'erreur liste les projets pour que l'IA précise.
 */
async function findTask(a: Record<string, unknown>, pendingOnly = false) {
  const project = await findProject(a.projet);
  const tasks = (await listTasks()).filter((t) => (!pendingOnly || !t.done) && (!project || t.project_id === project.id));
  const matches = topMatches(tasks, String(a.titre ?? ""), (t) => t.title);
  if (!matches.length) {
    throw new Error(`Aucune tâche${pendingOnly ? " à faire" : ""} ne correspond à « ${a.titre} »${project ? ` dans ${project.name}` : ""}.`);
  }
  const projectIds = new Set(matches.map((t) => t.project_id));
  if (projectIds.size > 1) {
    const names = new Map((await listProjects()).map((p) => [p.id, p.name]));
    const list = [...projectIds].map((id) => (id == null ? "autre projet" : names.get(id))).join(", ");
    throw new Error(`Plusieurs tâches « ${a.titre} » (${list}) : rappelle l'outil avec le paramètre projet.`);
  }
  return matches[0];
}

const STATUS_ARG: Record<string, ProjectStatus> = {
  a_demarrer: "todo",
  en_cours: "active",
  en_pause: "paused",
  attente_paiement: "unpaid",
  paye: "paid",
  termine: "done",
};

const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/** Retrouve un extra par son nom, dans un projet donné ou, à défaut, parmi tous les extras. */
async function findExtra(project: Project | null, name: string) {
  const extras = (await listExtras()).filter((x) => !project || x.project_id === project.id);
  const extra = bestMatch(extras, name, (x) => x.title);
  if (!extra) throw new Error(`Aucun extra ne correspond à « ${name} »${project ? ` sur ${project.name}` : ""}.`);
  return extra;
}

/** « ven. 16 oct. » plutôt que « 2026-10-16 » dans les étiquettes d'action. */
const dayLabel = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });

/** Jour prévu et échéance, fusionnés quand ils tombent le même jour. */
function datesLabel(planned: string | null, due: string | null) {
  if (planned && planned === due) return ` · pour ${dayLabel(due)}`;
  return `${planned ? ` · prévue ${dayLabel(planned)}` : ""}${due ? ` · échéance ${dayLabel(due)}` : ""}`;
}

async function findProject(name: unknown): Promise<Project | null> {
  if (typeof name !== "string" || !name.trim()) return null;
  const p = bestMatch(await listProjects(), name, (x) => x.name);
  if (!p) throw new Error(`Aucun projet ne correspond à « ${name} ».`);
  return p;
}

const SEARCH_URL: Record<string, (q: string) => string> = {
  google: (q) => `https://www.google.com/search?q=${q}`,
  youtube: (q) => `https://www.youtube.com/results?search_query=${q}`,
  images: (q) => `https://www.google.com/search?tbm=isch&q=${q}`,
  maps: (q) => `https://www.google.com/maps/search/${q}`,
  wikipedia: (q) => `https://fr.wikipedia.org/w/index.php?search=${q}`,
  amazon: (q) => `https://www.amazon.fr/s?k=${q}`,
};

const PERIOD: Record<string, Period> = { jour: "day", semaine: "week", mois: "month" };
const FOLDER_LABEL: Record<string, string> = {
  documents: "Documents",
  telechargements: "Téléchargements",
  bureau: "Bureau",
  images: "Images",
  musique: "Musique",
  videos: "Vidéos",
};

export async function executeTool(name: string, a: Record<string, unknown>): Promise<ToolOutput> {
  switch (name) {
    case "ajouter_tache": {
      const project = await findProject(a.projet);
      const titre = String(a.titre ?? "").trim();
      if (!titre) throw new Error("Intitulé de tâche vide.");
      const due = isoDay(a.echeance);
      const planned = isoDay(a.jour);
      const extra = typeof a.extra === "string" && a.extra.trim() ? await findExtra(project, a.extra) : null;
      const projectId = extra?.project_id ?? project?.id ?? null;
      const projectName = extra ? (await listProjects()).find((p) => p.id === extra.project_id)?.name : project?.name;
      await createTask(titre, projectId, due, extra?.id ?? null, planned);
      return {
        result: "Tâche ajoutée.",
        label: `Tâche ajoutée : ${titre}${extra ? ` (${extra.title})` : projectName ? ` (${projectName})` : ""}${datesLabel(planned, due)}`,
      };
    }
    case "lister_taches": {
      const project = await findProject(a.projet);
      const projects = new Map((await listProjects()).map((p) => [p.id, p.name]));
      const extraNames = new Map((await listExtras()).map((x) => [x.id, x.title]));
      const tasks = (await listTasks()).filter(
        (t) =>
          (a.inclure_faites || !t.done) &&
          (!project || t.project_id === project.id) &&
          (!a.aujourdhui || (!t.done && taskBucket(t) === "today")),
      );
      // Dates SQLite (UTC, « AAAA-MM-JJ HH:MM:SS ») → heure locale lisible.
      const when = (sql: string | null) =>
        sql
          ? new Date(sql.replace(" ", "T") + "Z").toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
          : null;
      const lines = tasks.map((t) => {
        const project = t.project_id != null ? ` (${projects.get(t.project_id)})` : "";
        const due = `${t.planned_date ? ` | prévue le ${t.planned_date}` : ""}${t.due_date ? ` | échéance ${t.due_date}` : ""}`;
        const done = t.done && t.completed_at ? ` | cochée le ${when(t.completed_at)}` : "";
        const extra = t.extra_id != null ? ` | extra : ${extraNames.get(t.extra_id)}` : "";
        return `- ${t.done ? "[fait] " : ""}${t.title}${project}${extra}${due} | créée le ${when(t.created_at)}${done}`;
      });
      return { result: lines.join("\n") || "Aucune tâche.", label: `${tasks.length} tâche(s) consultée(s)` };
    }
    case "terminer_tache": {
      const task = await findTask(a, true);
      await toggleTask(task);
      return { result: `Tâche « ${task.title} » terminée.`, label: `Tâche terminée : ${task.title}` };
    }
    case "lister_projets": {
      const [projects, tasks, extras, payments] = await Promise.all([listProjects(), listTasks(), listExtras(), listPayments()]);
      const ledger = { extras, payments };
      const lines = projects.map((p) => {
        const own = tasks.filter((t) => t.project_id === p.id);
        const m = projectMoney(p, ledger);
        const extraList = extras
          .filter((x) => x.project_id === p.id)
          .map((x) => `${x.title} ${x.price} ${p.currency}${x.done ? " (livré)" : ""}`)
          .join(", ");
        return `- ${p.name}${p.notes ? ` | notes : ${p.notes.replace(/\s+/g, " ").slice(0, 200)}` : ""} | client : ${p.client || "—"} | prix de base ${p.price} ${p.currency}${extraList ? ` | extras : ${extraList}` : ""} | total ${m.total} | payé ${m.paid} | reste ${m.remaining} | ${STATUS_LABEL[p.status] ?? p.status} | début : ${p.start_date ?? "—"} | deadline : ${p.deadline ?? "—"} | tâches : ${own.filter((t) => t.done).length}/${own.length}`;
      });
      return { result: lines.join("\n") || "Aucun projet.", label: `${projects.length} projet(s) consulté(s)` };
    }
    case "modifier_projet": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet à modifier.");
      // « aucune » / chaîne vide retire la date ; sinon une date AAAA-MM-JJ ; absent = inchangé.
      const day = (v: unknown, current: string | null) =>
        v === undefined || v === null ? current : /^(aucune?|non|vide|)$/i.test(String(v).trim()) ? null : (isoDay(v) ?? current);
      const changes: string[] = [];
      const next = {
        name: typeof a.nouveau_nom === "string" && a.nouveau_nom.trim() ? a.nouveau_nom.trim() : project.name,
        client: typeof a.client === "string" ? a.client.trim() : project.client,
        price: typeof a.prix === "number" && a.prix >= 0 ? a.prix : project.price,
        currency: typeof a.devise === "string" && a.devise ? a.devise : project.currency,
        status: project.status,
        start_date: day(a.debut, project.start_date),
        deadline: day(a.deadline, project.deadline),
        notes: typeof a.notes === "string" ? a.notes : project.notes,
        color: project.color,
      };
      if (next.name !== project.name) changes.push(`nom : ${next.name}`);
      if (next.client !== project.client) changes.push(`client : ${next.client || "aucun"}`);
      if (next.price !== project.price || next.currency !== project.currency) changes.push(`prix : ${next.price} ${next.currency}`);
      if (next.start_date !== project.start_date) changes.push(`début : ${next.start_date ?? "aucun"}`);
      if (next.deadline !== project.deadline) changes.push(`deadline : ${next.deadline ?? "aucune"}`);
      if (next.notes !== project.notes) changes.push("notes");
      if (!changes.length) return { result: "Rien à changer.", label: `${project.name} : rien à changer` };
      await updateProject(project.id, next);
      return { result: `Projet modifié (${changes.join(", ")}).`, label: `Projet modifié : ${changes.join(" · ")}` };
    }
    case "modifier_extra": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet.");
      const extra = bestMatch(
        (await listExtras()).filter((x) => x.project_id === project.id),
        String(a.extra ?? ""),
        (x) => x.title,
      );
      if (!extra) throw new Error(`Aucun extra ne correspond à « ${a.extra} » sur ${project.name}.`);
      const title = typeof a.nouveau_nom === "string" && a.nouveau_nom.trim() ? a.nouveau_nom.trim() : extra.title;
      const price = typeof a.prix === "number" && a.prix >= 0 ? a.prix : extra.price;
      if (title !== extra.title || price !== extra.price) await updateExtra(extra.id, title, price);
      const delivered = typeof a.livre === "boolean" && a.livre !== !!extra.done;
      if (delivered) await toggleExtra(extra);
      return {
        result: "Extra modifié.",
        label: `Extra modifié : ${title} · ${price} ${project.currency}${delivered ? (a.livre ? " · livré" : " · pas livré") : ""}`,
      };
    }
    case "supprimer_extra": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet.");
      const extra = await findExtra(project, String(a.extra ?? ""));
      if (a.confirme !== true) {
        return {
          result: `Pas supprimé : demande d'abord à l'utilisateur de confirmer la suppression de l'extra « ${extra.title} » et de ses tâches.`,
          label: `Confirmation demandée : ${extra.title}`,
        };
      }
      await deleteExtra(extra.id);
      return { result: `Extra « ${extra.title} » supprimé.`, label: `Extra supprimé : ${extra.title} (${project.name})` };
    }
    case "lister_paiements": {
      const project = await findProject(a.projet);
      const [payments, projects] = await Promise.all([listPayments(), listProjects()]);
      const byId = new Map(projects.map((p) => [p.id, p]));
      const lines = payments
        .filter((x) => !project || x.project_id === project.id)
        .map((x) => {
          const p = byId.get(x.project_id);
          return `- ${x.paid_on} | ${x.amount} ${p?.currency ?? ""} | ${p?.name ?? "?"}${x.note ? ` | ${x.note}` : ""}`;
        });
      return { result: lines.join("\n") || "Aucun paiement.", label: `${lines.length} paiement(s) consulté(s)` };
    }
    case "supprimer_paiement": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet.");
      const montant = Number(a.montant);
      const jour = isoDay(a.date);
      const matches = (await listPayments()).filter(
        (x) => x.project_id === project.id && Math.abs(x.amount - montant) < 0.01 && (!jour || x.paid_on === jour),
      );
      if (!matches.length) throw new Error(`Aucun paiement de ${montant} ${project.currency} sur ${project.name}.`);
      if (matches.length > 1 && !jour) {
        throw new Error(`Plusieurs paiements de ${montant} : précise la date (${matches.map((x) => x.paid_on).join(", ")}).`);
      }
      const pay = matches[0];
      if (a.confirme !== true) {
        return {
          result: `Pas supprimé : demande d'abord à l'utilisateur de confirmer la suppression du paiement de ${pay.amount} ${project.currency} du ${pay.paid_on}.`,
          label: `Confirmation demandée : paiement de ${pay.amount} ${project.currency}`,
        };
      }
      await deletePayment(pay.id);
      return {
        result: "Paiement supprimé.",
        label: `Paiement supprimé : ${pay.amount} ${project.currency} du ${dayLabel(pay.paid_on)} (${project.name})`,
      };
    }
    case "creer_projet": {
      const nom = String(a.nom ?? "").trim();
      if (!nom) throw new Error("Nom de projet vide.");
      const deadline = isoDay(a.deadline);
      const count = (await listProjects()).length;
      await createProject({
        name: nom,
        client: String(a.client ?? ""),
        price: Number(a.prix) || 0,
        currency: String(a.devise ?? "EUR"),
        status: a.statut === "a_demarrer" ? "todo" : "active",
        start_date: isoDay(a.debut),
        deadline,
        notes: String(a.notes ?? "").trim(),
        color: PROJECT_COLORS[count % PROJECT_COLORS.length],
      });
      return { result: "Projet créé.", label: `Projet créé : ${nom}` };
    }
    case "changer_statut_projet": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet.");
      const status = STATUS_ARG[String(a.statut)];
      if (!status) throw new Error(`Statut inconnu : ${a.statut}.`);
      const [extras, payments] = await Promise.all([listExtras(), listPayments()]);
      await changeStatus(project, status, { extras, payments });
      return { result: "Statut changé.", label: `${project.name} : ${STATUS_LABEL[status]}` };
    }
    case "ajouter_extra": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet.");
      const titre = String(a.titre ?? "").trim();
      if (!titre) throw new Error("Nom de l'extra vide.");
      const prix = Number(a.prix) || 0;
      const extraId = await createExtra(project.id, titre, prix);
      const sousTaches = Array.isArray(a.taches) ? a.taches.map(String).filter((t) => t.trim()) : [];
      for (const t of sousTaches) await createTask(t.trim(), project.id, null, extraId);
      return {
        result: `Extra ajouté (${prix} ${project.currency}${sousTaches.length ? `, ${sousTaches.length} tâche(s)` : ""}).`,
        label: `Extra ajouté : ${titre} · ${prix} ${project.currency} (${project.name})`,
      };
    }
    case "enregistrer_paiement": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet.");
      const [extras, payments] = await Promise.all([listExtras(), listPayments()]);
      const ledger = { extras, payments };
      const reste = projectMoney(project, ledger).remaining;
      const montant = Number(a.montant) || reste;
      if (montant <= 0) throw new Error("Rien à encaisser sur ce projet.");
      const jour = isoDay(a.date) ?? new Date().toISOString().slice(0, 10);
      await recordPayment(project, montant, jour, ledger, String(a.note ?? "").trim());
      return {
        result: `Paiement de ${montant} ${project.currency} enregistré. Reste : ${Math.max(0, reste - montant)} ${project.currency}.`,
        label: `Paiement reçu : ${montant} ${project.currency} (${project.name})`,
      };
    }
    case "demarrer_minuteur": {
      const project = await findProject(a.projet);
      await startTimer(project?.id ?? null);
      return { result: "Minuteur démarré.", label: `Minuteur lancé : ${project?.name ?? "autre projet"}` };
    }
    case "pause_minuteur":
    case "arreter_minuteur": {
      const project = await findProject(a.projet);
      const timers = await listTimers();
      const targets = project ? timers.filter((t) => t.project_id === project.id) : timers;
      if (!targets.length) throw new Error("Aucun minuteur correspondant.");
      for (const t of targets) await (name === "pause_minuteur" ? pauseTimer(t.project_id) : stopTimer(t.project_id));
      const verb = name === "pause_minuteur" ? "en pause" : "arrêté";
      return {
        result: `${targets.length} minuteur(s) ${verb}.`,
        label: project ? `Minuteur ${verb} : ${project.name}` : `${targets.length} minuteur(s) ${verb}`,
      };
    }
    case "lancer_focus": {
      const minutes = Math.round(Number(a.minutes));
      if (!(minutes >= 1 && minutes <= 720)) throw new Error("Durée invalide (1 à 720 minutes, soit 12 h).");
      const project = await findProject(a.projet);
      const budget = a.distraction_autorisee == null ? 5 : Math.max(0, Math.round(Number(a.distraction_autorisee)));
      const mode: FocusMode = a.mode === "bloquer" ? "block" : "alert";
      await startFocus({ projectId: project?.id ?? null, plannedMinutes: minutes, budgetMinutes: budget, mode });
      return { result: "Session de focus lancée.", label: `Focus lancé : ${minutes} min${project ? ` sur ${project.name}` : ""}` };
    }
    case "arreter_focus": {
      const active = (await listFocusSessions()).find((s) => !s.ended_at);
      if (!active) throw new Error("Aucune session de focus en cours.");
      await endFocus(active, false);
      return { result: "Session de focus terminée.", label: "Focus terminé" };
    }
    case "creer_rappel": {
      const due = new Date(String(a.quand ?? ""));
      if (Number.isNaN(due.getTime())) throw new Error("Date du rappel invalide.");
      const repeat = (["none", "daily", "weekdays", "days", "weekly", "monthly"].includes(String(a.repetition))
        ? a.repetition
        : "none") as ReminderRepeat;
      const project = await findProject(a.projet);
      const titre = String(a.titre ?? "").trim();
      await createReminder({ title: titre, dueAt: due, repeat, projectId: project?.id ?? null, ...ruleArgs(a) });
      const when = due.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return { result: `Rappel créé pour ${due.toString()}.`, label: `Rappel : ${titre} · ${when}` };
    }
    case "gerer_rappel": {
      const reminder = bestMatch(
        (await listReminders()).filter((r) => !r.done),
        String(a.titre ?? ""),
        (r) => r.title,
      );
      if (!reminder) throw new Error(`Aucun rappel ne correspond à « ${a.titre} ».`);
      if (a.action === "supprimer") {
        await deleteReminder(reminder.id);
        return { result: "Rappel supprimé.", label: `Rappel supprimé : ${reminder.title}` };
      }
      if (a.action === "modifier") {
        const when = typeof a.quand === "string" && a.quand.trim() ? new Date(a.quand) : new Date(reminder.due_at);
        if (Number.isNaN(when.getTime())) throw new Error("Date du rappel invalide.");
        const repeat = (["none", "daily", "weekdays", "days", "weekly", "monthly"].includes(String(a.repetition))
          ? a.repetition
          : reminder.repeat) as ReminderRepeat;
        let projectId = reminder.project_id;
        if (typeof a.projet === "string" && a.projet.trim()) {
          projectId = /^(aucun|aucune|non|rien)$/i.test(a.projet.trim()) ? null : ((await findProject(a.projet))?.id ?? null);
        }
        const title = typeof a.nouveau_titre === "string" && a.nouveau_titre.trim() ? a.nouveau_titre.trim() : reminder.title;
        const current = ruleOf(reminder);
        await updateReminder(reminder.id, {
          title,
          dueAt: when,
          repeat,
          projectId,
          ring: !!reminder.ring,
          days: current.days,
          everyMin: current.everyMin,
          until: current.until,
          ...ruleArgs(a),
        });
        const label = when.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
        return { result: `Rappel modifié (${when.toString()}).`, label: `Rappel modifié : ${title} · ${label}` };
      }
      if (a.action === "reporter") {
        const minutes = Number(a.minutes) > 0 ? Number(a.minutes) : 10;
        await snoozeReminder(reminder, minutes);
        return { result: `Rappel reporté de ${minutes} min.`, label: `Rappel reporté : ${reminder.title} · ${minutes} min` };
      }
      await completeReminder(reminder);
      return {
        result: reminder.repeat === "none" ? "Rappel fait." : "Rappel fait ; il revient à la prochaine occurrence.",
        label: `Rappel fait : ${reminder.title}`,
      };
    }
    case "capture_ecran": {
      await invoke("screen_snip");
      return { result: "Outil de capture ouvert.", label: "Capture d'écran" };
    }
    case "lister_rappels": {
      const reminders = (await listReminders()).filter((r) => !r.done);
      const lines = reminders.map((r) => `- ${r.title} | prochain : ${new Date(r.due_at).toString()} | ${ruleLabel(r) || "une fois"}`);
      return { result: lines.join("\n") || "Aucun rappel.", label: `${reminders.length} rappel(s) consulté(s)` };
    }
    case "stats_temps": {
      const period = PERIOD[String(a.periode)] ?? "day";
      const now = new Date();
      const { from, to } = periodBuckets(period, now);
      const [entries, projects, timers] = await Promise.all([listEntries(), listProjects(), listTimers()]);
      const names = new Map(projects.map((p) => [p.id, p.name]));
      const byProject = new Map<string, number>();
      for (const e of entries) {
        const ms = overlapMs(e, from, to, now);
        if (ms > 0) {
          const key = e.project_id != null ? (names.get(e.project_id) ?? "?") : "Autre projet";
          byProject.set(key, (byProject.get(key) ?? 0) + ms);
        }
      }
      const running = timers
        .filter((t) => isRunning(entries, t.project_id))
        .map((t) => (t.project_id != null ? names.get(t.project_id) : "Autre projet"));
      const result = [
        `Total réel (${String(a.periode)}) : ${formatDuration(totalMs(entries, from, to, now))}`,
        ...[...byProject].sort((x, y) => y[1] - x[1]).map(([k, ms]) => `- ${k} : ${formatDuration(ms)}`),
        `Minuteurs en cours : ${running.join(", ") || "aucun"}`,
      ].join("\n");
      return { result, label: `Stats du temps (${String(a.periode)})` };
    }
    case "ouvrir_app": {
      const opened = await invoke<string>("open_app", { name: String(a.nom ?? "") });
      return { result: `Application « ${opened} » ouverte.`, label: `Ouvert : ${opened}` };
    }
    case "ouvrir_site": {
      let url = String(a.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      await invoke("open_url", { url });
      return { result: "Site ouvert.", label: `Site ouvert : ${url.replace(/^https?:\/\//, "")}` };
    }
    case "rechercher": {
      const site = SEARCH_URL[String(a.site)] ? String(a.site) : "google";
      const q = String(a.requete ?? "");
      await invoke("open_url", { url: SEARCH_URL[site](encodeURIComponent(q)) });
      return { result: "Recherche ouverte.", label: `Recherche ${site} : ${q}` };
    }
    case "ouvrir_dossier": {
      await invoke("open_folder", { folder: String(a.dossier) });
      return { result: "Dossier ouvert.", label: `Dossier ouvert : ${FOLDER_LABEL[String(a.dossier)] ?? a.dossier}` };
    }
    case "controle_media": {
      if (typeof a.niveau === "number") {
        const level = Math.max(0, Math.min(100, a.niveau));
        await invoke("volume_set", { level: level / 100, muted: false });
        return { result: `Volume à ${level} %.`, label: `Volume : ${Math.round(level)} %` };
      }
      await invoke("media_key", { action: String(a.action), times: a.fois == null ? null : Number(a.fois) });
      const labels: Record<string, string> = {
        lecture_pause: "Lecture / pause",
        suivant: "Piste suivante",
        precedent: "Piste précédente",
        volume_plus: "Volume +",
        volume_moins: "Volume −",
        muet: "Son coupé / rétabli",
      };
      return { result: "Fait.", label: labels[String(a.action)] ?? String(a.action) };
    }
    case "verrouiller_pc": {
      await invoke("lock_screen");
      return { result: "Session verrouillée.", label: "PC verrouillé" };
    }
    case "pause_focus":
    case "reprendre_focus": {
      const session = (await listFocusSessions()).find((s) => s.ended_at == null);
      if (!session) throw new Error("Aucune session de focus en cours.");
      if (name === "pause_focus") {
        if (session.paused_at) return { result: "Le focus est déjà en pause.", label: "Focus déjà en pause" };
        await pauseFocus(session);
        return { result: "Focus mis en pause.", label: "Focus en pause" };
      }
      if (!session.paused_at) return { result: "Le focus n'est pas en pause.", label: "Focus déjà en cours" };
      await resumeFocus(session);
      return { result: "Focus repris.", label: "Focus repris" };
    }
    case "terminer_conversation": {
      requestEndConversation();
      return { result: "La conversation vocale va se terminer après ta réponse.", label: "Fin de la conversation" };
    }
    case "supprimer_projet": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet à supprimer.");
      if (a.confirme !== true) {
        return {
          result: `Pas supprimé : demande d'abord à l'utilisateur de confirmer la suppression de « ${project.name} ».`,
          label: `Confirmation demandée : ${project.name}`,
        };
      }
      await deleteProject(project.id);
      return { result: `Projet « ${project.name} » supprimé.`, label: `Projet supprimé : ${project.name}` };
    }
    case "modifier_tache": {
      const task = await findTask(a);
      // « aucune » / chaîne vide retire la date ; sinon une date AAAA-MM-JJ ; absent = inchangé.
      const day = (v: unknown, current: string | null) =>
        v === undefined || v === null ? current : /^(aucune?|non|vide|)$/i.test(String(v).trim()) ? null : (isoDay(v) ?? current);
      const changes: string[] = [];
      const nouveau = String(a.nouveau_titre ?? "").trim();
      if (nouveau && nouveau !== task.title) {
        await renameTask(task.id, nouveau);
        changes.push(nouveau);
      }
      const planned = day(a.jour, task.planned_date);
      if (planned !== task.planned_date) {
        await setTaskPlanned(task.id, planned);
        changes.push(planned ? `prévue ${dayLabel(planned)}` : "sans jour prévu");
      }
      const due = day(a.echeance, task.due_date);
      if (due !== task.due_date) {
        await setTaskDue(task.id, due);
        changes.push(due ? `échéance ${dayLabel(due)}` : "sans échéance");
      }
      if (typeof a.faite === "boolean" && a.faite !== !!task.done) {
        await toggleTask(task);
        changes.push(a.faite ? "cochée" : "rouverte");
      }
      if (typeof a.extra === "string" && a.extra.trim()) {
        if (/^(aucun|aucune|non|rien|projet)$/i.test(a.extra.trim())) {
          if (task.extra_id != null) {
            await setTaskExtra(task.id, task.project_id, null);
            changes.push("retirée de l'extra");
          }
        } else {
          const project = task.project_id != null ? (await listProjects()).find((p) => p.id === task.project_id) ?? null : null;
          const extra = await findExtra(project, a.extra);
          if (extra && extra.id !== task.extra_id) {
            await setTaskExtra(task.id, extra.project_id, extra.id);
            changes.push(`dans ${extra.title}`);
          }
        }
      }
      if (!changes.length) return { result: "Rien à changer.", label: `${task.title} : rien à changer` };
      const dates = changes.filter((c) => c !== nouveau);
      return { result: "Tâche modifiée.", label: [`Tâche modifiée : ${nouveau || task.title}`, ...dates].join(" · ") };
    }
    case "supprimer_tache": {
      const task = await findTask(a);
      await deleteTask(task.id);
      return { result: `Tâche « ${task.title} » supprimée.`, label: `Tâche supprimée : ${task.title}` };
    }
    case "demander_fichier": {
      requestFile();
      return {
        result: "Zone de dépôt affichée : l'utilisateur peut maintenant glisser son fichier sur la pastille ou dans la discussion.",
        label: "En attente d'un fichier",
      };
    }
    case "retenir": {
      const fait = String(a.fait ?? "").trim();
      if (!fait) throw new Error("Rien à retenir.");
      if (/mot de passe|password|\b(cle|key|token|iban)\b|clé|carte bancaire|\b\d{12,}\b/i.test(fait)) {
        throw new Error("Je ne retiens pas d'informations sensibles (mots de passe, clés, données bancaires).");
      }
      const known = await listMemories();
      if (known.some((m) => norm(m.text) === norm(fait))) return { result: "Déjà retenu.", label: "Déjà retenu" };
      await addMemory(fait.slice(0, 300));
      return { result: "Retenu.", label: `Retenu : ${fait}` };
    }
    case "oublier": {
      const memory = bestMatch(await listMemories(), String(a.sujet ?? ""), (m) => m.text);
      if (!memory) throw new Error(`Je n'ai rien retenu sur « ${a.sujet} ».`);
      await deleteMemory(memory.id);
      return { result: `Oublié : ${memory.text}`, label: `Oublié : ${memory.text}` };
    }
    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}
