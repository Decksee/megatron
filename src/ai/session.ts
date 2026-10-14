import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { listMemories, loadConversation, saveConversation, type Settings } from "../db";
import { usageOf, type Usage } from "../projects";
import {
  buildBody,
  geminiFreeCandidates,
  parseResponse,
  toolResultMessages,
  userMessage,
  PROVIDERS,
  type ProviderId,
  type ToolResult,
} from "./providers";
import { setSetting } from "../db";
import { executeTool, MEMORY_TOOLS, TOOLS } from "./tools";
import { startRecording, stopRecording, type RecordingOptions, type StopReason } from "./voice";
import { speakReply, stopSpeaking, waitSpeechEnd } from "./speech";

/** Emplacements des clés dans le Gestionnaire d'identification Windows. */
export const MAIN_SLOT = "main";
export const VOICE_SLOT = "voice";
const MAX_STEPS = 8;
/** Échanges envoyés au modèle à chaque demande (les plus récents) : au-delà, ça coûte cher pour rien. */
const MAX_TURNS = 12;
/** Bulles gardées à l'écran et dans la base. */
const MAX_MESSAGES = 300;

export interface AiConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
  /** Apprentissage : il retient ce qu'il apprend sur l'utilisateur. */
  memory: boolean;
  /** Pour qui sont les projets (freelance, études, perso). */
  usage: Usage;
}

export interface VoiceConfig {
  provider: "gemini" | "openai";
  slot: string;
  model: string;
  baseUrl: string | null;
}

export function aiConfig(settings: Settings): AiConfig | null {
  const provider = settings.ai_provider as ProviderId | undefined;
  if (!provider || !PROVIDERS[provider] || !settings.ai_model) return null;
  return {
    provider,
    model: settings.ai_model,
    baseUrl: settings.ai_base_url || null,
    memory: settings.ai_memory !== "0",
    usage: usageOf(settings),
  };
}

/** La voix passe par Gemini ou OpenAI : la clé principale si c'est l'un d'eux, sinon une clé dédiée. */
export function voiceConfig(settings: Settings): VoiceConfig | null {
  const main = aiConfig(settings);
  if (main?.provider === "gemini") return { provider: "gemini", slot: MAIN_SLOT, model: main.model, baseUrl: null };
  if (main?.provider === "openai") return { provider: "openai", slot: MAIN_SLOT, model: "whisper-1", baseUrl: null };
  if (settings.voice_provider === "gemini" && settings.voice_model) {
    return { provider: "gemini", slot: VOICE_SLOT, model: settings.voice_model, baseUrl: null };
  }
  if (settings.voice_provider === "openai") return { provider: "openai", slot: VOICE_SLOT, model: "whisper-1", baseUrl: null };
  return null;
}

const SYSTEM = `Tu es Mégatron, un assistant qui vit dans une petite encoche en haut de l'écran Windows de l'utilisateur, souvent un freelance.
Tu gères ses tâches, ses projets clients, son temps de travail, ses sessions de focus et ses rappels, et tu peux ouvrir des applications, des sites et des dossiers ou contrôler la musique, grâce à tes outils.

Règles :
- Réponds en français, en une ou deux phrases courtes : la réponse s'affiche dans un petit espace. Pas de titres ni de tableaux.
- Quand on te demande une action, fais-la directement avec l'outil adapté, sans demander de confirmation, sauf si la demande est vraiment ambiguë.
- Pour répondre sur les données (tâches, projets, temps, rappels), lis-les avec les outils : n'invente rien.
- Chaque message de l'utilisateur commence par la date et l'heure actuelles entre crochets : sers-t'en pour les dates relatives (« demain à 9 h », « dans 20 minutes »).
- Si une action est impossible avec tes outils, dis-le simplement.`;

const MEMORY_RULES = `
Apprentissage :
- Quand l'utilisateur te donne une information durable sur lui (prénom, métier, clients habituels, préférences, façon de travailler, horaires…), retiens-la avec l'outil « retenir », discrètement, sans l'annoncer à chaque fois. Une phrase courte par information.
- S'il te demande d'oublier quelque chose, utilise « oublier ». Ne retiens pas ce qui est temporaire (une tâche du jour, un rappel).
- Ne retiens jamais de mot de passe, de clé, de code ou de donnée bancaire.
- Sers-toi de ce que tu sais pour personnaliser tes réponses, sans le réciter.`;

