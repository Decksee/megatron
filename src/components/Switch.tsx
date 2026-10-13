import { motion } from "motion/react";

/** Interrupteur oui/non. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={checked ? "switch on" : "switch"}
      onClick={() => onChange(!checked)}
    >
      <motion.span
        className="switch-knob"
        layout
        transition={{ type: "spring", stiffness: 600, damping: 34 }}
      />
    </button>
  );
}
