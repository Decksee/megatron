import { useMemo } from "react";
import { motion } from "motion/react";

const COLORS = ["var(--accent)", "#ffd60a", "#64d2ff", "#ff6482", "#bf5af2", "#ffffff"];
const PIECES = 34;

/** Petite pluie de confettis qui jaillit du centre de l'encoche (fin de focus réussie). */
export function Confetti() {
  // Tirées une seule fois : l'encoche se redessine chaque seconde (horloge), les confettis ne doivent pas sauter.
  const pieces = useMemo(
    () =>
      Array.from({ length: PIECES }, (_, i) => {
        // Répartis en éventail vers le bas et les côtés, avec un peu de hasard.
        const angle = (Math.PI * (i + 0.5)) / PIECES + (Math.random() - 0.5) * 0.3;
        const distance = 60 + Math.random() * 90;
        return {
          x: Math.cos(angle) * distance * 1.6,
          y: Math.sin(angle) * distance * 0.7 + 14,
          rotate: Math.random() * 540 - 270,
          duration: 1.6 + Math.random() * 0.6,
          delay: Math.random() * 0.15,
          round: i % 3 === 0,
          color: COLORS[i % COLORS.length],
        };
      }),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <motion.i
          key={i}
          style={{
            background: p.color,
            borderRadius: p.round ? "50%" : 1.5,
            width: p.round ? 6 : 5,
            height: p.round ? 6 : 10,
          }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
          animate={{ x: [0, p.x, p.x * 1.08], y: [0, p.y, p.y + 46], opacity: [1, 1, 0], rotate: p.rotate, scale: 1 }}
          transition={{ duration: p.duration, ease: "easeOut", delay: p.delay, times: [0, 0.55, 1] }}
        />
      ))}
    </div>
  );
}
