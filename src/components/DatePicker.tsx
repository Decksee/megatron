import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { popoverMotion, useDismiss, usePopoverPosition } from "./popover";

interface Props {
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** Ajoute le choix de l'heure (colonnes heures / minutes). */
  withTime?: boolean;
  /** Permet de vider la date. */
  clearable?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** « chip » : petit bouton discret (date d'une tâche) au lieu d'un champ. */
  variant?: "field" | "chip";
  /** Texte du bouton « chip » (sinon la date). */
  chipLabel?: string;
  chipClassName?: string;
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];
const HOURS = Array.from({ length: 24 }, (_, h) => h);
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const CAL_WIDTH = 252;
const TIME_WIDTH = 116;
const HEIGHT = 262;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** 42 cases (6 semaines) commençant un lundi. */
function monthGrid(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

function format(d: Date, withTime: boolean) {
  if (!withTime) return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  const day = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  return `${day} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Arrondit aux 5 minutes suivantes (pour une date par défaut propre). */
function roundedNow() {
  const d = new Date();
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5);
  return d;
}

export function DatePicker({
  value,
  onChange,
  withTime = false,
  clearable = false,
  placeholder = "Choisir une date",
  ariaLabel,
  variant = "field",
  chipLabel,
  chipClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => value ?? new Date());
  const [direction, setDirection] = useState(0);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const today = new Date();

  const { style, upward } = usePopoverPosition(open, buttonRef, {
    width: withTime ? CAL_WIDTH + TIME_WIDTH : CAL_WIDTH,
    height: HEIGHT,
    minHeight: HEIGHT,
  });
  useDismiss(open, [buttonRef, panelRef], () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    setMonth(value ?? new Date());
    // Centre l'heure et la minute choisies dans leurs colonnes.
    requestAnimationFrame(() =>
      panelRef.current
        ?.querySelectorAll<HTMLElement>(".time-cell.selected")
        .forEach((el) => el.scrollIntoView({ block: "center" })),
    );
  }, [open]);

  const shiftMonth = (delta: number) => {
    setDirection(delta);
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  const pickDay = (day: Date) => {
    const base = value ?? roundedNow();
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), withTime ? base.getHours() : 0, withTime ? base.getMinutes() : 0);
    onChange(next);
    if (day.getMonth() !== month.getMonth()) shiftMonth(day > month ? 1 : -1);
    if (!withTime) setOpen(false);
  };

  const pickTime = (hours: number | null, minutes: number | null) => {
    const next = new Date(value ?? roundedNow());
    if (hours != null) next.setHours(hours);
    if (minutes != null) next.setMinutes(minutes);
    next.setSeconds(0, 0);
    onChange(next);
  };

  const monthLabel = month.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={
          variant === "chip"
            ? `date-chip${open ? " open" : ""}${value ? " set" : ""} ${chipClassName}`
            : `select date-trigger${open ? " open" : ""}${value ? "" : " empty"}`
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        <svg className="select-chevron" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        {(variant === "field" || chipLabel || value) && (
          <span className="select-label">{chipLabel ?? (value ? format(value, withTime) : placeholder)}</span>
        )}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label={ariaLabel ?? "Choisir une date"}
              className="date-panel"
              style={{ ...style, transformOrigin: upward ? "bottom left" : "top left" }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  buttonRef.current?.focus();
                }
              }}
              {...popoverMotion(upward)}
            >
              <div className="cal">
                <div className="cal-head">
                  <button type="button" className="cal-nav" onClick={() => shiftMonth(-1)} aria-label="Mois précédent">
                    ‹
                  </button>
                  <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                    <motion.span
                      key={monthLabel}
                      className="cal-month"
                      initial={{ opacity: 0, x: direction * 14 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: direction * -14 }}
                      transition={{ duration: 0.16 }}
                    >
                      {monthLabel}
                    </motion.span>
                  </AnimatePresence>
                  <button type="button" className="cal-nav" onClick={() => shiftMonth(1)} aria-label="Mois suivant">
                    ›
                  </button>
                </div>
                <div className="cal-grid cal-weekdays">
                  {WEEKDAYS.map((d, i) => (
                    <span key={i}>{d}</span>
                  ))}
                </div>
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={monthLabel}
                    className="cal-grid"
                    initial={{ opacity: 0, x: direction * 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: direction * -18 }}
                    transition={{ duration: 0.18 }}
                  >
                    {monthGrid(month).map((day) => {
                      const outside = day.getMonth() !== month.getMonth();
                      const selected = value && sameDay(day, value);
                      const isToday = sameDay(day, today);
                      return (
                        <button
                          type="button"
                          key={day.toISOString()}
                          className={`cal-day${outside ? " outside" : ""}${isToday ? " today" : ""}${selected ? " selected" : ""}`}
                          onClick={() => pickDay(day)}
                          aria-label={day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
                          aria-pressed={!!selected}
                        >
                          {selected && <motion.span layoutId="cal-selected" className="cal-selected" />}
                          <span className="cal-day-num">{day.getDate()}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                </AnimatePresence>
                <div className="cal-foot">
                  <button type="button" className="link" onClick={() => pickDay(new Date())}>
                    Aujourd'hui
                  </button>
                  {!withTime && (
                    <button
                      type="button"
                      className="link"
                      onClick={() => pickDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1))}
                    >
                      Demain
                    </button>
                  )}
                  {clearable && value && (
                    <button
                      type="button"
                      className="link muted"
                      onClick={() => {
                        onChange(null);
                        setOpen(false);
                      }}
                    >
                      Effacer
                    </button>
                  )}
                  {withTime && (
                    <button type="button" className="btn primary icon" onClick={() => setOpen(false)}>
                      OK
                    </button>
                  )}
                </div>
              </div>

              {withTime && (
                <div className="time-cols">
                  <div className="time-col" aria-label="Heures">
                    {HOURS.map((h) => (
                      <button
                        type="button"
                        key={h}
                        className={`time-cell${value?.getHours() === h ? " selected" : ""}`}
                        onClick={() => pickTime(h, null)}
                      >
                        {pad(h)}
                      </button>
                    ))}
                  </div>
                  <div className="time-col" aria-label="Minutes">
                    {MINUTES.map((m) => (
                      <button
                        type="button"
                        key={m}
                        className={`time-cell${value && Math.floor(value.getMinutes() / 5) * 5 === m ? " selected" : ""}`}
                        onClick={() => pickTime(null, m)}
                      >
                        {pad(m)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
