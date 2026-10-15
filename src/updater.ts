import { useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { listSettings, setSetting, type Settings } from "./db";
import { isLeader } from "./leader";
import { notify } from "./notify";

/**
 * Mises à jour automatiques : la fenêtre « première » regarde au démarrage puis toutes les 6 h
 * si une nouvelle version est publiée. Les mises à jour sont signées : l'app n'installe que les tiennes.
 */

const FIRST_CHECK_MS = 30_000;
const CHECK_EVERY_MS = 6 * 3_600_000;
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface UpdateInfo {
  version: string;
  notes: string;
}

/** « 0.3.10 » est plus récent que « 0.3.9 » : comparaison nombre par nombre. */
export function isNewer(a: string, b: string) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

/**
 * Au démarrage : oublie une « mise à jour disponible » déjà installée (ou plus ancienne que la version
 * actuelle) et repère une mise à jour qui vient d'être faite, pour féliciter dans la fenêtre.
 */
async function reconcileVersion() {
  const installed = await getVersion();
  const s = await listSettings();
  const pending = availableUpdate(s);
  if (pending && !isNewer(pending.version, installed)) await setSetting("update_available", "");
  if (s.last_version && s.last_version !== installed && isNewer(installed, s.last_version)) {
    await setSetting("just_updated", installed);
  }
  if (s.last_version !== installed) await setSetting("last_version", installed);
}

export const availableUpdate = (settings: Settings): UpdateInfo | null => {
  try {
    return settings.update_available ? (JSON.parse(settings.update_available) as UpdateInfo) : null;
  } catch {
    return null;
  }
};

/** Cherche une mise à jour ; la note dans les réglages (toutes les fenêtres la voient). */
export async function checkForUpdate(): Promise<Update | null> {
  const update = await check();
  if (!update) {
    await setSetting("update_available", "");
    return null;
  }
  await setSetting("update_available", JSON.stringify({ version: update.version, notes: update.body ?? "" }));
  return update;
}

/** Télécharge, installe puis relance Mégatron. `onProgress` reçoit une part de 0 à 1. */
export async function installUpdate(onProgress?: (ratio: number) => void) {
  const update = await check();
  if (!update) throw new Error("Aucune mise à jour à installer.");
  let total = 0;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") total = event.data.contentLength ?? 0;
    else if (event.event === "Progress") {
      received += event.data.chunkLength;
      if (total) onProgress?.(Math.min(1, received / total));
    } else if (event.event === "Finished") onProgress?.(1);
  });
  await relaunch();
}

/** Vérification de fond (fenêtre première) ; une notification par nouvelle version. */
export function useUpdateCheck(settings: Settings) {
  const notified = settings.update_notified ?? "";
  useEffect(() => {
    if (!isTauri || import.meta.env.DEV) return;
    let stopped = false;
    void (async () => {
      if (await isLeader()) await reconcileVersion().catch(console.error);
    })();
    const run = async () => {
      if (stopped || !(await isLeader())) return;
      try {
        const update = await checkForUpdate();
        if (update && update.version !== notified) {
          await setSetting("update_notified", update.version);
          await notify("Mise à jour de Mégatron", `La version ${update.version} est disponible : ouvre Mégatron pour l'installer.`);
        }
      } catch (e) {
        console.error("Vérification des mises à jour impossible :", e);
      }
    };
    const first = window.setTimeout(run, FIRST_CHECK_MS);
    const every = window.setInterval(run, CHECK_EVERY_MS);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(every);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
