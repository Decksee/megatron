import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Mood } from "../mood";

/**
 * La mascotte Mégatron : un robot-encoche (corps noir à petites cornes, yeux verts, voyant).
 * `bare` : seulement les yeux et le voyant, posés sur l'encoche qui sert de corps.
 */

const GREEN = "#5be36b";
const RED = "#ff4d4d";

type Eyes = "lines" | "determined" | "smile" | "arcs" | "angry" | "round" | "ring" | "dots";

const EYES: Record<Mood, Eyes> = {
  idle: "lines",
  sleep: "lines",
  work: "smile",
  focus: "determined",
  paused: "arcs",
  happy: "smile",
  suspicious: "angry",
  angry: "angry",
  alert: "round",
  listen: "round",
  think: "dots",
  timer: "ring",
};

interface Props {
  mood: Mood;
  /** Hauteur affichée en px (la largeur suit). */
  size?: number;
  bare?: boolean;
  cursor?: { x: number; y: number } | null;
}

// Repère : 100 × 56. Yeux autour de x = 40 et x = 60, y = 33 ; voyant à droite.
const EYE_L = 40;
const EYE_R = 60;
const EYE_Y = 33;
const DOT_X = 76;

function EyeShapes({ kind, color }: { kind: Eyes; color: string }) {
  const stroke = { stroke: color, strokeWidth: 3.6, strokeLinecap: "round" as const, fill: "none" };
  switch (kind) {
    case "determined":
      // Les yeux du logo : demi-lunes inclinées vers le centre.
      return (
        <>
          <path d={`M${EYE_L - 8} ${EYE_Y - 5} L${EYE_L + 6} ${EYE_Y - 1} Q${EYE_L + 4} ${EYE_Y + 6} ${EYE_L - 2} ${EYE_Y + 5} Q${EYE_L - 7} ${EYE_Y + 3} ${EYE_L - 8} ${EYE_Y - 5} Z`} fill={color} />
          <path d={`M${EYE_R + 8} ${EYE_Y - 5} L${EYE_R - 6} ${EYE_Y - 1} Q${EYE_R - 4} ${EYE_Y + 6} ${EYE_R + 2} ${EYE_Y + 5} Q${EYE_R + 7} ${EYE_Y + 3} ${EYE_R + 8} ${EYE_Y - 5} Z`} fill={color} />
        </>
      );
    case "lines":
      return (
        <>
          <line x1={EYE_L - 6} y1={EYE_Y} x2={EYE_L + 5} y2={EYE_Y} {...stroke} />
          <line x1={EYE_R - 5} y1={EYE_Y} x2={EYE_R + 6} y2={EYE_Y} {...stroke} />
        </>
      );
    case "angry":
      return (
        <>
          <path d={`M${EYE_L - 8} ${EYE_Y - 7} L${EYE_L + 6} ${EYE_Y} Q${EYE_L + 3} ${EYE_Y + 6} ${EYE_L - 2} ${EYE_Y + 5} Q${EYE_L - 7} ${EYE_Y + 2} ${EYE_L - 8} ${EYE_Y - 7} Z`} fill={color} />
          <path d={`M${EYE_R + 8} ${EYE_Y - 7} L${EYE_R - 6} ${EYE_Y} Q${EYE_R - 3} ${EYE_Y + 6} ${EYE_R + 2} ${EYE_Y + 5} Q${EYE_R + 7} ${EYE_Y + 2} ${EYE_R + 8} ${EYE_Y - 7} Z`} fill={color} />
        </>
      );
    case "smile":
      return (
        <>
          <path d={`M${EYE_L - 6} ${EYE_Y - 3} Q${EYE_L} ${EYE_Y + 6} ${EYE_L + 6} ${EYE_Y - 3}`} {...stroke} />
          <path d={`M${EYE_R - 6} ${EYE_Y - 3} Q${EYE_R} ${EYE_Y + 6} ${EYE_R + 6} ${EYE_Y - 3}`} {...stroke} />
        </>
      );
    case "arcs":
      return (
        <>
          <path d={`M${EYE_L - 6} ${EYE_Y + 3} Q${EYE_L} ${EYE_Y - 6} ${EYE_L + 6} ${EYE_Y + 3}`} {...stroke} />
          <path d={`M${EYE_R - 6} ${EYE_Y + 3} Q${EYE_R} ${EYE_Y - 6} ${EYE_R + 6} ${EYE_Y + 3}`} {...stroke} />
        </>
      );
    case "round":
      return (
        <>
          <ellipse cx={EYE_L} cy={EYE_Y} rx={5} ry={6} fill={color} />
          <ellipse cx={EYE_R} cy={EYE_Y} rx={5} ry={6} fill={color} />
        </>
      );
    case "ring":
      // Chrono : un anneau qui tourne à la place des yeux.
      return (
        <motion.circle
          cx={50}
          cy={EYE_Y}
          r={7}
          {...stroke}
          strokeDasharray="30 14"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          style={{ transformOrigin: `50px ${EYE_Y}px` }}
        />
      );
    case "dots":
      return (
        <>
          {[42, 50, 58].map((x, i) => (
            <motion.circle
              key={x}
              cx={x}
              cy={EYE_Y}
              r={2.6}
              fill={color}
              animate={{ opacity: [0.3, 1, 0.3], cy: [EYE_Y, EYE_Y - 2, EYE_Y] }}
              transition={{ duration: 1, repeat: Infinity, delay: i * 0.18 }}
            />
          ))}
        </>
      );
  }
}