const CONVERSATION_RULES = `
Mode conversation : l'utilisateur te parle à voix haute et ta réponse est lue. Réponds de façon naturelle et orale, très court, sans listes ni symboles. Il terminera lui-même la conversation.`;

const USAGE_RULES: Record<Usage, string> = {
  freelance: "",
  studies: `
Profil : l'utilisateur est étudiant. Ses projets sont des projets de cours ; le champ « client » d'un projet est la matière ou le cours, et la deadline est la date de rendu. Il n'y a ni prix ni paiement : un projet fini passe au statut « termine » (rendu).`,
  personal: `
Profil : projets personnels, sans client ni prix. Un projet fini passe au statut « termine ».`,
};

async function systemPrompt(config: AiConfig) {
  let prompt = SYSTEM + USAGE_RULES[config.usage];
  if (config.memory) {
    const memories = await listMemories().catch(() => []);
    prompt += MEMORY_RULES;
    if (memories.length) prompt += `\n\nCe que tu sais déjà de l'utilisateur :\n${memories.map((m) => `- ${m.text}`).join("\n")}`;
  }
  if (state.conversing) prompt += CONVERSATION_RULES;
  return prompt;
}

export interface UiMessage {
  id: number;
  role: "user" | "assistant" | "action" | "error";
  text: string;
}

interface AiState {
  messages: UiMessage[];
  /**
   * Historique au format du fournisseur, rangé par échange (message de l'utilisateur + tout ce qui suit) :
   * on peut ainsi n'envoyer que les derniers échanges sans casser l'enchaînement outil / résultat.
   */
  history: unknown[][];
  provider: ProviderId | null;
  busy: boolean;
  recording: boolean;
  transcribing: boolean;
  /** Mode conversation (« Hey Mégatron ») : il réécoute après chaque réponse. */
  conversing: boolean;
  /** Incrémenté à chaque « Nouvelle conversation » : les demandes en cours ailleurs sont abandonnées. */
  epoch: number;
  /** Incrémenté pour demander à la vue de placer le curseur dans le champ. */
  focusRequest: number;
  /** Texte de la pastille vocale : ce qu'il dit ou ce qu'il a compris (propre à cette fenêtre). */
  voiceCaption: string;
}

let state: AiState = {
  messages: [],
  history: [],
  provider: null,
  busy: false,
  recording: false,
  transcribing: false,
  conversing: false,
  epoch: 0,
  focusRequest: 0,
  voiceCaption: "",
};
const listeners = new Set<() => void>();

/** Identifiants uniques entre fenêtres (les bulles sont partagées). */
let seq = 0;
const newId = () => Date.now() * 1000 + (seq++ % 1000);

// ---------- Synchronisation entre fenêtres et sauvegarde ----------

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const CHAT_SYNC = "chat-sync";
/** Cette fenêtre (pour ignorer ses propres messages de synchronisation). */
const ORIGIN = Math.random().toString(36).slice(2);

type Shared = Pick<AiState, "messages" | "history" | "provider" | "busy" | "transcribing" | "conversing" | "epoch">;
const SHARED: (keyof Shared)[] = ["messages", "history", "provider", "busy", "transcribing", "conversing", "epoch"];
const PERSISTED: (keyof Shared)[] = ["messages", "history", "provider"];

const shared = (): Shared => ({
  messages: state.messages,
  history: state.history,
  provider: state.provider,
  busy: state.busy,
  transcribing: state.transcribing,
  conversing: state.conversing,
  epoch: state.epoch,
});

let saveTimer: number | undefined;
function persist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const { messages, history, provider, epoch } = state;
    saveConversation(JSON.stringify({ messages, history, provider, epoch })).catch(console.error);
  }, 400);
}

