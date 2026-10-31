import { useEffect, useId, useRef } from "react";
import { FOCUS_MAX_MINUTES, focusStep } from "../focus";
import { motion, useSpring, useTransform } from "motion/react";

const SIZE = 172;
const R = 70;
const STROKE = 7;
const TICKS = 60;
/** Le cadran fait le tour en 2 h ; au-delà, il reste plein. */
const FULL_MINUTES = 120;

/**
 * Cadran de durée façon minuteur : graduations, arc en dégradé et curseur au bout.
 * On règle la durée en faisant glisser le curseur (ou en cliquant sur le cadran),
 * ou à la molette, par pas de 5 minutes.
 */
export function FocusDial({ minutes, onChange, now }: { minutes: number; onChange: (m: number) => void; now: Date }) {
  const id = useId().replace(/:/g, "");
  const c = SIZE / 2;
  const ratio = Math.min(1, minutes / FULL_MINUTES);
  const circumference = 2 * Math.PI * R;
  // Une seule valeur animée : l'arc et le curseur restent ensemble, le curseur suit le cercle.
  const progress = useSpring(ratio, { stiffness: 160, damping: 24 });
  useEffect(() => progress.set(ratio), [ratio, progress]);
  const dashOffset = useTransform(progress, (r) => circumference * (1 - r));
  const knobX = useTransform(progress, (r) => c + R * Math.cos(r * 2 * Math.PI - Math.PI / 2));
  const knobY = useTransform(progress, (r) => c + R * Math.sin(r * 2 * Math.PI - Math.PI / 2));
  const end = new Date(now.getTime() + minutes * 60_000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const last = useRef(minutes);
  last.current = minutes;

  /** Position de la souris → minutes (5 à 120), sans sauter de 120 à 5 en passant par le haut. */
  const fromPointer = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    let turn = Math.atan2(dx, -dy) / (2 * Math.PI); // 0 en haut, sens horaire
    if (turn < 0) turn += 1;
    let m = Math.round((turn * FULL_MINUTES) / 5) * 5;
    const prev = Math.min(last.current, FULL_MINUTES);
    if (prev >= FULL_MINUTES * 0.75 && m <= FULL_MINUTES * 0.25) m = FULL_MINUTES;
    else if (prev <= FULL_MINUTES * 0.25 && m >= FULL_MINUTES * 0.75) m = 5;
    m = Math.min(FULL_MINUTES, Math.max(5, m));
    if (m !== last.current) {
      last.current = m;
      onChange(m);
    }
  };

  return (
    <div
      className="focus-dial"
      onWheel={(e) => onChange(Math.min(FOCUS_MAX_MINUTES, Math.max(5, minutes + (e.deltaY < 0 ? focusStep(minutes, true) : -focusStep(minutes, false)))))}
      title="Fais glisser le curseur ou utilise la molette"
    >
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        aria-hidden="true"
        className="dial-svg"
        onPointerDown={(e) => {
          // Seulement sur l'anneau : un clic au centre (sur le chiffre) ne change rien.
          const r = e.currentTarget.getBoundingClientRect();
          const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
          if (d < (R * 0.6 * r.width) / SIZE) return;
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          fromPointer(e);
        }}
        onPointerMove={(e) => dragging.current && fromPointer(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
      >
        <defs>
          <linearGradient id={`dial-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--accent)" />
          </linearGradient>
        </defs>
        {/* Graduations : une toutes les 2 min (le tour = 2 h), plus longues toutes les 10 min. */}
        {Array.from({ length: TICKS }, (_, i) => {
          const a = (i / TICKS) * 2 * Math.PI - Math.PI / 2;
          const major = i % 5 === 0;
          const r1 = R + STROKE / 2 + 5;
          const r2 = r1 + (major ? 6 : 3);
          const lit = i / TICKS <= ratio;
          return (
            <line
              key={i}
              x1={c + r1 * Math.cos(a)}
              y1={c + r1 * Math.sin(a)}
              x2={c + r2 * Math.cos(a)}
              y2={c + r2 * Math.sin(a)}
              className={lit ? "dial-tick lit" : "dial-tick"}
              strokeWidth={major ? 1.6 : 1}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx={c} cy={c} r={R} fill="none" className="ring-track" strokeWidth={STROKE} />
        <motion.circle
          cx={c}
          cy={c}
          r={R}
          fill="none"
          stroke={`url(#dial-${id})`}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          style={{ strokeDashoffset: dashOffset }}
          transform={`rotate(-90 ${c} ${c})`}
        />
        <motion.circle r={7} className="dial-knob" cx={knobX} cy={knobY} />
      </svg>
      <div className="dial-center">
        <motion.span key={minutes} className="dial-value" initial={{ opacity: 0.4, y: 4 }} animate={{ opacity: 1, y: 0 }}>
          {minutes}
        </motion.span>
        <span className="dial-unit">min</span>
        <span className="dial-end">fin à {end}</span>
      </div>
    </div>
  );
}
