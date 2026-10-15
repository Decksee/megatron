import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Pencil, Plus } from "lucide-react";
import { createExtra, deleteExtra, deletePayment, toggleExtra, updateExtra, type Extra, type Project } from "../db";
import type { Data } from "../useData";
import { TaskList } from "./TaskList";
import { DatePicker } from "../components/DatePicker";
import { formatDay, formatMoney, projectMoney, recordPayment, toIsoDay, type Ledger } from "../projects";

/** Montant saisi en français (« 1 200,50 ») → nombre. */
const parseAmount = (raw: string) => Number(raw.replace(/\s/g, "").replace(",", ".")) || 0;

/** Barre « Payé / Reste » d'un projet. */
export function PaidBar({ project, ledger }: { project: Project; ledger: Ledger }) {
  const m = projectMoney(project, ledger);
  if (m.total <= 0) return null;
  return (
    <div className="paid-bar">
      <div className="paid-track">
        <motion.i initial={false} animate={{ width: `${m.ratio * 100}%` }} transition={{ type: "spring", stiffness: 220, damping: 30 }} />
      </div>
      <div className="paid-legend">
        <span>
          Payé <b>{formatMoney(m.paid, project.currency)}</b>
        </span>
        <span className={m.remaining > 0 ? "unpaid" : "paid-ok"}>
          {m.remaining > 0 ? (
            <>
              Reste <b>{formatMoney(m.remaining, project.currency)}</b>
            </>
          ) : (
            <>
              <Check size={12} /> Tout est payé
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** Modification d'un extra en place : nom (qui grandit avec le texte) et prix. Entrée enregistre, Échap annule. */
function ExtraEdit({ extra, onDone }: { extra: Extra; onDone: () => void }) {
  const [title, setTitle] = useState(extra.title);
  const [price, setPrice] = useState(String(extra.price));
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const save = async () => {
    const t = title.replace(/\s+/g, " ").trim();
    const value = parseAmount(price);
    onDone();
    if (t && (t !== extra.title || value !== extra.price)) await updateExtra(extra.id, t, value);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onDone();
    }
  };

  return (
    <form
      className="extra-edit"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      // Enregistre quand on clique en dehors du formulaire.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) void save();
      }}
    >
      <textarea
        ref={ref}
        className="task-title-edit"
        rows={1}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={keys}
        aria-label="Nom de l'extra"
      />
      <input
        className="amount-input"
        inputMode="decimal"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        onKeyDown={keys}
        aria-label="Prix de l'extra"
      />
      <button type="submit" className="btn primary icon" aria-label="Enregistrer">
        <Check size={13} strokeWidth={2.6} />
      </button>
    </form>
  );
}

function ExtraRow({ extra, project, tasks, projects }: { extra: Extra; project: Project; tasks: Data["tasks"]; projects: Data["projects"] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const own = tasks.filter((t) => t.extra_id === extra.id);
  const done = own.filter((t) => t.done).length;
  return (
    <li className={extra.done ? "extra done" : "extra"}>
      <div className="extra-head">
        <motion.button
          className="check"
          whileTap={{ scale: 0.85 }}
          onClick={() => toggleExtra(extra)}
          aria-label={extra.done ? "Marquer à faire" : "Marquer livré"}
        >
          {extra.done ? <Check size={11} strokeWidth={3} /> : null}
        </motion.button>
        {editing ? (
          <ExtraEdit extra={extra} onDone={() => setEditing(false)} />
        ) : (
          <>
            <button
              className="extra-title"
              onClick={() => setOpen((o) => !o)}
              onDoubleClick={() => setEditing(true)}
              aria-expanded={open}
              title="Clic : voir les tâches · double-clic : modifier"
            >
              <span className="extra-name">{extra.title}</span>
              <span className="extra-sub muted small">
                {own.length ? `${done}/${own.length} tâche${own.length > 1 ? "s" : ""}` : "Sans sous-tâche"}
                <ChevronDown size={12} className={open ? "extra-chevron open" : "extra-chevron"} />
              </span>
            </button>
            <span className="extra-side">
              <span className="extra-price">{formatMoney(extra.price, project.currency)}</span>
              <span className="extra-actions">
                <button className="icon-btn edit" onClick={() => setEditing(true)} aria-label="Modifier l'extra">
                  <Pencil size={13} />
                </button>
                <ConfirmDelete onConfirm={() => deleteExtra(extra.id)} ariaLabel="Supprimer l'extra" />
              </span>
            </span>
          </>
        )}
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="extra-tasks"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <TaskList
              tasks={own}
              projects={projects}
              projectId={project.id}
              extraId={extra.id}
              compact
              placeholder={`Tâche pour « ${extra.title} »…`}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** Extras d'un projet : features, modules ou avenants ajoutés, chacun avec son prix (et ses tâches). */
export function ExtrasPanel({ project, tasks, projects, extras }: { project: Project } & Pick<Data, "tasks" | "projects" | "extras">) {
  const own = extras.filter((x) => x.project_id === project.id);
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const total = own.reduce((s, x) => s + x.price, 0);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    await createExtra(project.id, t, parseAmount(price));
    setTitle("");
    setPrice("");
  };

  return (
    <div className="money-panel">
      <form
        className="todo-add extra-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus size={14} className="tile-icon" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nouvel extra (ex. : page blog)…" />
        <input
          className="amount-input"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="Prix"
          aria-label="Prix de l'extra"
        />
        <button type="submit" className="btn primary icon" disabled={!title.trim()}>
          Ajouter
        </button>
      </form>
      {own.length === 0 ? (
        <div className="money-empty muted small">
          Une feature ou un module en plus, demandé après coup ? Ajoute-le ici avec son prix : il s'ajoute au total du projet.
          Tu peux le découper en tâches.
        </div>
      ) : (
        <>
          <ul className="extras">
            {own.map((x) => (
              <ExtraRow key={x.id} extra={x} project={project} tasks={tasks} projects={projects} />
            ))}
          </ul>
          <div className="money-sum muted small">
            {own.length} extra{own.length > 1 ? "s" : ""} · <b>{formatMoney(total, project.currency)}</b>
          </div>
        </>
      )}
    </div>
  );
}

/** Paiements reçus pour un projet (acomptes, solde…). */
export function PaymentsPanel({ project, ledger }: { project: Project; ledger: Ledger }) {
  const own = ledger.payments.filter((x) => x.project_id === project.id).sort((a, b) => b.paid_on.localeCompare(a.paid_on));
  const m = projectMoney(project, ledger);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<Date>(new Date());
  const [note, setNote] = useState("");

  const add = async () => {
    const value = parseAmount(amount) || m.remaining;
    if (value <= 0) return;
    await recordPayment(project, value, toIsoDay(date), ledger, note.trim());
    setAmount("");
    setNote("");
    setDate(new Date());
  };

  return (
    <div className="money-panel">
      <PaidBar project={project} ledger={ledger} />
      <form
        className="payment-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="amount-input"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder={m.remaining > 0 ? `${m.remaining}` : "Montant"}
          aria-label="Montant reçu"
        />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Acompte, solde…" aria-label="Note" />
        <DatePicker value={date} onChange={(d) => d && setDate(d)} ariaLabel="Date du paiement" />
        <button type="submit" className="btn primary icon" disabled={!(parseAmount(amount) || m.remaining)}>
          Encaisser
        </button>
      </form>
      {own.length === 0 ? (
        <div className="money-empty muted small">
          Aucun paiement pour l'instant. Note ici chaque acompte ou paiement reçu : Mégatron calcule ce qu'il reste à payer.
        </div>
      ) : (
        <ul className="payments">
          {own.map((x) => (
            <li key={x.id} className="payment">
              <span className="payment-date">{formatDay(x.paid_on)}</span>
              <span className="payment-note">{x.note || "Paiement"}</span>
              <b className="payment-amount">{formatMoney(x.amount, project.currency)}</b>
              <ConfirmDelete onConfirm={() => deletePayment(x.id)} ariaLabel="Supprimer le paiement" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

