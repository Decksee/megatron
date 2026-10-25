import { useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { DATA_CHANGED } from "../db";
import { native } from "./native";

const isTauri = "__TAURI_INTERNALS__" in window;

/**
 * Garde Android à jour : notification « tâche en cours », alarmes des rappels et widget.
 * - au lancement : permission de notifier, puis première mise à jour ;
 * - à chaque changement de données (groupés sur ~1 s) : nouvelle mise à jour ;
 * - au retour dans l'appli : rechargement, car les boutons des notifications modifient la base appli fermée.
 */
export function useNativeSync() {
  useEffect(() => {
    if (!isTauri) return;
    let timer: number | undefined;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void native("refresh").catch(console.error), 900);
    };

    (async () => {
      try {
        if (!(await isPermissionGranted())) await requestPermission();
      } catch (e) {
        console.error(e);
      }
      refresh();
    })();

    const unlisten = listen(DATA_CHANGED, refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") void emit(DATA_CHANGED);
    };
    document.addEventListener("visibilitychange", onVisible);
    // Volet des notifications refermé (signal de MainActivity) : « Fait » ou « Replanifier » ont pu changer la base.
    // Seconde relecture un peu après, au cas où Android finissait encore d'écrire.
    let again: number | undefined;
    const onResync = () => {
      void emit(DATA_CHANGED);
      window.clearTimeout(again);
      again = window.setTimeout(() => void emit(DATA_CHANGED), 1200);
    };
    window.addEventListener("megatron-resync", onResync);
    // Icônes de la barre d'état : sombres en thème clair, claires en thème sombre (suit le thème de l'appli).
    const bars = () => void native("setSystemBars", { light: document.documentElement.dataset.theme === "light" }).catch(() => {});
    bars();
    const themeWatch = new MutationObserver(bars);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(again);
      unlisten.then((fn) => fn());
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("megatron-resync", onResync);
      themeWatch.disconnect();
    };
  }, []);
}
