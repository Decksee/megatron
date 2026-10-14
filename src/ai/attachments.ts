import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

/** Un fichier joint à un message pour l'assistant (lu par src-tauri/src/files.rs). */
export interface Attachment {
  name: string;
  mime: string;
  size: number;
  kind: "image" | "pdf" | "text";
  /** Base64 (images, PDF). */
  data?: string | null;
  /** Texte (texte, code, Word, Excel). */
  text?: string | null;
}

export const MAX_FILES = 10;

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

/** Lit les fichiers glissés ou choisis. Les erreurs (format, taille) sont renvoyées à part. */
export async function readPaths(paths: string[]) {
  const files: Attachment[] = [];
  const errors: string[] = [];
  for (const path of paths.slice(0, MAX_FILES)) {
    try {
      files.push(await invoke<Attachment>("read_attachment", { path }));
    } catch (e) {
      errors.push(String((e as Error)?.message ?? e));
    }
  }
  if (paths.length > MAX_FILES) errors.push(`${MAX_FILES} fichiers au maximum à la fois.`);
  return { files, errors };
}

/** Ouvre la fenêtre de choix de fichiers (bouton trombone). */
export async function pickPaths(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [
      {
        name: "Fichiers pour l'assistant",
        extensions: ["png", "jpg", "jpeg", "webp", "gif", "pdf", "docx", "xlsx", "txt", "md", "csv", "json", "html", "js", "ts", "py"],
      },
      { name: "Tous les fichiers", extensions: ["*"] },
    ],
  });
  if (!picked) return [];
  return Array.isArray(picked) ? picked : [picked];
}

/** Texte des fichiers convertis, à glisser dans le message (tous les fournisseurs savent le lire). */
export function textBlocks(files: Attachment[]) {
  return files
    .filter((f) => f.kind === "text" && f.text)
    .map((f) => `--- Fichier joint : ${f.name} ---\n${f.text}\n--- Fin de ${f.name} ---`)
    .join("\n\n");
}

/** Ligne gardée dans l'historique à la place des fichiers (ils ne sont pas sauvegardés). */
export const filesNote = (files: Attachment[]) =>
  files.length ? `\n[Fichiers joints à ce message : ${files.map((f) => f.name).join(", ")}]` : "";
