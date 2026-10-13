import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../db";
import { voiceConfig } from "./session";
import { setSetting } from "../db";

/**
 * La voix de Mégatron, au choix :
 * - les voix de Windows : gratuites, locales, un peu robotiques ;
 * - Azure (offre gratuite de Microsoft, 500 000 caractères par mois) : les voix les plus humaines ;
 * - Gemini ou OpenAI, avec la clé déjà configurée pour la voix.
 * Si la voix en ligne échoue (quota, réseau), il se rabat sur la voix de Windows.
 */

export type SpeakMode = "off" | "voice" | "always";
export type SpeakEngine = "windows" | "azure" | "online";

export const SPEAK_OPTIONS: { value: SpeakMode; label: string }[] = [
  { value: "voice", label: "Quand je lui parle" },
  { value: "always", label: "Toujours" },
  { value: "off", label: "Jamais" },
];

export const RATE_OPTIONS = [
  { value: "0.9", label: "Lente" },
  { value: "1", label: "Normale" },
  { value: "1.15", label: "Rapide" },
  { value: "1.3", label: "Très rapide" },
];

export const PITCH_OPTIONS = [
  { value: "0.6", label: "Très grave" },
  { value: "0.8", label: "Grave" },
  { value: "1", label: "Normal" },
  { value: "1.25", label: "Aigu" },
  { value: "1.5", label: "Très aigu" },
];

/** Voix en ligne, avec leur caractère. */
export const ONLINE_VOICES: Record<"gemini" | "openai", { value: string; label: string }[]> = {
  gemini: [
    { value: "Charon", label: "Charon · homme, posé" },
    { value: "Orus", label: "Orus · homme, ferme" },
    { value: "Fenrir", label: "Fenrir · homme, énergique" },
    { value: "Iapetus", label: "Iapetus · homme, clair" },
    { value: "Algieba", label: "Algieba · homme, doux" },
    { value: "Sadaltager", label: "Sadaltager · homme, savant" },
    { value: "Gacrux", label: "Gacrux · mature" },
    { value: "Puck", label: "Puck · enjoué" },
    { value: "Kore", label: "Kore · femme, ferme" },
    { value: "Aoede", label: "Aoede · femme, légère" },
    { value: "Leda", label: "Leda · femme, jeune" },
    { value: "Zephyr", label: "Zephyr · femme, lumineuse" },
    { value: "Despina", label: "Despina · femme, douce" },
    { value: "Sulafat", label: "Sulafat · femme, chaleureuse" },
  ],
  openai: [
    { value: "onyx", label: "Onyx · homme, grave" },
    { value: "ash", label: "Ash · homme, clair" },
    { value: "echo", label: "Echo · homme, posé" },
    { value: "verse", label: "Verse · expressif" },
    { value: "ballad", label: "Ballad · doux" },
    { value: "sage", label: "Sage · calme" },
    { value: "alloy", label: "Alloy · neutre" },
    { value: "coral", label: "Coral · femme, chaleureuse" },
    { value: "nova", label: "Nova · femme, vive" },
    { value: "shimmer", label: "Shimmer · femme, douce" },
  ],
};

/** Le ton demandé à la voix en ligne. */
export const STYLE_OPTIONS = [
  { value: "natural", label: "Naturel" },
  { value: "robot", label: "Robot bienveillant" },
  { value: "calm", label: "Calme" },
  { value: "energetic", label: "Énergique" },
  { value: "serious", label: "Sérieux" },
];

const STYLES: Record<string, string> = {
  natural: "Dis en français, de façon naturelle, amicale et décontractée",
  robot: "Dis en français, comme un petit robot assistant bienveillant, d'une voix posée et légèrement synthétique",
  calm: "Dis en français, d'une voix calme, douce et rassurante",
  energetic: "Dis en français, avec énergie et enthousiasme",
  serious: "Dis en français, d'un ton sérieux et professionnel",
};

// ---------- Azure ----------

export const AZURE_SLOT = "azure";
export const AZURE_DEFAULT_VOICE = "fr-FR-HenriNeural";

/** Régions proches proposées en premier ; la région est indiquée sur la page de la ressource Azure. */
export const AZURE_REGIONS = [
  { value: "francecentral", label: "France Central" },
  { value: "westeurope", label: "West Europe" },
  { value: "northeurope", label: "North Europe" },
  { value: "switzerlandnorth", label: "Switzerland North" },
  { value: "uksouth", label: "UK South" },
  { value: "germanywestcentral", label: "Germany West Central" },
  { value: "canadacentral", label: "Canada Central" },
  { value: "eastus", label: "East US" },
  { value: "westus2", label: "West US 2" },
];

