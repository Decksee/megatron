import { invoke } from "@tauri-apps/api/core";

/**
 * Enregistrement du micro en WAV 16 kHz mono : format accepté par Gemini comme par OpenAI
 * (le WebM produit par MediaRecorder n'est pas lu partout).
 */

const SAMPLE_RATE = 16_000;
const MIN_SECONDS = 0.4;
const MAX_SECONDS = 60;
/** Détection de fin de phrase (mode mains libres) : seuils de volume et durées. */
const SPEECH_RMS = 0.02;
const SILENCE_RMS = 0.012;
const SILENCE_AFTER_SPEECH_MS = 1400;
/** Durée de voix minimale pour considérer qu'on parle (les bruits brefs sont ignorés). */
const MIN_SPEECH_MS = 320;
/** La voix doit dépasser le bruit ambiant de ce facteur. */
const NOISE_FACTOR = 2.6;
/** Son gardé avant le début de la phrase quand on lui coupe la parole. */
const LEAD_MS = 400;
const NO_SPEECH_TIMEOUT_MS = 6000;

interface Recording {
  stream: MediaStream;
  ctx: AudioContext;
  node: ScriptProcessorNode;
  chunks: Float32Array[];
  timeout: number;
}

let current: Recording | null = null;
/** Volume du micro en ce moment (0 à ~0,3), pour animer la pastille vocale. */
let level = 0;
export const micLevel = () => (current ? level : 0);

export interface RecordingOptions {
  /** Arrêt automatique quand la personne a fini de parler (« Hey Mégatron »). */
  stopOnSilence?: boolean;
  /**
   * Tant que c'est vrai (Mégatron parle), on attend : le délai « rien dit » ne court pas, et il faut
   * parler plus fort que sa voix dans les haut-parleurs pour être pris en compte.
   */
  holdWhile?: () => boolean;
  /** Appelé dès que la personne se met à parler (pour couper la parole à Mégatron). */
  onSpeechStart?: () => void;
}

/** Pendant que Mégatron parle, seuil de voix plus haut : sa propre voix ne doit pas compter. */
const BARGE_IN_RMS = 0.09;


/** Pourquoi l'enregistrement s'est arrêté tout seul. */
export type StopReason = "done" | "no-speech" | "max";

export async function startRecording(onAutoStop?: (reason: StopReason) => void, options: RecordingOptions = {}) {
  if (current) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  // Petits blocs (128 ms) : on distingue mieux un bruit bref d'une vraie phrase.
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const chunks: Float32Array[] = [];
  let startedAt = performance.now();
  let spoke = false;
  let silenceSince: number | null = null;
  let stopped = false;
  // Bruit ambiant de la pièce, suivi en continu : le seuil de voix s'adapte (ventilateur, rue…).
  let noise = 0.008;
  /** Voix candidate : du son au-dessus du seuil, pas encore assez long pour compter. */
  let voiceMs = 0;
  let quietMs = 0;
  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    level = rms;
    if (!options.stopOnSilence || stopped) return;
    const t = performance.now();
    const frameMs = (data.length / ctx.sampleRate) * 1000;
    const holding = !spoke && !!options.holdWhile?.();
    if (holding) startedAt = t; // le délai « rien dit » démarre quand il a fini de parler
    const threshold = Math.max(holding ? BARGE_IN_RMS : SPEECH_RMS, noise * NOISE_FACTOR);
    if (rms > threshold) {
      voiceMs += frameMs;
      quietMs = 0;
      // Il faut un vrai bout de phrase : un claquement ou un bruit bref ne compte pas.
      if (!spoke && voiceMs >= MIN_SPEECH_MS) {
        spoke = true;
        // On ne garde que la phrase et ce qui la précède juste : pas le reste de sa réponse captée par le micro.
        if (holding) chunks.splice(0, Math.max(0, chunks.length - Math.ceil((voiceMs + LEAD_MS) / frameMs)));
        options.onSpeechStart?.();
      }
      if (spoke) silenceSince = null;
    } else {
      if (!spoke) {
        noise = noise * 0.95 + rms * 0.05;
        quietMs += frameMs;
        // Le son s'est arrêté avant d'être une phrase : c'était du bruit, on oublie.
        if (quietMs > 400) voiceMs = 0;
      }
      if (rms < Math.max(SILENCE_RMS, noise * NOISE_FACTOR * 0.7)) silenceSince ??= t;
    }
    const doneTalking = spoke && silenceSince != null && t - silenceSince > SILENCE_AFTER_SPEECH_MS;
    const neverTalked = !spoke && t - startedAt > NO_SPEECH_TIMEOUT_MS;
    if (doneTalking || neverTalked) {
      stopped = true;
      onAutoStop?.(doneTalking ? "done" : "no-speech");
    }
  };

  source.connect(node);
  node.connect(ctx.destination);
  current = { stream, ctx, node, chunks, timeout: window.setTimeout(() => onAutoStop?.("max"), MAX_SECONDS * 1000) };
}

export const isRecording = () => current != null;

/**
 * Après que Mégatron a utilisé le micro, l'écoute de « Hey Mégatron » par Windows peut s'être figée :
 * on la relance une fois le micro libéré (et pas entre deux phrases d'une même conversation).
 */
let refreshTimer: number | undefined;
function refreshWakeWordSoon() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (!current) void invoke("wake_word_refresh").catch(() => {});
  }, 4000);
}

/** Arrête et renvoie le WAV en base64, ou null si l'enregistrement est trop court. */
export async function stopRecording(): Promise<string | null> {
  const rec = current;
  if (!rec) return null;
  current = null;
  refreshWakeWordSoon();
  window.clearTimeout(rec.timeout);
  rec.node.disconnect();
  rec.stream.getTracks().forEach((t) => t.stop());
  const rate = rec.ctx.sampleRate;
  await rec.ctx.close();

  const length = rec.chunks.reduce((n, c) => n + c.length, 0);
  if (length / rate < MIN_SECONDS) return null;
  const samples = new Float32Array(length);
  let offset = 0;
  for (const c of rec.chunks) {
    samples.set(c, offset);
    offset += c.length;
  }
  return toBase64(encodeWav(samples, rate));
}

function encodeWav(samples: Float32Array, rate: number) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
