import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { createExtra, deleteExtra, deletePayment, toggleExtra, type Extra, type Project } from "../db";
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

function ExtraRow({ extra, project, tasks, projects }: { extra: Extra; project: Project; tasks: Data["tasks"]; projects: Data["projects"] }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
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
        <button className="extra-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="extra-name">{extra.title}</span>
          <span className="muted small">{own.length ? `${done}/${own.length} tâches` : "Sans sous-tâche"}</span>
          <ChevronDown size={13} className={open ? "extra-chevron open" : "extra-chevron"} />
        </button>
        <span className="extra-price">{formatMoney(extra.price, project.currency)}</span>
        {confirm ? (
          <button className="btn danger icon" onClick={() => deleteExtra(extra.id)}>
            Supprimer ?
          </button>
        ) : (
          <button className="icon-btn" onClick={() => setConfirm(true)} aria-label="Supprimer l'extra">
            <X size={14} />
          </button>
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
              <button className="icon-btn" onClick={() => deletePayment(x.id)} aria-label="Supprimer le paiement">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

