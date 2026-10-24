import { useEffect, useRef } from "react";

/**
 * Geste ou bouton « retour » d'Android : Tauri recule dans l'historique de la page tant qu'il y en a,
 * sinon il ferme l'appli. Chaque élément ouvert (panneau, page, onglet autre qu'Aujourd'hui)
 * ajoute une entrée ; « retour » ferme le dernier ouvert, comme dans une appli native.
 */
const stack: (() => void)[] = [];
let skip = 0;
// Entrées à ajouter une fois les retours en cours terminés (sinon l'ordre de l'historique se mélange).
let pending = 0;

const push = () => {
  if (skip > 0) pending++;
  else history.pushState({ megatron: true }, "");
};

window.addEventListener("popstate", () => {
  // Entrée retirée par l'appli elle-même (élément fermé au toucher) : rien d'autre à fermer.
  if (skip > 0) {
    skip--;
    if (skip === 0) for (; pending > 0; pending--) history.pushState({ megatron: true }, "");
    return;
  }
  stack.pop()?.();
});

/** `level` : quand il change, l'élément reste ouvert mais à un autre niveau (fiche → modification), avec sa propre entrée. */
export function useBack(open: boolean, close: () => void, level: unknown = null) {
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    if (!open) return;
    let popped = false;
    const entry = () => {
      popped = true;
      closeRef.current();
    };
    stack.push(entry);
    push();
    return () => {
      if (popped) return;
      // Fermé à l'écran : on retire aussi son entrée de l'historique.
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      skip++;
      history.back();
    };
  }, [open, level]);
}
