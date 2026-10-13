import { useState } from "react";
import { Bot } from "../components/Bot";
import type { Mood } from "../mood";

const MOODS: Mood[] = ["idle", "work", "paused", "focus", "suspicious", "angry", "happy", "sleep", "alert", "listen", "think", "timer"];

/** Galerie des humeurs de la mascotte (dev uniquement : http://localhost:1420/?wisp). */
export function WispGallery() {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      onMouseMove={(e) => setCursor({ x: e.clientX, y: e.clientY })}
      style={{ display: "flex", flexWrap: "wrap", gap: 28, padding: 32, background: "#1a1b1f", minHeight: "100%" }}
    >
      {MOODS.map((m) => (
        <div key={m} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, width: 120 }}>
          <Bot mood={m} size={56} cursor={cursor} />
          <div style={{ background: "#000", borderRadius: 14, padding: "4px 12px" }}>
            <Bot bare mood={m} size={20} cursor={cursor} />
          </div>
          <span style={{ color: "#8e8e93", fontSize: 12 }}>{m}</span>
        </div>
      ))}
    </div>
  );
}
