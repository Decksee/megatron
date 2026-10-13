import { invoke } from "@tauri-apps/api/core";
import {
  createProject,
  createReminder,
  createTask,
  endFocus,
  listEntries,
  listFocusSessions,
  listProjects,
  listReminders,
  listTasks,
  listTimers,
  pauseTimer,
  PROJECT_COLORS,
  setProjectStatus,
  startFocus,
  startTimer,
  stopTimer,
  toggleTask,
  type FocusMode,
  type Project,
  type ProjectStatus,
  type ReminderRepeat,
} from "../db";
import { STATUS_LABEL } from "../projects";
import { formatDuration, isRunning, overlapMs, periodBuckets, totalMs, type Period } from "../time";
import type { ToolDef } from "./providers";

/** Ce que l'outil renvoie au modèle, et la petite ligne affichée dans la conversation. */
export interface ToolOutput {
  result: string;
  label: string;
}

const str = (desc: string, extra: object = {}) => ({ type: "string", description: desc, ...extra });
const num = (desc: string) => ({ type: "number", description: desc });
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolDef["parameters"] => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
});

export const TOOLS: ToolDef[] = [
  {
    name: "ajouter_tache",
    description: "Ajoute une tâche à la liste de tâches, éventuellement rattachée à un projet.",
    parameters: obj(
      {
        titre: str("Intitulé de la tâche"),
        projet: str("Nom du projet (optionnel)"),
        echeance: str("Date à laquelle la tâche doit être faite, au format AAAA-MM-JJ (optionnel)"),
      },
      ["titre"],
    ),
  },
  {
    name: "lister_taches",
    description: "Liste les tâches (à faire par défaut), éventuellement celles d'un projet.",
    parameters: obj({
      projet: str("Nom du projet (optionnel)"),
      inclure_faites: { type: "boolean", description: "Inclure aussi les tâches terminées" },
    }),
  },
  {
    name: "terminer_tache",
    description: "Coche une tâche à faire comme terminée, retrouvée par son intitulé (même approximatif).",
    parameters: obj({ titre: str("Intitulé ou mots-clés de la tâche") }, ["titre"]),
  },
  {
    name: "lister_projets",
    description: "Liste les projets avec client, prix, statut, dates et avancement des tâches.",
    parameters: obj({}),
  },
  {
    name: "changer_statut_projet",
    description:
      "Change le statut d'un projet : a_demarrer, en_cours, en_pause, attente_paiement (travail livré, pas encore payé) ou paye.",
    parameters: obj(
      {
        projet: str("Nom du projet"),
        statut: str("Nouveau statut", { enum: ["a_demarrer", "en_cours", "en_pause", "attente_paiement", "paye"] }),
      },
      ["projet", "statut"],
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
        devise: str("Devise", { enum: ["EUR", "USD", "GBP", "CHF", "CAD"] }),
        deadline: str("Date limite au format AAAA-MM-JJ (optionnel)"),
        debut: str("Date de début au format AAAA-MM-JJ (optionnel)"),
        statut: str("Statut de départ (en_cours par défaut)", { enum: ["a_demarrer", "en_cours"] }),
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
    description: "Crée un rappel qui s'affichera dans l'encoche et en notification.",
    parameters: obj(
      {
        titre: str("Ce qu'il faut rappeler"),
        quand: str("Date et heure locales au format AAAA-MM-JJTHH:MM"),
        repetition: str("Répétition", { enum: ["none", "daily", "weekdays", "weekly", "monthly"] }),
        projet: str("Nom du projet (optionnel)"),
      },
      ["titre", "quand"],
    ),
  },
  { name: "lister_rappels", description: "Liste les rappels à venir.", parameters: obj({}) },
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
      },
      ["action"],
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

const STATUS_ARG: Record<string, ProjectStatus> = {
  a_demarrer: "todo",
  en_cours: "active",
  en_pause: "paused",
  attente_paiement: "unpaid",
  paye: "paid",
};

const isoDay = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

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
      await createTask(titre, project?.id ?? null, due);
      return {
        result: "Tâche ajoutée.",
        label: `Tâche ajoutée : ${titre}${project ? ` (${project.name})` : ""}${due ? ` · pour le ${due}` : ""}`,
      };
    }
    case "lister_taches": {
      const project = await findProject(a.projet);
      const projects = new Map((await listProjects()).map((p) => [p.id, p.name]));
      const tasks = (await listTasks()).filter(
        (t) => (a.inclure_faites || !t.done) && (!project || t.project_id === project.id),
      );
      const lines = tasks.map(
        (t) =>
          `- ${t.done ? "[fait] " : ""}${t.title}${t.project_id != null ? ` (${projects.get(t.project_id)})` : ""}${t.due_date ? ` | pour le ${t.due_date}` : ""}`,
      );
      return { result: lines.join("\n") || "Aucune tâche.", label: `${tasks.length} tâche(s) consultée(s)` };
    }
    case "terminer_tache": {
      const task = bestMatch(
        (await listTasks()).filter((t) => !t.done),
        String(a.titre ?? ""),
        (t) => t.title,
      );
      if (!task) throw new Error(`Aucune tâche à faire ne correspond à « ${a.titre} ».`);
      await toggleTask(task);
      return { result: `Tâche « ${task.title} » terminée.`, label: `Tâche terminée : ${task.title}` };
    }
    case "lister_projets": {
      const [projects, tasks] = await Promise.all([listProjects(), listTasks()]);
      const lines = projects.map((p) => {
        const own = tasks.filter((t) => t.project_id === p.id);
        return `- ${p.name} | client : ${p.client || "—"} | ${p.price} ${p.currency} | ${STATUS_LABEL[p.status] ?? p.status} | début : ${p.start_date ?? "—"} | deadline : ${p.deadline ?? "—"}${p.paid_at ? ` | payé le ${p.paid_at.slice(0, 10)}` : ""} | tâches : ${own.filter((t) => t.done).length}/${own.length}`;
      });
      return { result: lines.join("\n") || "Aucun projet.", label: `${projects.length} projet(s) consulté(s)` };
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
        notes: "",
        color: PROJECT_COLORS[count % PROJECT_COLORS.length],
      });
      return { result: "Projet créé.", label: `Projet créé : ${nom}` };
    }
    case "changer_statut_projet": {
      const project = await findProject(a.projet);
      if (!project) throw new Error("Précise le projet.");
      const status = STATUS_ARG[String(a.statut)];
      if (!status) throw new Error(`Statut inconnu : ${a.statut}.`);
      await setProjectStatus(project.id, status);
      return { result: "Statut changé.", label: `${project.name} : ${STATUS_LABEL[status]}` };
    }
    case "demarrer_minuteur": {
      const project = await findProject(a.projet);
      await startTimer(project?.id ?? null);
      return { result: "Minuteur démarré.", label: `Minuteur lancé : ${project?.name ?? "sans projet"}` };
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
      if (!(minutes >= 1 && minutes <= 480)) throw new Error("Durée invalide (1 à 480 minutes).");
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
      const repeat = (["none", "daily", "weekdays", "weekly", "monthly"].includes(String(a.repetition))
        ? a.repetition
        : "none") as ReminderRepeat;
      const project = await findProject(a.projet);
      const titre = String(a.titre ?? "").trim();
      await createReminder({ title: titre, dueAt: due, repeat, projectId: project?.id ?? null });
      const when = due.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      return { result: `Rappel créé pour ${due.toString()}.`, label: `Rappel : ${titre} · ${when}` };
    }
    case "lister_rappels": {
      const reminders = (await listReminders()).filter((r) => !r.done);
      const lines = reminders.map((r) => `- ${r.title} | ${new Date(r.due_at).toString()} | ${r.repeat}`);
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
          const key = e.project_id != null ? (names.get(e.project_id) ?? "?") : "Sans projet";
          byProject.set(key, (byProject.get(key) ?? 0) + ms);
        }
      }
      const running = timers
        .filter((t) => isRunning(entries, t.project_id))
        .map((t) => (t.project_id != null ? names.get(t.project_id) : "Sans projet"));
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
    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}