export function Bot({ mood, size = 24, bare = false, cursor }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [blink, setBlink] = useState(false);
  const kind = EYES[mood];
  const red = mood === "angry" || mood === "suspicious";
  const color = red ? RED : GREEN;
  const canBlink = kind === "determined" || kind === "round" || kind === "smile";

  // Au repos, il « cligne » : les traits s'ouvrent brièvement en yeux ronds.
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        if (kind === "lines" && mood !== "sleep") {
          setPeek(true);
          window.setTimeout(() => setPeek(false), 260);
        } else if (canBlink) {
          setBlink(true);
          window.setTimeout(() => setBlink(false), 120);
        }
        loop();
      }, 2600 + Math.random() * 3400);
    };
    loop();
    return () => window.clearTimeout(t);
  }, [kind, canBlink, mood]);

  // Regard : les yeux glissent un peu vers la souris.
  let look = { x: 0, y: 0 };
  if (cursor && ref.current && kind !== "ring" && kind !== "dots") {
    const r = ref.current.getBoundingClientRect();
    const dx = cursor.x - (r.left + r.width / 2);
    const dy = cursor.y - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy) || 1;
    const k = Math.min(1, dist / 140);
    look = { x: (dx / dist) * 3 * k, y: (dy / dist) * 1.6 * k };
  }

  const shown: Eyes = peek ? "round" : kind;
  const viewBox = bare ? "22 18 64 30" : "0 0 100 56";
  const width = bare ? (size * 64) / 30 : (size * 100) / 56;

  return (
    <motion.svg
      ref={ref}
      viewBox={viewBox}
      width={width}
      height={size}
      className="bot"
      style={{ overflow: "visible" }}
      animate={mood === "angry" ? { x: [0, -1, 1, -0.6, 0.6, 0] } : { x: 0 }}
      transition={mood === "angry" ? { duration: 0.35, repeat: Infinity, repeatDelay: 0.3 } : { duration: 0.2 }}
      aria-hidden="true"
    >
      {!bare && (
        <g className="bot-body">
          {/* Petites cornes */}
          <path d="M24 15 C20 9 21 4 25 2 C26 7 30 11 35 13 Z" fill="#0b0c0f" />
          <path d="M76 15 C80 9 79 4 75 2 C74 7 70 11 65 13 Z" fill="#0b0c0f" />
          <rect x={6} y={12} width={88} height={42} rx={21} fill="#0b0c0f" />
          <rect x={6} y={12} width={88} height={42} rx={21} fill="none" stroke="#ffffff" strokeOpacity={0.08} strokeWidth={1} />
        </g>
      )}

      {/* Seuls les yeux et le voyant brillent, comme sur le logo. */}
      <g style={{ filter: `drop-shadow(0 0 ${bare ? 2.5 : 3}px ${color})` }}>
      <motion.g
        animate={{ x: look.x, y: look.y, scaleY: blink ? 0.12 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 22, scaleY: { duration: 0.08 } }}
        style={{ transformOrigin: `50px ${EYE_Y}px` }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.g
            key={shown + color}
            initial={{ opacity: 0, scaleY: 0.4 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.4 }}
            transition={{ duration: 0.14 }}
            style={{ transformOrigin: `50px ${EYE_Y}px` }}
          >
            <EyeShapes kind={shown} color={color} />
          </motion.g>
        </AnimatePresence>
      </motion.g>

      {/* Voyant : pulse quand il travaille ou écoute. */}
      {kind !== "ring" && (
        <motion.circle
          cx={DOT_X}
          cy={EYE_Y - 1}
          r={3.4}
          fill={color}
          animate={
            mood === "work" || mood === "listen" || mood === "focus" || mood === "alert"
              ? { opacity: [1, 0.35, 1] }
              : { opacity: mood === "sleep" ? 0.35 : 1 }
          }
          transition={{ duration: 1.6, repeat: mood === "sleep" || mood === "idle" ? 0 : Infinity }}
        />
      )}
      {mood === "sleep" && (
        <motion.text
          x={DOT_X + 4}
          y={EYE_Y - 8}
          fontSize={8}
          fontWeight={800}
          fill={GREEN}
          animate={{ opacity: [0, 1, 0], y: [EYE_Y - 6, EYE_Y - 14] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        >
          z
        </motion.text>
      )}
      </g>
    </motion.svg>
  );
}
