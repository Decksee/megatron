import { useEffect, useRef } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { setDragging } from "./ai/session";

/**
 * Fichiers glissés depuis l'Explorateur sur cette fenêtre. Tauri les intercepte (le « drop » HTML
 * ne reçoit rien) et donne leurs chemins ; on signale aussi le survol pour afficher la zone de dépôt.
 */
export function useFileDrop(onDrop: (paths: string[]) => void) {
  const ref = useRef(onDrop);
  ref.current = onDrop;
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") setDragging(true);
      else if (p.type === "leave") setDragging(false);
      else if (p.type === "drop") {
        setDragging(false);
        if (p.paths.length) ref.current(p.paths);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
