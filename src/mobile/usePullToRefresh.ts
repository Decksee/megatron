import { useEffect, useRef, useState, type RefObject } from "react";

const TRIGGER = 72; // distance (px, après amortissement) à dépasser pour lancer l'actualisation
const MAX = 110;

/**
 * « Tirer pour actualiser » : en haut de la page, tirer vers le bas puis relâcher relance la lecture des données.
 * Écouteurs passifs : le défilement normal n'est jamais freiné.
 */
export function usePullToRefresh(ref: RefObject<HTMLElement | null>, enabled: boolean, onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const pullRef = useRef(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    const set = (v: number) => {
      pullRef.current = v;
      setPull(v);
    };
    const onStart = (e: TouchEvent) => {
      start.current = el.scrollTop <= 0 && !refreshing ? e.touches[0].clientY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (start.current == null) return;
      const dy = e.touches[0].clientY - start.current;
      // Le doigt remonte ou la page a défilé : ce n'est pas un « tirer pour actualiser ».
      if (dy <= 0 || el.scrollTop > 0) return set(0);
      set(Math.min(MAX, dy * 0.45));
    };
    const onEnd = async () => {
      if (start.current == null) return;
      start.current = null;
      if (pullRef.current < TRIGGER) return set(0);
      setRefreshing(true);
      set(56);
      try {
        await Promise.all([refreshRef.current(), new Promise((r) => setTimeout(r, 650))]);
      } finally {
        setRefreshing(false);
        set(0);
      }
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, enabled, refreshing]);

  return { pull, refreshing, ready: pull >= TRIGGER };
}
