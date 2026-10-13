import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

const isTauri = "__TAURI_INTERNALS__" in window;
const PEAK_POLL_MS = 60;

/**
 * Barre de lecture façon Samsung : la partie jouée est une barre épaisse dont le dessus se bombe
 * en bosses douces qui bougent au rythme du son réellement joué (niveau lu côté Rust).
 * Le reste est un trait fin, avec un curseur rond au bout. En pause, la bosse se dégonfle.
 */
export function SoundCurves({
  ratio,
  playing,
  width,
  height,
}: {
  ratio: number;
  playing: boolean;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const level = useRef(0);
  const target = useRef(0);
  const ratioRef = useRef(ratio);
  ratioRef.current = ratio;

  // Niveau sonore réel (ou une respiration douce dans l'aperçu navigateur).
  useEffect(() => {
    if (!playing) {
      target.current = 0;
      return;
    }
    if (!isTauri) {
      const id = setInterval(() => (target.current = 0.35 + Math.random() * 0.5), 220);
      return () => clearInterval(id);
    }
    let alive = true;
    const id = setInterval(() => {
      invoke<number>("audio_peak")
        .then((p) => alive && (target.current = Math.min(1, p * 1.5)))
        .catch(() => {});
    }, PEAK_POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [playing]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue("--accent").trim() || "#4fe06a";
    const fgRgb = css.getPropertyValue("--fg-rgb").trim() || "255 255 255";
    const text = css.getPropertyValue("--text").trim() || "#fff";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const thumbR = 4.5;
    const thick = 4.5; // épaisseur de la partie jouée (hors bosse)
    // La barre est centrée verticalement (alignée sur le texte de la pilule) ; la bosse monte au-dessus.
    const baseY = height / 2;
    let frame = 0;
    const start = performance.now();

    const draw = (now: number) => {
      // Lissage : monte vite, redescend doucement.
      const k = target.current > level.current ? 0.3 : 0.07;
      level.current += (target.current - level.current) * k;
      const t = reduce ? 0 : (now - start) / 1000;
      const left = thumbR;
      const right = width - thumbR;
      const x1 = left + (right - left) * Math.min(1, Math.max(0, ratioRef.current));
      const maxBump = baseY - thick / 2 - 1.5;
      const amp = maxBump * (0.12 + level.current * 0.6);

      ctx.clearRect(0, 0, width, height);

      // Reste du morceau : trait fin.
      ctx.beginPath();
      ctx.moveTo(x1, baseY);
      ctx.lineTo(right, baseY);
      ctx.strokeStyle = `rgb(${fgRgb} / 0.22)`;
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.stroke();

      // Partie jouée : barre épaisse dont le dessus ondule en bosses douces.
      if (x1 > left) {
        const span = x1 - left;
        const top = (x: number) => {
          const u = (x - left) / span;
          // Enveloppe : la bosse retombe à zéro aux deux extrémités.
          const envelope = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 1.5;
          const wave =
            0.75 * (0.5 + 0.5 * Math.sin(u * Math.PI * 1.2 - t * 1.4)) +
            0.25 * (0.5 + 0.5 * Math.sin(u * Math.PI * 2.4 + t * 2));
          return baseY - thick / 2 - wave * amp * envelope;
        };
        ctx.beginPath();
        ctx.moveTo(left, baseY + thick / 2);
        ctx.arc(left, baseY, thick / 2, Math.PI / 2, (Math.PI * 3) / 2);
        for (let x = left; x <= x1; x += 1) ctx.lineTo(x, top(x));
        ctx.lineTo(x1, baseY + thick / 2);
        ctx.closePath();
        ctx.fillStyle = accent;
        ctx.fill();
      }

      // Curseur rond.
      ctx.beginPath();
      ctx.arc(x1, baseY, thumbR, 0, Math.PI * 2);
      ctx.fillStyle = text;
      ctx.fill();

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [width, height]);

  return <canvas ref={canvasRef} className="sound-curves" style={{ width, height }} aria-hidden="true" />;
}
