import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Ligne de puces (filtres de projets…) qui défile horizontalement : une flèche apparaît
 * de chaque côté où des puces sont cachées. La molette fait aussi défiler la ligne.
 */
export function ScrollChips({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    // Même état qu'avant : on garde l'objet, sinon chaque mesure relance un rendu (boucle sans fin).
    setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    for (const child of Array.from(el.children)) resize.observe(child);
    // Molette verticale → défilement horizontal de la ligne.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      resize.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  });

  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.7), behavior: "smooth" });
  };

  return (
    <div className={`scroll-chips${edges.left ? " at-left" : ""}${edges.right ? " at-right" : ""}`}>
      {edges.left && (
        <button type="button" className="scroll-chips-arrow left" onClick={() => scroll(-1)} aria-label="Défiler vers la gauche">
          <ChevronLeft size={14} strokeWidth={2.4} />
        </button>
      )}
      <div ref={ref} className={`chips ${className}`} onScroll={measure}>
        {children}
      </div>
      {edges.right && (
        <button type="button" className="scroll-chips-arrow right" onClick={() => scroll(1)} aria-label="Défiler vers la droite">
          <ChevronRight size={14} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}
