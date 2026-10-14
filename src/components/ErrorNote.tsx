import { useState } from "react";
import { AlertCircle, ChevronDown } from "lucide-react";
import { explainError, type Service } from "../errors";

/** Erreur expliquée : ce qui se passe, quoi faire, et le message brut replié dans « Détails ». */
export function ErrorNote({ raw, service }: { raw: string; service: Service }) {
  const [open, setOpen] = useState(false);
  const { title, hint } = explainError(raw, service);
  return (
    <div className="status error error-note" role="alert">
      <AlertCircle size={15} className="error-note-icon" />
      <div className="error-note-body">
        <b>{title}</b>
        <span>{hint}</span>
        <button type="button" className="error-note-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          Détails <ChevronDown size={11} className={open ? "open" : undefined} />
        </button>
        {open && <code className="error-note-raw">{raw}</code>}
      </div>
    </div>
  );
}