/** Région enregistrée une fois la clé vérifiée, sinon null. */
export const azureRegion = (settings: Settings) => settings.speak_azure_region || null;

export interface AzureVoice {
  value: string;
  label: string;
}

/** Voix françaises si la liste n'a pas pu être chargée. */
const AZURE_FALLBACK: AzureVoice[] = [
  { value: "fr-FR-HenriNeural", label: "Henri · homme" },
  { value: "fr-FR-DeniseNeural", label: "Denise · femme" },
  { value: "fr-FR-RemyMultilingualNeural", label: "Rémy · homme" },
  { value: "fr-FR-VivienneMultilingualNeural", label: "Vivienne · femme" },
];

interface RawAzureVoice {
  ShortName: string;
  LocalName?: string;
  DisplayName?: string;
  Gender?: string;
  Locale: string;
}

const LOCALE_LABEL: Record<string, string> = { "fr-FR": "", "fr-CA": " · Québec", "fr-BE": " · Belgique", "fr-CH": " · Suisse" };

/** Charge les voix françaises de la région (vérifie aussi la clé). */
export async function loadAzureVoices(region: string): Promise<AzureVoice[]> {
  const all = await invoke<RawAzureVoice[]>("azure_voices", { slot: AZURE_SLOT, region });
  return all
    .filter((v) => v.Locale.startsWith("fr-"))
    .sort((a, b) => (a.Locale === "fr-FR" ? 0 : 1) - (b.Locale === "fr-FR" ? 0 : 1) || a.ShortName.localeCompare(b.ShortName))
    .map((v) => ({
      value: v.ShortName,
      label: `${v.LocalName ?? v.DisplayName ?? v.ShortName} · ${v.Gender === "Female" ? "femme" : "homme"}${LOCALE_LABEL[v.Locale] ?? ` · ${v.Locale}`}`,
    }));
}

let azureVoicesCache: { region: string; voices: AzureVoice[] } | null = null;

export function useAzureVoices(region: string | null) {
  const [voices, setVoices] = useState<AzureVoice[]>(
    region && azureVoicesCache?.region === region ? azureVoicesCache.voices : AZURE_FALLBACK,
  );
  useEffect(() => {
    if (!region || azureVoicesCache?.region === region) return;
    loadAzureVoices(region)
      .then((v) => {
        if (!v.length) return;
        azureVoicesCache = { region, voices: v };
        setVoices(v);
      })
      .catch(() => {});
  }, [region]);
  return voices;
}

const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;

export interface SpeechPrefs {
  mode: SpeakMode;
  engine: SpeakEngine;
  voice: string;
  onlineVoice: string;
  azureVoice: string;
  style: string;
  rate: number;
  pitch: number;
  volume: number;
  settings: Settings;
}

export function speechPrefs(settings: Settings): SpeechPrefs {
  return {
    mode: (settings.speak_mode as SpeakMode) || "voice",
    engine: (settings.speak_engine as SpeakEngine) || "windows",
    voice: settings.speak_voice ?? "",
    onlineVoice: settings.speak_online_voice ?? "",
    azureVoice: settings.speak_azure_voice ?? "",
    style: settings.speak_style || "natural",
    rate: Number(settings.speak_rate) || 1,
    pitch: Number(settings.speak_pitch) || 0.8, // un poil grave par défaut : c'est un robot
    volume: settings.speak_volume != null ? Number(settings.speak_volume) : 1,
    settings,
  };
}

let prefs: SpeechPrefs = speechPrefs({});

/** Garde les réglages de voix à jour pour la fenêtre courante. */
export function useSpeechPrefs(settings: Settings) {
  const next = speechPrefs(settings);
  prefs = next;
  useEffect(() => {
    if (next.mode === "off") stopSpeaking();
  }, [next.mode]);
}

/** Le fournisseur des voix en ligne : celui configuré pour la voix (Gemini ou OpenAI). */
export function onlineProvider(settings: Settings) {
  return voiceConfig(settings);
}

