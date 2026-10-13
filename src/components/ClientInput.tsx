import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { UserPlus } from "lucide-react";
import { popoverMotion, useDismiss, usePopoverPosition } from "./popover";

const OPTION_HEIGHT = 32;
const MAX_VISIBLE = 5;

const normalize = (s: string) =>
  s
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Champ « client » : on tape un nom, Mégatron propose les clients déjà connus ;
 * un nom qui n'existe pas encore crée simplement un nouveau client.
 */
export function ClientInput({ value, onChange, clients }: { value: string; onChange: (v: string) => void; clients: string[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const query = normalize(value.trim());
  const matches = clients.filter((c) => !query || normalize(c).includes(query)).slice(0, 20);
  const exact = clients.some((c) => normalize(c) === query);
  const isNew = !!query && !exact;
  const rows = matches.length + (isNew ? 1 : 0);
  const show = open && rows > 0 && !(exact && matches.length === 1);

  const { style, upward } = usePopoverPosition(
    show,
    inputRef,
    { width: 220, height: Math.min(MAX_VISIBLE, rows) * OPTION_HEIGHT + 12, minHeight: OPTION_HEIGHT + 12 },
    [rows],
  );
  useDismiss(show, [inputRef, menuRef], () => setOpen(false));

  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
  };

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        placeholder="Nom du client"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(matches.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && matches[active]) {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {createPortal(
        <AnimatePresence>
          {show && (
            <motion.ul
              ref={menuRef}
              role="listbox"
              className="select-menu"
              style={{ ...style, transformOrigin: upward ? "bottom center" : "top center" }}
              {...popoverMotion(upward)}
            >
              {matches.map((c, i) => (
                <li
                  key={c}
                  role="option"
                  aria-selected={i === active}
                  className={`select-option${i === active ? " active" : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(c)}
                >
                  <span className="client-initial">{c.trim()[0]?.toUpperCase()}</span>
                  <span className="select-option-label">{c}</span>
                </li>
              ))}
              {isNew && (
                <li className="select-option new-client" onPointerDown={(e) => e.preventDefault()} onClick={() => setOpen(false)}>
                  <UserPlus size={13} />
                  <span className="select-option-label">Nouveau client : « {value.trim()} »</span>
                </li>
              )}
            </motion.ul>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
