import { useEffect, useRef } from "react";
import { micLevel } from "../ai/voice";
import { isSpeaking } from "../ai/speech";

export type VoicePhase = "listen" | "think" | "speak" | "idle";

const BARS = 13;

/**
 * Ondes de la pastille vocale, façon Siri : elles suivent ta voix quand il écoute,
 * ondulent quand il parle, et respirent doucement quand il réfléchit.
 * Animées directement (sans re-rendu React) pour rester fluides.
 */
export function VoiceWave({ phase }: { phase: VoicePhase }) {
  const ref = useRef<HTMLDivElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    const tick = (t: number) => {
      const bars = ref.current?.children;
      if (bars) {
        const p = phaseRef.current;
        // Niveau cible selon ce qu'il fait.
        const target =
          p === "listen"
            ? Math.min(1, micLevel() * 9)
            : p === "speak" || isSpeaking()
              ? 0.45 + 0.35 * Math.abs(Math.sin(t / 180))
              : p === "think"
                ? 0.18
                : 0.08;
        smooth += (target - smooth) * 0.25;
        for (let i = 0; i < bars.length; i++) {
          const center = 1 - Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2); // plus haut au milieu
          const wobble = 0.55 + 0.45 * Math.sin(t / (p === "think" ? 420 : 140) + i * 0.9);
          const h = 0.16 + smooth * (0.35 + 0.65 * center) * wobble;
          (bars[i] as HTMLElement).style.transform = `scaleY(${Math.min(1, h).toFixed(3)})`;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={`voice-wave ${phase}`} ref={ref} aria-hidden="true">
      {Array.from({ length: BARS }, (_, i) => (
        <i key={i} style={{ animationDelay: `${i * -0.25}s` }} />
      ))}
    </div>
  );
}
