import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../db";
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
import { executeTool, TOOLS } from "./tools";
import { startRecording, stopRecording, type RecordingOptions } from "./voice";
import { speakReply, stopSpeaking } from "./speech";

/** Emplacements des clés dans le Gestionnaire d'identification Windows. */
export const MAIN_SLOT = "main";
export const VOICE_SLOT = "voice";
const MAX_STEPS = 8;

export interface AiConfig {
  provider: ProviderId;
  model: string;
  baseUrl: string | null;
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
  return { provider, model: settings.ai_model, baseUrl: settings.ai_base_url || null };
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

export interface UiMessage {
  id: number;
  role: "user" | "assistant" | "action" | "error";
  text: string;
}

interface AiState {
  messages: UiMessage[];
  /** Historique au format du fournisseur. */
  native: unknown[];
  provider: ProviderId | null;
  busy: boolean;
  recording: boolean;
  transcribing: boolean;
  /** Incrémenté pour demander à la vue de placer le curseur dans le champ. */
  focusRequest: number;
}

let state: AiState = {
  messages: [],
  native: [],
  provider: null,
  busy: false,
  recording: false,
  transcribing: false,
  focusRequest: 0,
};
const listeners = new Set<() => void>();
let nextId = 1;

function set(patch: Partial<AiState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const push = (role: UiMessage["role"], text: string) =>
  set({ messages: [...state.messages, { id: nextId++, role, text }] });

export const aiStore = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

export const useAi = () => useSyncExternalStore(aiStore.subscribe, aiStore.get);

export const requestInputFocus = () => set({ focusRequest: state.focusRequest + 1 });

export function resetConversation() {
  runId++; // une réponse encore en route sera ignorée
  stopSpeaking();
  set({ messages: [], native: [], provider: null, busy: false, transcribing: false });
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

/** Annule la demande en cours (réflexion ou transcription) : l'interface est libérée tout de suite. */
export function cancelRequest() {
  if (!state.busy && !state.transcribing) return;
  runId++;
  set({ busy: false, transcribing: false });
  push("error", "Demande annulée.");
}

/**
 * Envoie un message à l'assistant et exécute les outils qu'il demande, jusqu'à sa réponse finale.
 * `bubbleId` : bulle déjà affichée (dictée vocale) à remplir au lieu d'en créer une.
 */
export async function ask(text: string, config: AiConfig, bubbleId?: number, byVoice = false) {
  const content = text.trim();
  if (!content || state.busy) return;
  const run = ++runId;
  stopSpeaking();
  let reply = "";
  // Changer de fournisseur repart d'une conversation vide (formats incompatibles).
  if (state.provider !== config.provider) set({ native: [], provider: config.provider });

  const before = state.native;
  if (bubbleId != null) updateMessage(bubbleId, content);
  else push("user", content);
  let native = [...before, userMessage(config.provider, `[${stamp()}] ${content}`)];
  set({ busy: true, native });

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const res = await chat(config, buildBody(config.provider, SYSTEM, native, TOOLS));
      if (run !== runId) return; // annulée entre-temps
      const turn = parseResponse(config.provider, res);
      native = [...native, turn.native];
      set({ native });
      if (turn.text) {
        push("assistant", turn.text);
        reply = turn.text;
      }
      if (turn.refused) {
        push("error", "Le modèle a refusé de répondre à cette demande.");
        break;
      }
      if (!turn.calls.length) break;

      const results: ToolResult[] = [];
      for (const call of turn.calls) {
        try {
          const out = await executeTool(call.name, call.args);
          push("action", out.label);
          results.push({ call, result: out.result });
        } catch (e) {
          push("error", errorText(e));
          results.push({ call, result: `Erreur : ${errorText(e)}`, error: true });
        }
      }
      native = [...native, ...toolResultMessages(config.provider, results)];
      set({ native });
    }
    if (run === runId && reply) speakReply(reply, byVoice);
  } catch (e) {
    if (run !== runId) return;
    // La requête n'a pas abouti : on revient à l'historique d'avant pour qu'il reste valide.
    set({ native: before });
    push("error", friendlyError(errorText(e)));
  } finally {
    if (run === runId) set({ busy: false });
  }
}

// ---------- Voix ----------

export async function startTalking(onAutoStop: () => void, options?: RecordingOptions) {
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

async function transcribe(voice: VoiceConfig, wav: string) {
  const call = (model: string) =>
    invoke<string>("ai_transcribe", { provider: voice.provider, slot: voice.slot, model, baseUrl: voice.baseUrl, wavBase64: wav });
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
    bubble = nextId;
    push("user", "Transcription…");
    const text = await transcribe(voice, wav);
    if (run !== runId) return; // annulée entre-temps
    set({ transcribing: false });
    if (text.trim()) await ask(text, config, bubble, true);
    else {
      set({ messages: state.messages.filter((m) => m.id !== bubble) });
      push("error", "Je n'ai rien entendu.");
    }
  } catch (e) {
    if (run !== runId) return;
    if (bubble != null) set({ messages: state.messages.filter((m) => m.id !== bubble) });
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
