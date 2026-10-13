import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { popoverMotion, useDismiss, usePopoverPosition } from "./popover";

export interface SelectOption<T> {
  value: T;
  label: string;
  /** Pastille de couleur (projets). */
  color?: string;
  hint?: string;
}

interface Props<T> {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  className?: string;
  /** Plus compact (formulaires en ligne). */
  small?: boolean;
  ariaLabel?: string;
}

/** Au-delà, la liste défile. */
const MAX_VISIBLE = 5;
const OPTION_HEIGHT = 32;
const MENU_PADDING = 8;
const MAX_HEIGHT = MAX_VISIBLE * OPTION_HEIGHT + MENU_PADDING;

/**
 * Liste déroulante stylée (les <select> natifs sont dessinés par Windows).
 * Le menu est placé en position fixe et reste à l'intérieur de l'encoche :
 * en dehors, la fenêtre laisse passer les clics.
 */
export function Select<T extends string | number | null>({ value, options, onChange, className, small, ariaLabel }: Props<T>) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex];

  const { style: menuStyle, upward } = usePopoverPosition(open, buttonRef, {
    width: 160,
    height: Math.min(MAX_HEIGHT, options.length * OPTION_HEIGHT + MENU_PADDING),
    minHeight: OPTION_HEIGHT * 2 + MENU_PADDING,
  });
  useDismiss(open, [buttonRef, menuRef], () => setOpen(false));

  useEffect(() => {
    if (open) setActive(selectedIndex);
  }, [open]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const choose = (i: number) => {
    onChange(options[i].value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`select${small ? " small" : ""}${open ? " open" : ""}${className ? ` ${className}` : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        {selected?.color && <span className="chip-dot" style={{ background: selected.color }} />}
        <span className="select-label">{selected?.label ?? "—"}</span>
        <motion.svg
          className="select-chevron"
          viewBox="0 0 12 12"
          width="10"
          height="10"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </motion.svg>
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.ul
              ref={menuRef}
              role="listbox"
              className="select-menu"
              style={{ ...menuStyle, transformOrigin: upward ? "bottom center" : "top center" }}
              {...popoverMotion(upward)}
            >
              {options.map((o, i) => (
                <li
                  key={String(o.value)}
                  data-index={i}
                  role="option"
                  aria-selected={i === selectedIndex}
                  className={`select-option${i === active ? " active" : ""}${i === selectedIndex ? " selected" : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => choose(i)}
                >
                  {o.color && <span className="chip-dot" style={{ background: o.color }} />}
                  <span className="select-option-label">{o.label}</span>
                  {o.hint && <span className="muted small">{o.hint}</span>}
                  {i === selectedIndex && <span className="select-check">✓</span>}
                </li>
              ))}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
