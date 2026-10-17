import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BellRing,
  ChevronDown,
  Clock3,
  Database,
  FolderKanban,
  ListChecks,
  MousePointer2,
  PlayCircle,
  Smartphone,
  Sparkles,
  Target,
} from "lucide-react";

interface Topic {
  id: string;
  icon: typeof Sparkles;
  title: string;
  summary: string;
  points: string[];
}

const TOPICS: Topic[] = [
  {
    id: "notch",
    icon: MousePointer2,
    title: "L'encoche",
    summary: "Ta journée en un coup d'œil, en haut de l'écran.",
    points: [
      "Passe la souris en haut de l'écran pour l'ouvrir ; elle se referme quand tu la quittes.",
      "Elle peut se ranger en fine barre pour ne pas cacher tes onglets (Réglages → Général).",
      "Ses yeux changent selon la situation : focus, rappel, écoute, réflexion…",
      "Un écran = une encoche : elles restent synchronisées.",
      "Double-clic sur mon icône près de l'horloge (ou clic droit → Ouvrir) pour cette fenêtre.",
    ],
  },
  {
    id: "tasks",
    icon: ListChecks,
    title: "Tâches",
    summary: "Jour prévu, échéance, et le point du matin.",
    points: [
      "📅 Jour prévu : le jour où tu comptes faire la tâche. Pas faite ce jour-là ? Elle reste dans « Aujourd'hui », marquée « Reportée ».",
      "⚑ Échéance : la date limite. Orange le jour J, rouge une fois dépassée.",
      "Les tâches sont rangées en Aujourd'hui, Plus tard et Sans date.",
      "Double-clic sur une tâche (ou le crayon) pour la renommer.",
      "Chaque matin, une notification te dit ce qui t'attend (Réglages → Général → Point du matin).",
    ],
  },
  {
    id: "projects",
    icon: FolderKanban,
    title: "Projets",
    summary: "Statuts, dates, et l'argent si tu es freelance.",
    points: [
      "Trois usages : Freelance (clients, prix, paiements), Études (matières, dates de rendu) ou Perso.",
      "Un projet a un statut, une date de début et une deadline, ses tâches et ses notes.",
      "Freelance : ajoute des extras (features en plus, avec leur prix et leurs sous-tâches) et note chaque paiement reçu.",
      "« En cours » : ce qui reste à gagner sur les projets pas livrés. « À encaisser » : tout ce qui reste dû, dont la part exigible.",
      "Euro et franc CFA se convertissent d'un clic (1 € = 655,957 FCFA, parité fixe).",
    ],
  },
  {
    id: "time",
    icon: Clock3,
    title: "Temps",
    summary: "Combien de temps tu passes sur chaque projet.",
    points: [
      "Lance un minuteur par projet ; plusieurs peuvent tourner en même temps.",
      "Absent plus de quelques minutes ? Les minuteurs se mettent en pause au moment où tu es parti.",
      "Les statistiques montrent ton temps par jour, semaine ou mois.",
    ],
  },
  {
    id: "focus",
    icon: Target,
    title: "Focus et pauses",
    summary: "Concentration, distractions et conseils de pause.",
    points: [
      "Une session de focus a une durée et un temps de distraction autorisé.",
      "Au-delà, Mégatron t'alerte ou réduit la fenêtre qui te distrait (Réglages → Focus).",
      "Tu peux mettre un focus en pause et le reprendre.",
      "Quand tu travailles longtemps sans pause (1 h 30 par défaut), Mégatron te propose de souffler. Jamais pendant un focus.",
      "Boost : si des tâches glissent souvent ou que tu ne planifies plus rien, Mégatron te donne des conseils et suit tes progrès ; quand tu enchaînes, il te motive.",
    ],
  },
  {
    id: "reminders",
    icon: BellRing,
    title: "Rappels",
    summary: "À une heure précise, une fois ou de façon répétée.",
    points: [
      "Raccourcis : +10 min, +30 min, ce soir, demain matin…",
      "Une fois, chaque jour, en semaine, chaque semaine ou chaque mois.",
      "Crayon ou double-clic pour modifier un rappel ; « Plus tard » pour le repousser.",
    ],
  },
  {
    id: "ai",
    icon: Sparkles,
    title: "L'IA",
    summary: "Demande, il le fait.",
    points: [
      "Ctrl + Shift + Espace : appui court pour écrire, appui long pour parler.",
      "« Salut Mégatron » à voix haute lance une conversation ; « c'est bon, merci » la termine. Tu peux lui couper la parole.",
      "Il crée, modifie et supprime tâches, projets, extras, paiements et rappels ; lance minuteurs et focus ; contrôle la musique et le volume.",
      "Glisse un fichier (PDF, image, Word, Excel) dans la discussion ou sur sa pastille : il le lit.",
      "Il peut retenir ce que tu lui apprends (Réglages → IA → Mémoire).",
      "Il ne touche jamais aux réglages : ça, c'est toi.",
    ],
  },
  {
    id: "phone",
    icon: Smartphone,
    title: "Téléphone",
    summary: "Mégatron dans Telegram.",
    points: [
      "Relie ton compte Telegram dans Réglages → Téléphone.",
      "Tu y reçois tes rappels (avec Fait / Plus tard), la fin des focus et un résumé le soir.",
      "Tu peux discuter avec l'IA et lui envoyer des fichiers, comme sur le PC.",
      "Commandes : /taches, /temps, /focus, /rappels.",
    ],
  },
  {
    id: "data",
    icon: Database,
    title: "Tes données",
    summary: "Tout reste sur ton PC.",
    points: [
      "Tes données sont dans une base locale, sur ce PC.",
      "Les clés d'IA sont rangées dans le Gestionnaire d'identification Windows.",
      "Seules tes demandes à l'IA partent chez le fournisseur choisi.",
      "Réglages → Données : sauvegarde et restauration en un fichier.",
      "Mégatron se met à jour tout seul, à ta prochaine pause (Réglages → À propos pour couper).",
    ],
  },
];

/** Page d'aide : comment marche chaque partie de Mégatron. */
export function Help({ onTour }: { onTour: () => void }) {
  const [open, setOpen] = useState<string | null>("tasks");
  return (
    <div className="help">
      <header className="help-head">
        <div>
          <h1 className="window-title">Comment ça marche</h1>
          <p className="muted small">Tout Mégatron, partie par partie.</p>
        </div>
        <button className="btn ghost" onClick={onTour}>
          <PlayCircle size={14} /> Revoir la visite guidée
        </button>
      </header>
      <div className="help-list">
        {TOPICS.map((t) => {
          const expanded = open === t.id;
          return (
            <section key={t.id} className={expanded ? "tile help-topic open" : "tile help-topic"}>
              <button className="help-topic-head" onClick={() => setOpen(expanded ? null : t.id)} aria-expanded={expanded}>
                <span className="window-head-icon">
                  <t.icon size={16} />
                </span>
                <span className="help-topic-text">
                  <b>{t.title}</b>
                  <span className="muted small">{t.summary}</span>
                </span>
                <ChevronDown size={15} className={expanded ? "extra-chevron open" : "extra-chevron"} />
              </button>
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.ul
                    className="help-points"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    {t.points.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </section>
          );
        })}
      </div>
    </div>
  );
}