function set(patch: Partial<AiState>, fromRemote = false) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
  if (fromRemote || !isTauri) return;
  const keys = Object.keys(patch) as (keyof AiState)[];
  if (keys.some((k) => (SHARED as string[]).includes(k))) {
    emit(CHAT_SYNC, { origin: ORIGIN, state: shared() }).catch(() => {});
  }
  if (keys.some((k) => (PERSISTED as string[]).includes(k))) persist();
}

/** Charge la conversation gardée et écoute les autres fenêtres. */
let started = false;
function startSync() {
  if (started || !isTauri) return;
  started = true;
  loadConversation()
    .then((raw) => {
      if (!raw || state.messages.length) return;
      const saved = JSON.parse(raw) as Partial<Shared>;
      set(
        {
          messages: Array.isArray(saved.messages) ? saved.messages : [],
          history: Array.isArray(saved.history) ? saved.history : [],
          provider: saved.provider ?? null,
          epoch: saved.epoch ?? 0,
        },
        true,
      );
    })
    .catch(console.error);
  listen<{ origin: string; state: Shared }>(CHAT_SYNC, (e) => {
    if (e.payload.origin === ORIGIN) return;
    const remote = e.payload.state;
    if (remote.epoch !== state.epoch) {
      // « Nouvelle conversation » ailleurs : on abandonne ce qui était en cours ici.
      runId++;
      stopSpeaking();
      endTurn?.(null);
      if (state.recording) void stopRecording();
      set({ recording: false }, true);
    }
    set(remote, true);
  }).catch(console.error);
}

function push(role: UiMessage["role"], text: string) {
  const id = newId();
  set({ messages: [...state.messages, { id, role, text }].slice(-MAX_MESSAGES) });
  return id;
}

