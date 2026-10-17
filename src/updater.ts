import { useEffect } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listEntries, listFocusSessions, listSettings, setSetting, type Settings } from "./db";
import { activeFocus } from "./focus";
import { aiStore } from "./ai/session";
import { isLeader } from "./leader";
import { notify } from "./notify";

/**
 * Mises à jour automatiques : la fenêtre « première » regarde au démarrage puis toutes les 30 min
 * si une nouvelle version est publiée, et la fenêtre Mégatron regarde aussi quand on la ramène au premier plan.
 * Pas besoin de relancer l'app pour voir le bandeau. Les mises à jour sont signées : l'app n'installe que les tiennes.
 */

const FIRST_CHECK_MS = 30_000;
/** Mise à jour automatique : on regarde chaque minute si le moment est bon pour installer. */
const AUTO_TICK_MS = 60_000;
/** Inactivité (clavier, souris) à partir de laquelle on peut installer sans gêner. */
const AUTO_IDLE_S = 3 * 60;
/** Juste après le démarrage, une mise à jour prête s'installe sans attendre une pause. */
const STARTUP_WINDOW_MS = 3 * 60_000;
const CHECK_EVERY_MS = 30 * 60_000;
/** Vérification au retour sur la fenêtre : au plus une fois par période. */
const FOCUS_CHECK_MIN_MS = 2 * 60_000;
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

/** Mises à jour automatiques (activées par défaut) : téléchargées puis installées toutes seules. */
export const autoUpdateOn = (settings: Settings) => settings.auto_update !== "0";

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
        const auto = autoUpdateOn(await listSettings());
        if (update && update.version !== notified && !auto) {
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

let lastFocusCheck = 0;

/**
 * Fenêtre Mégatron : quand elle revient au premier plan (ouverte, ressortie de la barre des tâches),
 * on revérifie s'il y a une mise à jour — le bandeau apparaît sans relancer l'app.
 */
export function useUpdateCheckOnFocus() {
  useEffect(() => {
    if (!isTauri || import.meta.env.DEV) return;
    const run = () => {
      if (Date.now() - lastFocusCheck < FOCUS_CHECK_MIN_MS) return;
      lastFocusCheck = Date.now();
      void checkForUpdate().catch((e) => console.error("Vérification des mises à jour impossible :", e));
    };
    run();
    const onVisible = () => document.visibilityState === "visible" && run();
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

// ---------- Mise à jour automatique ----------

/** Mise à jour déjà téléchargée, prête à être installée. */
let ready: Update | null = null;
let downloading = false;
const startedAt = Date.now();

/** Rien en cours qu'une relance couperait : ni focus, ni minuteur, ni échange avec l'IA. */
async function nothingRunning() {
  const ai = aiStore.get();
  if (ai.busy || ai.transcribing || ai.conversing || ai.recording) return false;
  const [sessions, entries] = await Promise.all([listFocusSessions(), listEntries()]);
  return !activeFocus(sessions) && !entries.some((e) => e.ended_at == null);
}

/**
 * Fenêtre « première » : dès qu'une nouvelle version est connue, elle est téléchargée en arrière-plan,
 * puis installée en silence au bon moment — juste après le démarrage, ou quand le PC est inactif depuis
 * quelques minutes — jamais pendant un focus, un minuteur ou une conversation. Mégatron se relance seul.
 */
export function useAutoUpdate() {
  useEffect(() => {
    if (!isTauri || import.meta.env.DEV) return;
    const id = window.setInterval(async () => {
      try {
        if (!(await isLeader())) return;
        const s = await listSettings();
        const pending = availableUpdate(s);
        if (!autoUpdateOn(s) || !pending || !isNewer(pending.version, await getVersion())) return;

        if (!ready || ready.version !== pending.version) {
          if (downloading) return;
          downloading = true;
          try {
            const update = await check();
            if (update) {
              await update.download();
              ready = update;
            }
          } finally {
            downloading = false;
          }
          return; // on installera au prochain passage
        }

        const justStarted = Date.now() - startedAt < STARTUP_WINDOW_MS;
        const idle = await invoke<number>("idle_seconds").catch(() => 0);
        if (!justStarted && idle < AUTO_IDLE_S) return;
        if (!(await nothingRunning())) return;

        await notify("Mise à jour de Mégatron", `Installation de la version ${ready.version}… Mégatron redémarre dans un instant.`);
        await ready.install(); // installateur silencieux : il ferme puis relance Mégatron
        await relaunch();
      } catch (e) {
        console.error("Mise à jour automatique impossible :", e);
      }
    }, AUTO_TICK_MS);
    return () => window.clearInterval(id);
  }, []);
}
