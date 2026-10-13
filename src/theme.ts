import { useEffect } from "react";
import type { Settings } from "./db";

export type ThemePref = "system" | "light" | "dark";

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "Système" },
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
];

/** Applique le thème choisi (par défaut : celui de Windows, suivi en direct). */
export function useTheme(settings: Settings) {
  const pref = (settings.theme as ThemePref) || "system";
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = pref === "system" ? (mq.matches ? "dark" : "light") : pref;
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);
}
