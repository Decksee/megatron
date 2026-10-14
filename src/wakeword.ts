import type { Settings } from "./db";

/** Certitude minimale demandée à Windows selon la sensibilité choisie. */
export const WAKE_SENSITIVITY = [
  { value: "high", label: "Haute", threshold: 0.05 },
  { value: "normal", label: "Normale", threshold: 0.1 },
  { value: "low", label: "Basse", threshold: 0.25 },
];
export const wakeSensitivity = (settings: Settings) => settings.wake_sensitivity || "normal";
export const wakeThreshold = (settings: Settings) =>
  WAKE_SENSITIVITY.find((o) => o.value === wakeSensitivity(settings))?.threshold ?? 0.1;

