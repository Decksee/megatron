import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

const GAP = 6;
const MARGIN = 8;

/**
 * Place un menu flottant (position fixe) sous ou au-dessus de son bouton,
 * sans jamais sortir de l'encoche : en dehors, la fenêtre laisse passer les clics.
 */
export function usePopoverPosition(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  size: { width: number; height: number; minHeight?: number },
  deps: unknown[] = [],
) {
  const [style, setStyle] = useState<CSSProperties>({});
  const [upward, setUpward] = useState(false);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const b = anchorRef.current.getBoundingClientRect();
    const notch =
      anchorRef.current.closest(".notch")?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    const below = notch.bottom - b.bottom - GAP - MARGIN;
    const above = b.top - notch.top - GAP - MARGIN;
    const up = below < size.height && above > below;
    const width = Math.max(b.width, size.width);
    const left = Math.min(Math.max(b.left, notch.left + MARGIN), notch.right - MARGIN - width);
    const height = Math.max(size.minHeight ?? 0, Math.min(size.height, up ? above : below));
    // Si ça ne tient d'aucun côté, on glisse le menu pour qu'il reste dans l'encoche (quitte à couvrir le bouton).
    const top = up ? b.top - GAP - height : b.bottom + GAP;
    const clampedTop = Math.min(Math.max(top, notch.top + MARGIN), notch.bottom - MARGIN - height);
    setUpward(up);
    setStyle({ left, width, maxHeight: height, top: clampedTop });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, size.width, size.height, ...deps]);

  return { style, upward };
}

/** Ferme le menu sur un clic à l'extérieur ou quand la fenêtre perd le focus. */
export function useDismiss(open: boolean, refs: RefObject<HTMLElement | null>[], close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!refs.some((r) => r.current?.contains(t))) close();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", close);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

export const popoverMotion = (upward: boolean) => ({
  initial: { opacity: 0, scale: 0.96, y: upward ? 6 : -6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: upward ? 4 : -4, transition: { duration: 0.1 } },
  transition: { type: "spring", stiffness: 520, damping: 34 } as const,
});
