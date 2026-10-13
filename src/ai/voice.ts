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
const NO_SPEECH_TIMEOUT_MS = 6000;

interface Recording {
  stream: MediaStream;
  ctx: AudioContext;
  node: ScriptProcessorNode;
  chunks: Float32Array[];
  timeout: number;
}

let current: Recording | null = null;

export interface RecordingOptions {
  /** Arrêt automatique quand la personne a fini de parler (« Hey Mégatron »). */
  stopOnSilence?: boolean;
}

export async function startRecording(onAutoStop?: () => void, options: RecordingOptions = {}) {
  if (current) return;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  const startedAt = performance.now();
  let spoke = false;
  let silenceSince: number | null = null;
  let stopped = false;
  node.onaudioprocess = (e) => {
    const data = new Float32Array(e.inputBuffer.getChannelData(0));
    chunks.push(data);
    if (!options.stopOnSilence || stopped) return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const t = performance.now();
    if (rms > SPEECH_RMS) {
      spoke = true;
      silenceSince = null;
    } else if (rms < SILENCE_RMS) {
      silenceSince ??= t;
    }
    const doneTalking = spoke && silenceSince != null && t - silenceSince > SILENCE_AFTER_SPEECH_MS;
    const neverTalked = !spoke && t - startedAt > NO_SPEECH_TIMEOUT_MS;
    if (doneTalking || neverTalked) {
      stopped = true;
      onAutoStop?.();
    }
  };
  source.connect(node);
  node.connect(ctx.destination);
  current = { stream, ctx, node, chunks, timeout: window.setTimeout(() => onAutoStop?.(), MAX_SECONDS * 1000) };
}

export const isRecording = () => current != null;

/** Arrête et renvoie le WAV en base64, ou null si l'enregistrement est trop court. */
export async function stopRecording(): Promise<string | null> {
  const rec = current;
  if (!rec) return null;
  current = null;
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
