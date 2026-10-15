import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Trash2, X } from "lucide-react";

const DISARM_MS = 3500;

/**
 * Suppression en deux temps : le premier clic arme le bouton (« Supprimer ? » en rouge),
 * le second confirme. Il se désarme tout seul après quelques secondes ou si on clique ailleurs.
 */
export function ConfirmDelete({
  onConfirm,
  label = "Supprimer",
  ariaLabel,
  variant = "icon",
}: {
  onConfirm: () => unknown;
  /** Texte du bouton désarmé (variante « button »). */
  label?: string;
  ariaLabel: string;
  /** « icon » : petite croix (lignes de liste) ; « button » : bouton avec texte. */
  variant?: "icon" | "button";
}) {
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), DISARM_MS);
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setArmed(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [armed]);

  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {armed ? (
        <motion.button
          key="armed"
          ref={ref}
          className="confirm-delete armed"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ type: "spring", stiffness: 520, damping: 30 }}
          onClick={() => {
            setArmed(false);
            void onConfirm();
          }}
          aria-label={`Confirmer : ${ariaLabel}`}
        >
          <Trash2 size={12} /> Supprimer ?
        </motion.button>
      ) : (
        <motion.button
          key="idle"
          className={variant === "icon" ? "icon-btn confirm-delete" : "btn ghost confirm-delete"}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setArmed(true)}
          aria-label={ariaLabel}
        >
          {variant === "icon" ? (
            <X size={14} />
          ) : (
            <>
              <Trash2 size={13} /> {label}
            </>
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
}