/** Les voix françaises d'abord, les voix « Natural » (plus humaines) en tête. */
function sortVoices(list: SpeechSynthesisVoice[]) {
  const score = (v: SpeechSynthesisVoice) =>
    (v.lang.toLowerCase().startsWith("fr") ? 0 : 10) + (/natural|online/i.test(v.name) ? 0 : 1);
  return [...list].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => sortVoices(synth?.getVoices() ?? []));
  useEffect(() => {
    if (!synth) return;
    const update = () => setVoices(sortVoices(synth.getVoices()));
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

function pickVoice(name: string) {
  const voices = sortVoices(synth?.getVoices() ?? []);
  return voices.find((v) => v.name === name) ?? voices.find((v) => v.lang.toLowerCase().startsWith("fr")) ?? voices[0];
}

/** Le texte tel qu'il doit être lu : sans markdown, sans emojis, sans liens bruts. */
function clean(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, "le lien")
    .replace(/[*_`#>~]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

let speaking = false;
let token = 0;
let audio: HTMLAudioElement | null = null;
export const isSpeaking = () => speaking || !!synth?.speaking;

function speakWindows(content: string, p: SpeechPrefs) {
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(content);
  const voice = pickVoice(p.voice);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang;
  } else u.lang = "fr-FR";
  u.rate = p.rate;
  u.pitch = p.pitch;
  u.volume = p.volume;
  speaking = true;
  u.onend = u.onerror = () => {
    speaking = false;
  };
  synth.speak(u);
}

/** Modèle de synthèse vocale Gemini : cherché une fois dans la liste des modèles. */
let geminiTtsModel: Promise<string> | null = null;
function ttsModel(provider: "gemini" | "openai", slot: string) {
  if (provider === "openai") return Promise.resolve("gpt-4o-mini-tts");
  geminiTtsModel ??= invoke<string[]>("ai_list_models", { provider: "gemini", slot, baseUrl: null })
    .then((models) => {
      const tts = models.filter((m) => m.includes("tts"));
      return tts.find((m) => m.includes("flash")) ?? tts[0] ?? "gemini-2.5-flash-preview-tts";
    })
    .catch(() => "gemini-2.5-flash-preview-tts");
  return geminiTtsModel;
}

// ---------- Quota des voix en ligne ----------

/** Réglage partagé par toutes les fenêtres : jusqu'à quand le quota du fournisseur est épuisé (ISO). */
const blockedKey = (provider: string) => `speak_blocked_until_${provider}`;

function blockedUntil(settings: Settings, provider: string | undefined): Date | null {
  const raw = provider ? settings[blockedKey(provider)] : undefined;
  const until = raw ? new Date(raw) : null;
  return until && until.getTime() > Date.now() ? until : null;
}

/** Le quota de la voix choisie est-il épuisé ? Renvoie la date de retour, sinon null. */
export function onlineBlockedUntil(settings: Settings, engine: SpeakEngine): Date | null {
  if (engine === "azure") return blockedUntil(settings, "azure");
  if (engine === "online") return blockedUntil(settings, onlineProvider(settings)?.provider);
  return null;
}

const isQuotaError = (raw: string) => /\b429\b|quota|rate.?limit|resource.?exhausted/i.test(raw);

/** « Please retry in 2h8m45.8s » / « retryDelay: "38s" » → millisecondes (1 h par défaut). */
function retryDelayMs(raw: string) {
  const m = raw.match(/retry in ([\d.hms]+)/i) ?? raw.match(/retryDelay"?\s*:\s*"([\d.]+s)"/i);
  if (!m) return 3_600_000;
  let ms = 0;
  for (const [, n, unit] of m[1].matchAll(/([\d.]+)([hms])/g)) {
    ms += Number(n) * (unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : 1000);
  }
  return ms > 0 ? ms : 3_600_000;
}

const clock = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Message court pour l'utilisateur, à partir de l'erreur brute. */
export function speechError(raw: string, until: Date | null = null) {
  if (until || isQuotaError(raw)) {
    return `Quota gratuit de voix atteint : voix de Windows en attendant${until ? ` (retour vers ${clock(until)})` : ""}.`;
  }
  if (/401|403|clé/i.test(raw)) return "Clé refusée pour la voix en ligne : voix de Windows en attendant.";
  if (/connexion|délai|timeout/i.test(raw)) return "Pas de connexion pour la voix en ligne : voix de Windows en attendant.";
  return "Voix en ligne indisponible pour le moment : voix de Windows en attendant.";
}

// ---------- Extraits déjà générés (bouton « Écouter ») ----------

const CACHE_KEY = "megatron.voice-samples";
const CACHE_MAX = 8;
const memoryCache = new Map<string, string>();

function cacheGet(key: string) {
  if (memoryCache.has(key)) return memoryCache.get(key)!;
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as [string, string][];
    return stored.find(([k]) => k === key)?.[1] ?? null;
  } catch {
    return null;
  }
}

function cacheSet(key: string, url: string) {
  memoryCache.set(key, url);
  try {
    const stored = (JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as [string, string][]).filter(([k]) => k !== key);
    stored.unshift([key, url]);
    localStorage.setItem(CACHE_KEY, JSON.stringify(stored.slice(0, CACHE_MAX)));
  } catch {
    // Stockage plein ou indisponible : le cache en mémoire suffit.
  }
}

/** Ce qu'il faut pour générer l'audio d'un texte avec une voix en ligne. */
interface OnlineRequest {
  provider: string;
  /** Clé de cache : même voix, même réglages. */
  key: string;
  call: () => Promise<string>;
}

function geminiOrOpenAi(content: string, p: SpeechPrefs): OnlineRequest {
  const voice = onlineProvider(p.settings);
  if (!voice) throw new Error("Aucune clé Gemini ou OpenAI pour la voix.");
  const list = ONLINE_VOICES[voice.provider];
  const name = list.some((v) => v.value === p.onlineVoice) ? p.onlineVoice : list[0].value;
  const style = STYLES[p.style] ?? STYLES.natural;
  return {
    provider: voice.provider,
    key: `${voice.provider}|${name}|${style}|${content}`,
    call: async () =>
      invoke<string>("ai_speak", {
        provider: voice.provider,
        slot: voice.slot,
        model: await ttsModel(voice.provider, voice.slot),
        voice: name,
        style,
        text: content,
      }),
  };
}

/** Hauteur 0,6…1,5 → décalage SSML (« -20% »…« +25% »). */
const ssmlPitch = (pitch: number) => {
  const n = Math.round((pitch - 1) * 50);
  return `${n >= 0 ? "+" : ""}${n}%`;
};

function azure(content: string, p: SpeechPrefs): OnlineRequest {
  const region = azureRegion(p.settings);
  if (!region) throw new Error("Azure n'est pas connecté.");
  const voice = p.azureVoice || AZURE_DEFAULT_VOICE;
  const pitch = ssmlPitch(p.pitch);
  return {
    provider: "azure",
    key: `azure|${voice}|${pitch}|${content}`,
    call: () =>
      invoke<string>("ai_speak", {
        provider: "azure",
        slot: AZURE_SLOT,
        model: "",
        voice,
        style: "",
        text: content,
        region,
        pitch,
      }),
  };
}

/** Génère (ou reprend du cache) l'audio, en tenant compte du quota, puis le joue. */
async function speakOnline(req: OnlineRequest, p: SpeechPrefs, run: number, cache: boolean) {
  speaking = true;
  let url = cache ? cacheGet(req.key) : null;
  if (!url) {
    const blocked = blockedUntil(p.settings, req.provider);
    if (blocked) throw new QuotaError(blocked);
    try {
      url = await req.call();
    } catch (e) {
      const raw = String((e as Error)?.message ?? e);
      if (isQuotaError(raw)) {
        // On retient la date de retour : plus besoin d'attendre une erreur à chaque réponse.
        const until = new Date(Date.now() + retryDelayMs(raw));
        void setSetting(blockedKey(req.provider), until.toISOString());
        throw new QuotaError(until);
      }
      throw e;
    }
    if (cache) cacheSet(req.key, url);
  }
  if (run !== token) return; // interrompu entre-temps
  const a = new Audio(url);
  a.volume = Math.min(1, Math.max(0, p.volume));
  a.playbackRate = p.rate;
  a.onended = a.onerror = () => {
    if (audio === a) {
      audio = null;
      speaking = false;
    }
  };
  audio = a;
  await a.play();
}

class QuotaError extends Error {
  constructor(readonly until: Date) {
    super("quota");
  }
}

/**
 * Lit un texte. Renvoie un message court s'il a dû se rabattre sur la voix de Windows.
 * `cache` : réutilise l'audio déjà généré pour le même texte (extraits « Écouter »).
 */
export async function speak(text: string, override?: Partial<SpeechPrefs>, cache = false): Promise<string | null> {
  const p = { ...prefs, ...override };
  const content = clean(text);
  stopSpeaking();
  if (!content) return null;
  const run = ++token;
  if (p.engine === "online" || p.engine === "azure") {
    try {
      await speakOnline(p.engine === "azure" ? azure(content, p) : geminiOrOpenAi(content, p), p, run, cache);
      return null;
    } catch (e) {
      if (run !== token) return null;
      speaking = false;
      speakWindows(content, p);
      return e instanceof QuotaError ? speechError("", e.until) : speechError(String((e as Error)?.message ?? e));
    }
  }
  speakWindows(content, p);
  return null;
}

export function stopSpeaking() {
  token++;
  speaking = false;
  synth?.cancel();
  if (audio) {
    audio.pause();
    audio = null;
  }
}

/** Lit la réponse si les réglages le demandent. `byVoice` : la demande a été dite à voix haute. */
export function speakReply(text: string, byVoice: boolean) {
  if (prefs.mode === "always" || (prefs.mode === "voice" && byVoice)) void speak(text);
}
