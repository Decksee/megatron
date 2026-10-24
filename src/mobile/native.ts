import { invoke } from "@tauri-apps/api/core";

/** Vrai dans l'application Android (fenêtre unique ouverte avec ?window=mobile). */
export const isMobileApp = () => document.documentElement.dataset.window === "mobile";

/** Appelle une fonction du plugin Android de Mégatron (MegatronPlugin.kt). */
export function native<T = unknown>(method: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>("native_call", { method, args: args ?? null });
}

/** Ouvre le sélecteur de fichiers Android et renvoie le texte du fichier choisi (null si annulé). */
export async function pickTextFile(): Promise<string | null> {
  try {
    return (await native<{ text: string }>("pickTextFile")).text;
  } catch (e) {
    if (String(e).includes("Aucun fichier")) return null;
    throw e;
  }
}

/** Ouvre le menu de partage Android avec ce contenu en pièce jointe (Drive, mail, WhatsApp…). */
export const shareFile = (fileName: string, text: string, title = "Exporter la sauvegarde") =>
  native("shareFile", { fileName, text, title, mimeType: "application/json" });
