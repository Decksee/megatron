/**
 * Historique des versions, affiché dans la page « Nouveautés » (lien en haut de la fenêtre). Embarqué dans l'app : il marche hors ligne.
 * À compléter avant chaque publication (le script de publication refuse une version absente d'ici).
 * Ne mentionner que ce que l'utilisateur voit : nouvelles fonctions, changements de fonctionnement ou de design.
 * Le reste (corrections, détails techniques, dépôt GitHub…) se résume en « Corrections mineures. »
 * La plus récente en premier.
 */
export interface Release {
  version: string;
  /** AAAA-MM-JJ */
  date: string;
  title: string;
  changes: string[];
}

export const CHANGELOG: Release[] = [
  {
    version: "0.3.3",
    date: "2026-10-15",
    title: "Historique des versions",
    changes: [
      "Lien « Nouveautés » en haut de la fenêtre : chaque version et ce qu'elle apporte, la plus récente en haut.",
      "Un point sur le lien après une mise à jour, tant que tu n'as pas regardé ses nouveautés.",
    ],
  },
  {
    version: "0.3.2",
    date: "2026-10-15",
    title: "Fenêtre mieux agencée",
    changes: [
      "Dans la fenêtre, une tâche tient sur une ligne : projet, jour prévu et échéance alignés en colonnes.",
      "Extras : nom, prix et boutons sur une ligne.",
      "La discussion s'ouvre directement en bas, sans défiler.",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-10-15",
    title: "Corrections mineures",
    changes: ["Corrections mineures."],
  },
  {
    version: "0.3.0",
    date: "2026-10-15",
    title: "Bienvenue, aide et bien-être",
    changes: [
      "Visite guidée au premier lancement : présentation, usage (Freelance, Études, Perso), fonctions, IA et réglages.",
      "Page Aide dans la fenêtre.",
      "Démarrage avec Windows activé par défaut.",
      "Point du matin : une notification avec les tâches, rappels et deadlines du jour.",
      "Conseils de pause quand tu travailles longtemps sans t'arrêter (jamais pendant un focus).",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-10-15",
    title: "Dates, modifications et FCFA",
    changes: [
      "Tâches : jour prévu distinct de l'échéance, rangées en Aujourd'hui, Plus tard et Sans date.",
      "Tâches, extras et rappels modifiables ; textes longs affichés en entier.",
      "Confirmation rapide avant chaque suppression.",
      "Franc CFA (XOF, XAF) et bascule € / FCFA des totaux.",
      "« En cours » et « À encaisser » recalculés : ce qui reste à gagner et tout ce qui reste dû.",
      "L'IA modifie projets, extras, tâches et rappels, et gère paiements et rappels.",
      "Bruits ignorés pendant les conversations vocales ; réponses de l'IA plus aérées.",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-10-14",
    title: "Installateur",
    changes: ["Installateur aux couleurs de Mégatron (icône et bandeaux)."],
  },
  {
    version: "0.2.0",
    date: "2026-10-14",
    title: "Mises à jour automatiques",
    changes: [
      "Mises à jour automatiques : Mégatron propose chaque nouvelle version.",
      "Mégatron sur ton téléphone avec Telegram : notifications, discussion et résumé du soir.",
      "Types d'usage (Freelance, Études, Perso), extras et paiements des projets.",
      "Conversation continue avec « Salut Mégatron », mémoire et nouvel écran Focus.",
      "Une seule instance de Mégatron à la fois.",
      "Pause et reprise du focus.",
      "Fichiers joints à l'IA : PDF, images, Word, Excel (discussion, pastille vocale, Telegram).",
      "Mot d'éveil « Salut Mégatron » plus fiable, conversation vocale plus naturelle.",
      "Nouvelle icône.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-10-13",
    title: "Première version",
    changes: [
      "L'encoche en haut de l'écran : ta journée, la musique, le temps de travail.",
      "Tâches, projets, suivi du temps, focus et rappels.",
      "L'IA à qui parler ou écrire, avec une voix personnalisable.",
    ],
  },
];
