import { motion } from "motion/react";
import type { Mood } from "../mood";
import { Bot } from "./Bot";

/** État vide : le robot Mégatron, une phrase, et éventuellement des suggestions cliquables. */
export function EmptyState({
  title,
  hint,
  mood = "idle",
  children,
}: {
  title: string;
  hint?: string;
  mood?: Mood;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      className="empty-state"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <Bot mood={mood} size={38} />
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {children && <div className="empty-actions">{children}</div>}
    </motion.div>
  );
}
