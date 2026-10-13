import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import {
  Calculator,
  Download,
  Lock,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Scissors,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { TrackBar } from "../components/TrackBar";
import { formatTrackTime, mediaAppName, mediaControl, mediaPosition, useVolume, type MediaState } from "../media";

const QUICK_ACTIONS = [
  { label: "Capture", icon: Scissors, run: () => invoke("screen_snip") },
  { label: "Verrouiller", icon: Lock, run: () => invoke("lock_screen") },
  { label: "Téléchargements", icon: Download, run: () => invoke("open_folder", { folder: "telechargements" }) },
  { label: "Calculatrice", icon: Calculator, run: () => invoke("open_app", { name: "calculatrice" }).catch(() => invoke("open_app", { name: "calculator" })) },
];

export function Controls({ media, now }: { media: MediaState | null; now: Date }) {
  return (
    <div className="controls">
      <MediaTile media={media} now={now} />
      <VolumeTile />
      <div className="quick-actions">
        {QUICK_ACTIONS.map(({ label, icon: Icon, run }) => (
          <motion.button key={label} className="tile quick" whileTap={{ scale: 0.95 }} onClick={() => run().catch(console.error)}>
            <Icon size={18} />
            <span>{label}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function MediaTile({ media, now }: { media: MediaState | null; now: Date }) {
  // Lecture/pause instantanée à l'écran, sans attendre le prochain relevé.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  useEffect(() => setOptimistic(null), [media?.playing, media?.title]);

  if (!media) {
    return (
      <div className="tile media-tile empty">
        <div className="media-art placeholder">
          <Music2 size={22} />
        </div>
        <div className="media-info">
          <span className="media-title">Aucune musique en cours</span>
          <span className="tile-caption">Lance Spotify, YouTube, Deezer… pour la contrôler d'ici.</span>
        </div>
      </div>
    );
  }

  const playing = optimistic ?? media.playing;
  const position = mediaPosition({ ...media, playing }, now.getTime());
  const ratio = media.durationMs ? position / media.durationMs : 0;

  const repeatLabel = media.repeat === "track" ? "Répéter le morceau" : media.repeat === "list" ? "Répéter la liste" : "Répéter";

  return (
    <div className="tile media-tile">
      {/* Fond : la pochette floutée, comme sur les lecteurs mobiles. */}
      <AnimatePresence initial={false}>
        {media.artwork && (
          <motion.div
            key={media.title}
            className="media-backdrop"
            style={{ backgroundImage: `url(${media.artwork})` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        )}
      </AnimatePresence>
      <div className="media-top">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={media.title}
            className="media-art"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          >
            {media.artwork ? <img src={media.artwork} alt="" /> : <Music2 size={22} />}
          </motion.div>
        </AnimatePresence>
        <div className="media-info">
          <span className="tile-caption media-app">
            {playing && <Equalizer />}
            {mediaAppName(media.app)}
          </span>
          <span className="media-title" title={media.title}>
            {media.title}
          </span>
          <span className="media-artist">{media.artist || media.album}</span>
        </div>
      </div>
      {media.durationMs > 0 && (
        <div className="media-progress">
          <span>{formatTrackTime(position)}</span>
          <TrackBar ratio={ratio} onSeek={(r) => mediaControl("seek", Math.round(r * media.durationMs))} />
          <span>{formatTrackTime(media.durationMs)}</span>
        </div>
      )}
      <div className="media-buttons">
        <button
          className={media.shuffle ? "ghost-btn on" : "ghost-btn"}
          onClick={() => mediaControl("shuffle")}
          disabled={media.shuffle == null}
          aria-label="Lecture aléatoire"
          aria-pressed={!!media.shuffle}
        >
          <Shuffle size={16} />
        </button>
        <button className="ghost-btn" onClick={() => mediaControl("previous")} aria-label="Piste précédente">
          <SkipBack size={18} fill="currentColor" />
        </button>
        <motion.button
          className="round-btn big"
          whileTap={{ scale: 0.92 }}
          onClick={() => {
            setOptimistic(!playing);
            mediaControl("play_pause");
          }}
          aria-label={playing ? "Pause" : "Lecture"}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </motion.button>
        <button className="ghost-btn" onClick={() => mediaControl("next")} aria-label="Piste suivante">
          <SkipForward size={18} fill="currentColor" />
        </button>
        <button
          className={media.repeat && media.repeat !== "none" ? "ghost-btn on" : "ghost-btn"}
          onClick={() => mediaControl("repeat")}
          disabled={media.repeat == null}
          aria-label={repeatLabel}
          title={repeatLabel}
        >
          {media.repeat === "track" ? <Repeat1 size={16} /> : <Repeat size={16} />}
        </button>
      </div>
    </div>
  );
}

/** Petites barres animées « ça joue ». */
export function Equalizer() {
  return (
    <span className="eq" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.i
          key={i}
          animate={{ scaleY: [0.3, 1, 0.5, 0.8, 0.3] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function VolumeTile() {
  const [volume, setVolume] = useVolume(true);
  const pending = useRef<number | undefined>(undefined);
  const level = volume?.level ?? 0;
  const muted = volume?.muted ?? false;
  const Icon = muted || level === 0 ? VolumeX : level < 0.5 ? Volume1 : Volume2;

  const change = (value: number) => {
    setVolume({ level: value, muted: false });
    window.clearTimeout(pending.current);
    // On limite les appels pendant qu'on fait glisser.
    pending.current = window.setTimeout(() => invoke("volume_set", { level: value, muted: muted ? false : null }), 40);
  };

  return (
    <div className="tile volume-tile">
      <button
        className="round-btn"
        onClick={() => {
          setVolume({ level, muted: !muted });
          invoke("volume_set", { level: null, muted: !muted });
        }}
        aria-label={muted ? "Rétablir le son" : "Couper le son"}
      >
        <Icon size={16} />
      </button>
      <input
        type="range"
        className="slider"
        min={0}
        max={100}
        value={Math.round((muted ? 0 : level) * 100)}
        onChange={(e) => change(Number(e.target.value) / 100)}
        style={{ "--fill": `${(muted ? 0 : level) * 100}%` } as React.CSSProperties}
        aria-label="Volume"
        disabled={!volume}
      />
      <span className="volume-value">{volume ? `${Math.round((muted ? 0 : level) * 100)} %` : "—"}</span>
    </div>
  );
}
