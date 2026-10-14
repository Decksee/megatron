/**
 * Erreurs de connexion aux services (clé d'IA, de voix, d'Azure, de Telegram) traduites en langage clair :
 * ce qui s'est passé, et quoi faire. Le message brut reste disponible en « détails ».
 */

export type Service = "gemini" | "anthropic" | "openai" | "compatible" | "azure" | "telegram";

export interface Explained {
  /** Ce qui se passe, en une phrase. */
  title: string;
  /** Ce qu'il faut faire. */
  hint: string;
}

const NAME: Record<Service, string> = {
  gemini: "Google (Gemini)",
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  compatible: "ce service",
  azure: "Azure",
  telegram: "Telegram",
};

const WHERE: Record<Service, string> = {
  gemini: "sur aistudio.google.com/apikey",
  anthropic: "sur platform.claude.com, dans Settings → API keys",
  openai: "sur platform.openai.com/api-keys",
  compatible: "dans l'espace de ton fournisseur",
  azure: "sur le portail Azure, dans « Clés et point de terminaison » de ta ressource Speech",
  telegram: "auprès de @BotFather (commande /mybots → ton bot → API Token)",
};

/** Code HTTP mentionné dans le message (« Erreur 401 … »). */
const statusOf = (raw: string) => Number(raw.match(/\b(?:Erreur(?: Telegram)?|HTTP)\s+(\d{3})\b/i)?.[1] ?? raw.match(/\b([45]\d{2})\b/)?.[1] ?? 0);

export function explainError(raw: string, service: Service): Explained {
  const r = raw.toLowerCase();
  const name = NAME[service];
  const code = statusOf(raw);

  // Réseau
  if (/connexion impossible|connexion à telegram impossible|dns|network|timed? ?out|délai dépassé|ne répond pas/.test(r)) {
    return {
      title: `Impossible de joindre ${name}.`,
      hint: "Vérifie ta connexion internet (ou un VPN, un pare-feu d'entreprise), puis réessaie.",
    };
  }

  // Champs manquants côté Mégatron
  if (/aucune clé|aucun bot|n'est pas connecté/.test(r)) {
    return { title: "Aucune clé n'est enregistrée.", hint: "Colle ta clé dans le champ, puis valide." };
  }
  if (/indique l'adresse du serveur/.test(r)) {
    return { title: "L'adresse du serveur manque.", hint: "Indique l'adresse de ton fournisseur, par exemple https://openrouter.ai/api/v1." };
  }

  // Claude : clé hors workspace
  if (/not scoped to a workspace/.test(r)) {
    return {
      title: "Cette clé Claude n'est rattachée à aucun workspace.",
      hint: "Sur platform.claude.com, crée une nouvelle clé depuis un workspace (Settings → Workspaces), puis colle-la ici.",
    };
  }

  // Crédit ou facturation
  if (/credit balance|insufficient_quota|billing|exceeded your current quota.*plan|payment required/.test(r) || code === 402) {
    return {
      title: `Ton compte ${name} n'a plus de crédit.`,
      hint:
        service === "gemini"
          ? "Le quota gratuit est épuisé pour le moment : attends qu'il se recharge, ou active la facturation sur Google AI Studio."
          : `Ajoute du crédit ou un moyen de paiement ${WHERE[service].replace(/, dans .*/, "")}, puis réessaie.`,
    };
  }

  // Quota ou trop de demandes
  if (code === 429 || /quota|rate.?limit|too many requests|resource.?exhausted/.test(r)) {
    const wait = raw.match(/retry in ([\d.]+)s/i);
    const minutes = wait ? Math.ceil(Number(wait[1]) / 60) : null;
    return {
      title: `${name} limite le nombre de demandes en ce moment.`,
      hint: minutes ? `Réessaie dans environ ${minutes} min.` : "Patiente quelques minutes, puis réessaie.",
    };
  }

  // Pays non couvert (Gemini)
  if (/location is not supported|user location/.test(r)) {
    return {
      title: "Gemini n'est pas disponible depuis ton pays ou ta connexion.",
      hint: "Désactive ton VPN s'il en a un, ou choisis un autre fournisseur (Claude, OpenAI).",
    };
  }

  // Service pas activé (Google Cloud)
  if (/service_disabled|has not been used in project|is disabled/.test(r)) {
    return {
      title: "L'API n'est pas activée pour cette clé.",
      hint: "Crée plutôt ta clé sur aistudio.google.com/apikey : elle est prête à l'emploi.",
    };
  }

  // Telegram : spécificités
  if (service === "telegram") {
    if (code === 401 || code === 404 || /unauthorized|not found/.test(r)) {
      return {
        title: "Telegram ne reconnaît pas cette clé de bot.",
        hint: `Copie-la à nouveau ${WHERE.telegram}. Elle ressemble à 123456789:AAH… (chiffres, deux-points, lettres).`,
      };
    }
    if (code === 409 || /conflict|terminated by other getupdates/.test(r)) {
      return {
        title: "Ce bot est déjà utilisé par un autre programme.",
        hint: "Ferme l'autre application ou l'autre copie de Mégatron qui utilise ce bot, ou crée un bot dédié.",
      };
    }
    if (/chat not found|bot was blocked/.test(r)) {
      return {
        title: "Le bot ne peut pas t'écrire.",
        hint: "Ouvre la conversation avec ton bot dans Telegram et appuie sur Démarrer (ou débloque-le).",
      };
    }
  }

  // Azure : clé ou région
  if (service === "azure" && (code === 401 || code === 403)) {
    return {
      title: "Azure refuse cette clé pour cette région.",
      hint: "Vérifie la clé et choisis la même région que ta ressource Speech (indiquée sur sa page « Vue d'ensemble »).",
    };
  }

  // Clé invalide ou refusée
  if (
    code === 401 ||
    code === 403 ||
    /api key not valid|api_key_invalid|invalid.?api.?key|incorrect api key|invalid x-api-key|authentication|permission_denied|unauthorized|clé api refusée/.test(r)
  ) {
    return {
      title: `${name} refuse cette clé.`,
      hint: `Vérifie que tu as copié la clé entière, sans espace, ${WHERE[service]}. Si elle a été supprimée ou régénérée, crée-en une nouvelle.`,
    };
  }

  // Modèle introuvable
  if (code === 404 || /model.*not.?found|not_found_error|does not exist|aucun modèle/.test(r)) {
    return {
      title: "Aucun modèle utilisable n'a été trouvé avec cette clé.",
      hint: "Vérifie que ton compte a accès aux modèles, ou choisis un autre fournisseur.",
    };
  }

  // Requête refusée
  if (code === 400) {
    return {
      title: `${name} n'a pas accepté la demande.`,
      hint: "La clé est peut-être mal copiée ou pour un autre service. Recolle-la et réessaie.",
    };
  }

  // Panne chez le fournisseur
  if (code >= 500 || /overloaded|high demand|unavailable/.test(r)) {
    return {
      title: `${name} rencontre un problème de son côté.`,
      hint: "Ce n'est pas ta clé : réessaie dans un moment.",
    };
  }

  return {
    title: "La connexion n'a pas abouti.",
    hint: "Vérifie la clé et ta connexion, puis réessaie. Le détail ci-dessous peut aider.",
  };
}
