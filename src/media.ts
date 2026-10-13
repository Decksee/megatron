import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const isTauri = "__TAURI_INTERNALS__" in window;

export interface MediaState {
  title: string;
  artist: string;
  album: string;
  /** Identifiant de l'app qui joue (Spotify, Chrome…). */
  app: string;
  playing: boolean;
  positionMs: number;
  durationMs: number;
  updatedAtMs: number;
  artwork: string | null;
  /** null si le lecteur ne gère pas l'aléatoire / la répétition. */
  shuffle: boolean | null;
  repeat: "none" | "track" | "list" | null;
}

/** Musique en cours sur le PC (panneau média de Windows), rafraîchie plus souvent quand elle est affichée. */
export function useMedia(fast: boolean) {
  const [media, setMedia] = useState<MediaState | null>(null);
  useEffect(() => {
    if (!isTauri) {
      // Aperçu navigateur (dev) : un morceau d'exemple.
      if (import.meta.env.DEV) {
        const start = Date.now() - 83_000;
        setMedia({ title: "KABA", artist: "Himra", album: "", app: "Spotify.exe", playing: true, positionMs: Date.now() - start, durationMs: 237_000, updatedAtMs: Date.now(), artwork: null, shuffle: false, repeat: "none" });
      }
      return;
    }
    let alive = true;
    const poll = () =>
      invoke<MediaState | null>("media_state")
        .then((m) => alive && setMedia(m))
        .catch(() => {});
    poll();
    const id = setInterval(poll, fast ? 1000 : 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [fast]);
  return media;
}

/** Position actuelle : Windows ne la met pas à jour en continu, on l'extrapole pendant la lecture. */
export function mediaPosition(m: MediaState, now: number) {
  if (!m.playing || !m.updatedAtMs) return m.positionMs;
  const pos = m.positionMs + (now - m.updatedAtMs);
  return m.durationMs ? Math.min(m.durationMs, pos) : pos;
}

export const mediaControl = (
  action: "play_pause" | "next" | "previous" | "seek" | "shuffle" | "repeat",
  positionMs?: number,
) =>
  invoke("media_control", { action, positionMs: positionMs ?? null });

const APP_NAMES: [RegExp, string][] = [
  [/spotify/i, "Spotify"],
  [/chrome/i, "Chrome"],
  [/msedge|edge/i, "Edge"],
  [/firefox/i, "Firefox"],
  [/deezer/i, "Deezer"],
  [/vlc/i, "VLC"],
  [/zune|music/i, "Lecteur multimédia"],
  [/brave/i, "Brave"],
  [/opera/i, "Opera"],
];

export function mediaAppName(id: string) {
  return APP_NAMES.find(([re]) => re.test(id))?.[1] ?? id.split(/[!._]/)[0];
}

export function formatTrackTime(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export interface VolumeState {
  level: number;
  muted: boolean;
}

export function useVolume(active: boolean) {
  const [volume, setVolume] = useState<VolumeState | null>(null);
  useEffect(() => {
    if (!isTauri || !active) return;
    let alive = true;
    const poll = () =>
      invoke<VolumeState>("volume_get")
        .then((v) => alive && setVolume(v))
        .catch(() => {});
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);
  return [volume, setVolume] as const;
}