export const aiStore = {
  get: () => state,
  subscribe(fn: () => void) {
    startSync();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const useAi = () => useSyncExternalStore(aiStore.subscribe, aiStore.get);

export const requestInputFocus = () => set({ focusRequest: state.focusRequest + 1 });

export function resetConversation() {
  runId++; // une réponse encore en route sera ignorée
  stopSpeaking();
  endConversation();
  set({ messages: [], history: [], provider: null, busy: false, transcribing: false, epoch: state.epoch + 1 });
}

function stamp() {
  const d = new Date();
  const date = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${date} ${time} (${iso})`;
}

const errorText = (e: unknown) => String((e as Error)?.message ?? e);

/** Message court et compréhensible à partir de l'erreur brute du fournisseur. */
export function friendlyError(raw: string) {
  if (/not scoped to a workspace/i.test(raw))
    return "Cette clé Claude n'est liée à aucun workspace. Sur platform.claude.com, crée une clé depuis un workspace (Settings → Workspaces), puis colle-la ici.";
  if (/limit: 0/.test(raw)) return "Ce modèle n'est pas inclus dans l'offre gratuite. Choisis un autre modèle en haut.";
  if (/Erreur 50[03]|Erreur 529|overloaded|high demand/i.test(raw))
    return "Le modèle est surchargé chez le fournisseur. Réessaie dans un instant ou choisis un autre modèle.";
  const retry = raw.match(/retry in ([\d.]+)s/i);
  if (/Erreur 429/.test(raw)) {
    const wait = retry ? Math.ceil(Number(retry[1]) / 60) : null;
    return wait ? `Quota atteint pour le moment. Réessaie dans environ ${wait} min.` : "Trop de demandes ou quota atteint. Réessaie dans un moment.";
  }
  if (/Erreur 40[13]/.test(raw)) return "La clé API est refusée. Vérifie-la dans les réglages de l'IA.";
  if (/Connexion impossible/.test(raw)) return "Pas de connexion au fournisseur d'IA. Vérifie ta connexion internet.";
  return raw.length > 220 ? `${raw.slice(0, 220)}…` : raw;
}

/** Erreurs Gemini qui justifient d'essayer un autre modèle : pas de quota gratuit, ou modèle surchargé. */
const SWITCHABLE = /limit: 0|Erreur 50[03]|high demand|overloaded/i;

/** Envoie la requête ; avec Gemini, bascule sur un autre modèle Flash si celui choisi est sans quota ou surchargé. */
async function chat(config: AiConfig, body: object) {
  const call = (model: string) =>
    invoke("ai_chat", { provider: config.provider, slot: MAIN_SLOT, model, baseUrl: config.baseUrl, body });
  try {
    return await call(config.model);
  } catch (e) {
    if (config.provider !== "gemini" || !SWITCHABLE.test(errorText(e))) throw e;
    const models = await invoke<string[]>("ai_list_models", { provider: "gemini", slot: MAIN_SLOT, baseUrl: null });
    for (const model of geminiFreeCandidates(models).filter((m) => m !== config.model)) {
      try {
        const res = await call(model);
        config.model = model;
        await setSetting("ai_model", model);
        push("action", `Modèle changé pour ${model}`);
        return res;
      } catch (err) {
        if (!SWITCHABLE.test(errorText(err))) throw err;
      }
    }
    throw e;
  }
}

/** Change à chaque demande ou annulation : une réponse arrivée après une annulation est ignorée. */
let runId = 0;

const updateMessage = (id: number, text: string) =>
  set({ messages: state.messages.map((m) => (m.id === id ? { ...m, text } : m)) });

const removeMessage = (id: number) => set({ messages: state.messages.filter((m) => m.id !== id) });

/** Annule la demande en cours (réflexion ou transcription) : l'interface est libérée tout de suite. */
export function cancelRequest() {
  if (!state.busy && !state.transcribing) return;
  runId++;
  endConversation();
  set({ busy: false, transcribing: false, epoch: state.epoch + 1 });
  push("error", "Demande annulée.");
}

export interface AskResult {
  reply: string;
  /** Actions faites (« Tâche ajoutée : … »). */
  actions: string[];
  error?: string;
}

export interface AskOptions {
  /** Demande venue d'ailleurs (Telegram) : rien n'est lu à voix haute sur le PC. */
  silent?: boolean;
  /** Préfixe de la bulle de l'utilisateur (ex. « 📱 »). */
  badge?: string;
}

/** Attend que l'assistant soit libre (une autre demande est peut-être en cours). */
export async function waitIdle(timeoutMs = 90_000) {
  const start = Date.now();
  while ((state.busy || state.transcribing) && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 300));
  }
  return !state.busy && !state.transcribing;
}

/**
 * Envoie un message à l'assistant et exécute les outils qu'il demande, jusqu'à sa réponse finale.
 * `bubbleId` : bulle déjà affichée (dictée vocale) à remplir au lieu d'en créer une.
 */
export async function ask(
  text: string,
  config: AiConfig,
  bubbleId?: number,
  byVoice = false,
  options: AskOptions = {},
): Promise<AskResult> {
  const content = text.trim();
  const result: AskResult = { reply: "", actions: [] };
  if (!content) return result;
  if (state.busy) return { ...result, error: "Je suis déjà en train de répondre, réessaie dans un instant." };
  const run = ++runId;
  stopSpeaking();
  let reply = "";
  // Changer de fournisseur repart d'un historique vide (formats incompatibles).
  if (state.provider !== config.provider) set({ history: [], provider: config.provider });

  const before = state.history;
  const shown = options.badge ? `${options.badge} ${content}` : content;
  if (bubbleId != null) updateMessage(bubbleId, shown);
  else push("user", shown);
  let turn: unknown[] = [userMessage(config.provider, `[${stamp()}] ${content}`)];
  const context = before.slice(-MAX_TURNS).flat();
  set({ busy: true });
  const tools = config.memory ? TOOLS : TOOLS.filter((t) => !MEMORY_TOOLS.includes(t.name));

  try {
    const system = await systemPrompt(config);
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await chat(config, buildBody(config.provider, system, [...context, ...turn], tools));
      if (run !== runId) return { ...result, error: "Demande annulée." }; // annulée entre-temps
      const answer = parseResponse(config.provider, res);
      turn = [...turn, answer.native];
      if (answer.text) {
        push("assistant", answer.text);
        reply = reply ? `${reply}
${answer.text}` : answer.text;
      }
      if (answer.refused) {
        push("error", "Le modèle a refusé de répondre à cette demande.");
        break;
      }
      if (!answer.calls.length) break;

      const results: ToolResult[] = [];
      for (const call of answer.calls) {
        try {
          const out = await executeTool(call.name, call.args);
          push("action", out.label);
          result.actions.push(out.label);
          results.push({ call, result: out.result });
        } catch (e) {
          push("error", errorText(e));
          results.push({ call, result: `Erreur : ${errorText(e)}`, error: true });
        }
      }
      turn = [...turn, ...toolResultMessages(config.provider, results)];
    }
    if (run !== runId) return { ...result, error: "Demande annulée." };
    // L'échange est complet (il se termine par une réponse du modèle) : on le garde.
    set({ history: [...before, turn].slice(-MAX_TURNS * 4) });
    if (reply && !options.silent) speakReply(reply, byVoice || state.conversing);
    return { ...result, reply };
  } catch (e) {
    if (run !== runId) return { ...result, error: "Demande annulée." };
    // La requête n'a pas abouti : l'historique reste celui d'avant, toujours valide.
    const message = friendlyError(errorText(e));
    push("error", message);
    return { ...result, error: message };
  } finally {
    if (run === runId) set({ busy: false });
  }
}

// ---------- Voix ----------

export async function startTalking(onAutoStop: (reason: StopReason) => void, options?: RecordingOptions) {
  if (state.recording || state.busy) return;
  stopSpeaking();
  try {
    await startRecording(onAutoStop, options);
    set({ recording: true });
  } catch (e) {
    push("error", `Micro indisponible : ${errorText(e)}`);
  }
}

/** Modèles Gemini pour la transcription : les plus rapides (« lite ») d'abord. Liste mise en cache. */
let transcribeModels: string[] | null = null;
async function geminiTranscribeModels(slot: string, preferred: string) {
  transcribeModels ??= geminiFreeCandidates(
    await invoke<string[]>("ai_list_models", { provider: "gemini", slot, baseUrl: null }).catch(() => []),
  );
  const lite = transcribeModels.filter((m) => m.includes("lite"));
  return [...new Set([...lite, ...transcribeModels, preferred])];
}

export async function transcribe(voice: VoiceConfig, wav: string, mime = "audio/wav") {
  const call = (model: string) =>
    invoke<string>("ai_transcribe", {
      provider: voice.provider,
      slot: voice.slot,
      model,
      baseUrl: voice.baseUrl,
      wavBase64: wav,
      mime,
    });
  if (voice.provider !== "gemini") return call(voice.model);
  let lastError: unknown;
  for (const model of await geminiTranscribeModels(voice.slot, voice.model)) {
    try {
      return await call(model);
    } catch (e) {
      lastError = e;
      if (!SWITCHABLE.test(errorText(e))) throw e;
    }
  }
  throw lastError;
}

/** Arrête l'enregistrement, affiche tout de suite la bulle, transcrit, puis envoie le texte à l'assistant. */
export async function stopTalking(config: AiConfig, voice: VoiceConfig) {
  if (!state.recording) return;
  const run = ++runId;
  set({ recording: false, transcribing: true });
  let bubble: number | null = null;
  try {
    const wav = await stopRecording();
    if (!wav) return;
    bubble = push("user", "Transcription…");
    const text = await transcribe(voice, wav);
    if (run !== runId) return; // annulée entre-temps
    set({ transcribing: false });
    if (text.trim()) await ask(text, config, bubble, true);
    else {
      removeMessage(bubble);
      push("error", "Je n'ai rien entendu.");
    }
  } catch (e) {
    if (run !== runId) return;
    if (bubble != null) removeMessage(bubble);
    push("error", friendlyError(errorText(e)));
  } finally {
    if (run === runId) set({ transcribing: false });
  }
}

export async function cancelTalking() {
  if (!state.recording) return;
  set({ recording: false });
  await stopRecording();
}

// ---------- Mode conversation (« Hey Mégatron ») ----------

/** Mots qui ne comptent pas pour décider si la phrase est juste une formule de fin. */
const FILLER = new Set(
  "ok okay bon bah ben alors eh euh oui ouais non super parfait génial top nickel cool bien très trop vraiment beaucoup tout ça ca c est c'est ce pour moi toi le la les un une de du merci mégatron megatron à a plus tard bonne bonnes journée soirée nuit au revoir salut ciao bye stop arrête arrete termine terminé fini c'était ira va aller suffit"
    .split(" "),
);
const ENDING = /\b(merci|c'?est bon|ça ira|ça va aller|au revoir|à plus|à tout|bonne (journée|soirée|nuit)|stop|arr[eê]te|termin|c'?est tout|ça suffit|fini)\b/i;

/** « Merci, c'est bon », « ok à plus »… : la phrase ne contient qu'une formule de fin. */
export function isEnding(text: string) {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.,!?;:«»"]/g, " ");
  if (!ENDING.test(t)) return false;
  return t.split(/\s+/).filter((w) => w && !FILLER.has(w)).length === 0;
}

const GOODBYES = ["Avec plaisir, à plus !", "Pas de souci, je reste dans le coin.", "Avec plaisir !"];
const GREETINGS = ["Oui, qu'est-ce que tu veux ?", "Oui ? Je t'écoute.", "Je suis là, dis-moi."];
const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

/** Termine l'enregistrement d'un tour de parole en cours (la boucle de conversation l'attend). */
let endTurn: ((result: { wav: string | null; reason: StopReason } | null) => void) | null = null;

/** Écoute une phrase : s'arrête tout seul quand on a fini de parler (ou si on ne dit rien). */
function listenOnce(): Promise<{ wav: string | null; reason: StopReason } | null> {
  return new Promise((resolve) => {
    endTurn = resolve;
    startRecording(
      async (reason) => {
        set({ recording: false });
        const wav = await stopRecording();
        endTurn = null;
        resolve({ wav, reason });
      },
      { stopOnSilence: true },
    )
      .then(() => set({ recording: true }))
      .catch((e) => {
        endTurn = null;
        push("error", `Micro indisponible : ${errorText(e)}`);
        resolve(null);
      });
  });
}

/** Arrête le mode conversation (bouton, « Nouvelle conversation », annulation). */
export function endConversation() {
  if (!state.conversing && !endTurn) return;
  set({ conversing: false });
  if (endTurn) {
    const done = endTurn;
    endTurn = null;
    if (state.recording) {
      set({ recording: false });
      void stopRecording();
    }
    done(null);
  }
}

/**
 * Conversation continue : il écoute, répond (à voix haute), puis réécoute,
 * jusqu'à « merci, c'est bon » ou quelques secondes de silence.
 */
export async function startConversation(config: AiConfig, voice: VoiceConfig, options: { greet?: boolean } = {}) {
  if (state.conversing || state.recording || state.busy || state.transcribing) return;
  const epoch = state.epoch;
  stopSpeaking();
  const greeting = options.greet ? pick(GREETINGS) : "";
  set({ conversing: true, voiceCaption: greeting });
  if (greeting) speakReply(greeting, true);
  const active = () => state.conversing && state.epoch === epoch;
  try {
    while (active()) {
      await waitSpeechEnd();
      if (!active()) break;
      const heard = await listenOnce();
      if (!heard || !active()) break;
      // Rien dit pendant quelques secondes : la conversation s'arrête en silence.
      if (heard.reason === "no-speech" || !heard.wav) break;

      set({ transcribing: true });
      const bubble = push("user", "Transcription…");
      let text = "";
      try {
        text = (await transcribe(voice, heard.wav)).trim();
        set({ voiceCaption: text });
      } catch (e) {
        removeMessage(bubble);
        push("error", friendlyError(errorText(e)));
        break;
      } finally {
        set({ transcribing: false });
      }
      if (!active()) {
        removeMessage(bubble);
        break;
      }
      if (!text) {
        removeMessage(bubble);
        break;
      }
      if (isEnding(text)) {
        updateMessage(bubble, text);
        const bye = pick(GOODBYES);
        push("assistant", bye);
        set({ conversing: false, voiceCaption: bye });
        speakReply(bye, true);
        break;
      }
      const res = await ask(text, config, bubble, true);
      set({ voiceCaption: res.reply || res.error || "" });
    }
  } finally {
    if (state.epoch === epoch) set({ conversing: false });
  }
}
