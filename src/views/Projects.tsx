import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { entryMs, startOfDay, formatDuration, hourlyRate, isRunning } from "../time";
import { TimerButtons } from "./Time";
import {
  createProject,
  startTimer,
  deleteProject,
  PROJECT_COLORS,
  setProjectStatus,
  updateProject,
  type Project,
  type ProjectInput,
  type ProjectStatus,
} from "../db";
import type { Data } from "../useData";
import { TaskList } from "./TaskList";
import { Select } from "../components/Select";
import { ClientInput } from "../components/ClientInput";
import { CalendarClock, ChevronLeft, ChevronRight, Pencil, Play, Plus, Trash2, Users } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import {
  clientNames,
  clientSummaries,
  formatAmounts,
  formatDay,
  formatMoney,
  fromIsoDay,
  isOpen,
  STATUS_LABEL,
  STATUSES,
  toIsoDay,
  type ClientSummary,
} from "../projects";

const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD"];

const formatPrice = (p: Pick<Project, "price" | "currency">) => formatMoney(p.price, p.currency);
const statusOptions = STATUSES.map((s) => ({ value: s.value, label: s.label, color: s.color }));

/** Somme par devise d'une liste de projets. */
const sumBy = (projects: Project[]) => {
  const m: Record<string, number> = {};
  for (const p of projects) m[p.currency] = (m[p.currency] ?? 0) + p.price;
  return m;
};

type Back = { kind: "list" } | { kind: "client"; name: string };
type Mode =
  | { kind: "list" }
  | { kind: "clients" }
  | { kind: "client"; name: string }
  | { kind: "detail"; id: number; back: Back }
  | { kind: "edit"; id: number | null; back: Back; client?: string };

const slide = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -16 },
  transition: { duration: 0.16 },
};

export function Projects(data: Data) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const project =
    (mode.kind === "detail" || mode.kind === "edit") && mode.id != null ? data.projects.find((p) => p.id === mode.id) : undefined;
  const goBack = (back: Back) => setMode(back.kind === "client" ? { kind: "client", name: back.name } : { kind: "list" });

  return (
    <AnimatePresence mode="wait" initial={false}>
      {mode.kind === "list" && (
        <motion.div key="list" className="view" {...slide}>
          <ProjectList
            {...data}
            onOpen={(id) => setMode({ kind: "detail", id, back: { kind: "list" } })}
            onNew={() => setMode({ kind: "edit", id: null, back: { kind: "list" } })}
            onClients={() => setMode({ kind: "clients" })}
          />
        </motion.div>
      )}
      {mode.kind === "clients" && (
        <motion.div key="clients" className="view" {...slide}>
          <ClientList {...data} onBack={() => setMode({ kind: "list" })} onOpen={(name) => setMode({ kind: "client", name })} />
        </motion.div>
      )}
      {mode.kind === "client" && (
        <motion.div key={`client-${mode.name}`} className="view" {...slide}>
          <ClientDetail
            {...data}
            name={mode.name}
            onBack={() => setMode({ kind: "clients" })}
            onOpen={(id) => setMode({ kind: "detail", id, back: { kind: "client", name: mode.name } })}
            onNew={() => setMode({ kind: "edit", id: null, back: { kind: "client", name: mode.name }, client: mode.name })}
          />
        </motion.div>
      )}
      {mode.kind === "detail" && project && (
        <motion.div key={`detail-${project.id}`} className="view" {...slide}>
          <ProjectDetail
            project={project}
            {...data}
            backLabel={mode.back.kind === "client" ? mode.back.name : "Projets"}
            onBack={() => goBack(mode.back)}
            onEdit={() => setMode({ kind: "edit", id: project.id, back: mode.back })}
          />
        </motion.div>
      )}
      {mode.kind === "edit" && (
        <motion.div key={`edit-${mode.id ?? "new"}`} className="view" {...slide}>
          <ProjectForm
            project={project}
            clients={clientNames(data.projects)}
            initialClient={mode.client}
            backLabel={project ? project.name : mode.back.kind === "client" ? mode.back.name : "Projets"}
            onCancel={() => (project ? setMode({ kind: "detail", id: project.id, back: mode.back }) : goBack(mode.back))}
            onSaved={(id) => setMode({ kind: "detail", id, back: mode.back })}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function progress(tasks: Data["tasks"], projectId: number) {
  const own = tasks.filter((t) => t.project_id === projectId);
  const done = own.filter((t) => t.done).length;
  return { done, total: own.length, ratio: own.length ? done / own.length : 0 };
}

function ProgressBar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="progress">
      <motion.div
        className="progress-fill"
        style={{ background: color }}
        initial={false}
        animate={{ width: `${ratio * 100}%` }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      />
    </div>
  );
}

function ProjectCard({ p, tasks, onOpen }: { p: Project; tasks: Data["tasks"]; onOpen: () => void }) {
  const pr = progress(tasks, p.id);
  return (
    <motion.button layout className="project-card" onClick={onOpen}>
      <div className="card-top">
        <span className="chip-dot" style={{ background: p.color }} />
        <span className="card-name">{p.name}</span>
        <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
      </div>
      <div className="card-meta">
        <span>{p.client || "Sans client"}</span>
        <span className="card-price">{formatPrice(p)}</span>
      </div>
      <ProgressBar ratio={pr.ratio} color={p.color} />
      <div className="card-foot muted small">
        {pr.total ? `${pr.done}/${pr.total} tâches` : "Aucune tâche"}
        {p.deadline && isOpen(p) && (
          <span className="with-icon">
            <CalendarClock size={12} /> {formatDay(p.deadline)}
          </span>
        )}
        {p.status === "paid" && p.paid_at && <span>Payé le {formatDay(p.paid_at.slice(0, 10))}</span>}
      </div>
    </motion.button>
  );
}

type Filter = "all" | ProjectStatus;

function ProjectList({
  projects,
  tasks,
  onOpen,
  onNew,
  onClients,
}: Data & { onOpen: (id: number) => void; onNew: () => void; onClients: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const open = projects.filter(isOpen);
  const unpaid = projects.filter((p) => p.status === "unpaid");
  const now = new Date();
  const nextDeadline = open
    .filter((p) => p.deadline && fromIsoDay(p.deadline) >= startOfDay(now))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0];
  const visible = filter === "all" ? projects : projects.filter((p) => p.status === filter);
  const clientCount = clientSummaries(projects).length;

  return (
    <>
      <div className="stat-strip">
        <div className="tile strip-tile">
          <span className="tile-caption">En cours</span>
          <span className="strip-value">{formatAmounts(sumBy(open))}</span>
          <span className="tile-caption">
            {open.length} projet{open.length > 1 ? "s" : ""} à livrer
          </span>
        </div>
        <button className="tile strip-tile strip-button" onClick={() => setFilter(filter === "unpaid" ? "all" : "unpaid")}>
          <span className="tile-caption">À encaisser</span>
          <span className={unpaid.length ? "strip-value unpaid" : "strip-value"}>{formatAmounts(sumBy(unpaid))}</span>
          <span className="tile-caption">{unpaid.length ? `${unpaid.length} en attente de paiement` : "Rien en attente"}</span>
        </button>
        <div className="tile strip-tile">
          <span className="tile-caption">Prochaine deadline</span>
          <span className="strip-value">{nextDeadline ? formatDay(nextDeadline.deadline!) : "—"}</span>
          <span className="tile-caption strip-name">{nextDeadline?.name ?? "Aucune"}</span>
        </div>
        <button className="tile strip-tile strip-new" onClick={onNew}>
          <Plus size={20} strokeWidth={2.2} />
          <span>Nouveau projet</span>
        </button>
      </div>
      <div className="list-toolbar">
        <div className="chips">
          <button className={filter === "all" ? "chip active" : "chip"} onClick={() => setFilter("all")}>
            Tous · {projects.length}
          </button>
          {STATUSES.map((s) => {
            const n = projects.filter((p) => p.status === s.value).length;
            if (!n) return null;
            return (
              <button key={s.value} className={filter === s.value ? "chip active" : "chip"} onClick={() => setFilter(s.value)}>
                <span className="chip-dot" style={{ background: s.color }} />
                {s.label} · {n}
              </button>
            );
          })}
        </div>
        {/* Pas de client renseigné (projets perso, cours…) : pas d'espace clients. */}
        {clientCount > 0 && (
          <button className="btn ghost clients-btn" onClick={onClients}>
            <Users size={13} /> Clients · {clientCount}
          </button>
        )}
      </div>
      <div className="project-grid">
        {visible.map((p) => (
          <ProjectCard key={p.id} p={p} tasks={tasks} onOpen={() => onOpen(p.id)} />
        ))}
        {visible.length === 0 && (
          <div className="empty">{projects.length ? "Aucun projet avec ce statut." : "Aucun projet pour l'instant."}</div>
        )}
      </div>
    </>
  );
}

function ClientAvatar({ name }: { name: string }) {
  return <span className="client-avatar">{name.trim()[0]?.toUpperCase()}</span>;
}

/** Temps passé sur tous les projets d'un client. */
function clientTime(c: ClientSummary, entries: Data["entries"], now: Date) {
  const ids = new Set(c.projects.map((p) => p.id));
  return entries.filter((e) => e.project_id != null && ids.has(e.project_id)).reduce((s, e) => s + entryMs(e, now), 0);
}

function ClientList({ projects, entries, onBack, onOpen }: Data & { onBack: () => void; onOpen: (name: string) => void }) {
  const clients = clientSummaries(projects);
  const paid = sumBy(projects.filter((p) => p.status === "paid" && p.client.trim()));
  const pending = sumBy(projects.filter((p) => p.status === "unpaid" && p.client.trim()));
  const now = new Date();

  return (
    <>
      <div className="view-head">
        <button className="btn ghost" onClick={onBack}>
          <ChevronLeft size={14} /> Projets
        </button>
        <div className="client-totals">
          <span>
            <span className="tile-caption">Encaissé</span> <b>{formatAmounts(paid)}</b>
          </span>
          <span>
            <span className="tile-caption">À encaisser</span>{" "}
            <b className={Object.keys(pending).length ? "unpaid" : ""}>{formatAmounts(pending)}</b>
          </span>
        </div>
      </div>
      <div className="client-list">
        {clients.map((c) => (
          <button key={c.name} className="client-row" onClick={() => onOpen(c.name)}>
            <ClientAvatar name={c.name} />
            <span className="client-main">
              <span className="client-name">{c.name}</span>
              <span className="muted small">
                {c.projects.length} projet{c.projects.length > 1 ? "s" : ""} · {formatDuration(clientTime(c, entries, now))}
              </span>
            </span>
            <span className="client-money">
              <b>{formatAmounts(c.paid)}</b>
              <span className="small">
                {Object.keys(c.pending).length ? (
                  <span className="unpaid">{formatAmounts(c.pending)} à encaisser</span>
                ) : Object.keys(c.ongoing).length ? (
                  <span className="muted">{formatAmounts(c.ongoing)} en cours</span>
                ) : (
                  <span className="muted">encaissé</span>
                )}
              </span>
            </span>
            <ChevronRight size={14} className="muted" />
          </button>
        ))}
        {clients.length === 0 && (
          <div className="empty">Pas encore de client : ajoute un nom de client à tes projets et il apparaîtra ici.</div>
        )}
      </div>
    </>
  );
}

function ClientDetail({
  name,
  projects,
  tasks,
  entries,
  onBack,
  onOpen,
  onNew,
}: Data & { name: string; onBack: () => void; onOpen: (id: number) => void; onNew: () => void }) {
  const c = clientSummaries(projects).find((x) => x.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"));
  const back = (
    <button className="btn ghost" onClick={onBack}>
      <ChevronLeft size={14} /> Clients
    </button>
  );
  if (!c) return <div className="view-head">{back}</div>;
  const now = new Date();
  const first = c.projects.reduce((min, p) => (p.created_at < min ? p.created_at : min), c.projects[0].created_at);
  const since = new Date(first.replace(" ", "T") + "Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  return (
    <>
      <div className="view-head">
        {back}
        <button className="btn primary" onClick={onNew}>
          <Plus size={13} /> Nouveau projet pour {c.name}
        </button>
      </div>
      <div className="tile client-hero">
        <ClientAvatar name={c.name} />
        <div className="client-main">
          <span className="client-name big">{c.name}</span>
          <span className="muted small">
            Client depuis {since} · {formatDuration(clientTime(c, entries, now))} de travail
          </span>
        </div>
        <div className="client-figures">
          <div>
            <span className="tile-caption">Encaissé</span>
            <b>{formatAmounts(c.paid)}</b>
          </div>
          <div>
            <span className="tile-caption">À encaisser</span>
            <b className={Object.keys(c.pending).length ? "unpaid" : ""}>{formatAmounts(c.pending)}</b>
          </div>
          <div>
            <span className="tile-caption">En cours</span>
            <b>{formatAmounts(c.ongoing)}</b>
          </div>
        </div>
      </div>
      <div className="project-grid">
        {c.projects.map((p) => (
          <ProjectCard key={p.id} p={p} tasks={tasks} onOpen={() => onOpen(p.id)} />
        ))}
      </div>
    </>
  );
}

function ProjectDetail({
  project: p,
  projects,
  tasks,
  entries,
  timers,
  backLabel,
  onBack,
  onEdit,
}: Data & { project: Project; backLabel: string; onBack: () => void; onEdit: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const own = tasks.filter((t) => t.project_id === p.id);
  const pr = progress(tasks, p.id);
  const now = new Date();
  const spent = entries.filter((e) => e.project_id === p.id).reduce((s, e) => s + entryMs(e, now), 0);
  const rate = hourlyRate(p, entries, now);
  const timer = timers.find((t) => t.project_id === p.id);
  const running = isRunning(entries, p.id);

  return (
    <>
      <div className="view-head">
        <button className="btn ghost" onClick={onBack}>
          <ChevronLeft size={14} /> {backLabel}
        </button>
        <div className="row">
          <button className="btn ghost" onClick={onEdit}>
            <Pencil size={13} /> Modifier
          </button>
          {confirmDelete ? (
            <button className="btn danger" onClick={() => deleteProject(p.id).then(onBack)}>
              Confirmer la suppression
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={13} /> Supprimer
            </button>
          )}
        </div>
      </div>
      <div className="detail-grid">
        <div className="tile detail-info">
          <div className="detail-title">
            <span className="chip-dot" style={{ background: p.color }} />
            {p.name}
          </div>
          <Select<ProjectStatus>
            value={p.status}
            onChange={(v) => setProjectStatus(p.id, v)}
            options={statusOptions}
            ariaLabel="Statut du projet"
            className="status-select"
          />
          <dl className="facts">
            <dt>Client</dt>
            <dd>{p.client || "—"}</dd>
            <dt>Prix</dt>
            <dd>{formatPrice(p)}</dd>
            <dt>Début</dt>
            <dd>{p.start_date ? formatDay(p.start_date) : "—"}</dd>
            <dt>Deadline</dt>
            <dd>{p.deadline ? formatDay(p.deadline) : "—"}</dd>
            {p.paid_at && (
              <>
                <dt>Payé le</dt>
                <dd>{formatDay(p.paid_at.slice(0, 10))}</dd>
              </>
            )}
            <dt>Temps</dt>
            <dd>{formatDuration(spent)}</dd>
            <dt>Taux réel</dt>
            <dd>{rate ?? "—"}</dd>
          </dl>
          {timer ? (
            <div className="row">
              <span className={running ? "pulse" : "chip-dot"} style={{ background: p.color }} />
              <span className="small">{running ? "En cours" : "En pause"}</span>
              <TimerButtons timer={timer} running={running} />
            </div>
          ) : (
            isOpen(p) && (
              <button className="btn primary" onClick={() => startTimer(p.id)}>
                <Play size={13} fill="currentColor" /> Bosser dessus
              </button>
            )
          )}
          <ProgressBar ratio={pr.ratio} color={p.color} />
          <span className="muted small">
            {pr.done}/{pr.total} tâches faites
          </span>
          {p.notes && <p className="notes">{p.notes}</p>}
        </div>
        <div className="tile detail-tasks">
          <TaskList tasks={own} projects={projects} projectId={p.id} placeholder={`Tâche pour ${p.name}…`} />
        </div>
      </div>
    </>
  );
}

function ProjectForm({
  project,
  clients,
  initialClient,
  backLabel,
  onCancel,
  onSaved,
}: {
  project?: Project;
  clients: string[];
  initialClient?: string;
  backLabel: string;
  onCancel: () => void;
  onSaved: (id: number) => void;
}) {
  const [form, setForm] = useState<ProjectInput>(() => ({
    name: project?.name ?? "",
    client: project?.client ?? initialClient ?? "",
    price: project?.price ?? 0,
    currency: project?.currency ?? "EUR",
    status: project?.status ?? "active",
    start_date: project?.start_date ?? null,
    deadline: project?.deadline ?? null,
    notes: project?.notes ?? "",
    color: project?.color ?? PROJECT_COLORS[0],
  }));
  const set = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) return;
    // Même client écrit autrement (« atelier lune ») : on reprend l'orthographe existante.
    const typed = form.client.trim();
    const known = clients.find((c) => c.toLocaleLowerCase("fr") === typed.toLocaleLowerCase("fr"));
    const clean = { ...form, name: form.name.trim(), client: known ?? typed };
    if (project) {
      await updateProject(project.id, clean);
      onSaved(project.id);
    } else {
      onSaved(await createProject(clean));
    }
  };

  const preview = { price: form.price, currency: form.currency };

  return (
    <form
      className="project-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="form-head">
        <button type="button" className="btn ghost" onClick={onCancel}>
          <ChevronLeft size={14} /> {backLabel}
        </button>
        <span className="form-title">{project ? "Modifier le projet" : "Nouveau projet"}</span>
        <button type="submit" className="btn primary" disabled={!form.name.trim()}>
          {project ? "Enregistrer" : "Créer le projet"}
        </button>
      </div>

      <div className="form-columns">
        <div className="tile form-fields">
          <label className="field">
            <span className="field-label">Nom du projet</span>
            <input autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Site vitrine…" />
          </label>
          <div className="field">
            <span className="field-label">Client</span>
            <ClientInput value={form.client} onChange={(v) => set("client", v)} clients={clients} />
          </div>
          <div className="field-row">
            <label className="field grow">
              <span className="field-label">Prix</span>
              <input
                type="number"
                min={0}
                step="any"
                value={form.price || ""}
                onChange={(e) => set("price", Number(e.target.value) || 0)}
                placeholder="0"
              />
            </label>
            <div className="field currency">
              <span className="field-label">Devise</span>
              <Select
                value={form.currency}
                onChange={(v) => set("currency", v)}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                ariaLabel="Devise"
              />
            </div>
            <div className="field grow">
              <span className="field-label">Statut</span>
              <Select<ProjectStatus> value={form.status} onChange={(v) => set("status", v)} options={statusOptions} ariaLabel="Statut" />
            </div>
          </div>
          <div className="field-row">
            <div className="field grow">
              <span className="field-label">Début</span>
              <DatePicker
                clearable
                placeholder="Pas de date"
                value={form.start_date ? fromIsoDay(form.start_date) : null}
                onChange={(d) => set("start_date", d ? toIsoDay(d) : null)}
                ariaLabel="Date de début"
              />
            </div>
            <div className="field grow">
              <span className="field-label">Deadline</span>
              <DatePicker
                clearable
                placeholder="Pas de deadline"
                value={form.deadline ? fromIsoDay(form.deadline) : null}
                onChange={(d) => set("deadline", d ? toIsoDay(d) : null)}
                ariaLabel="Deadline"
              />
            </div>
          </div>
        </div>

        <div className="form-side">
          <div className="tile">
            <span className="field-label">Aperçu</span>
            <div className="project-card preview" style={{ borderColor: `${form.color}55` }}>
              <div className="card-top">
                <span className="chip-dot" style={{ background: form.color }} />
                <span className="card-name">{form.name.trim() || "Nom du projet"}</span>
                <span className={`badge ${form.status}`}>{STATUS_LABEL[form.status]}</span>
              </div>
              <div className="card-meta">
                <span>{form.client.trim() || "Sans client"}</span>
                <span className="card-price">{formatPrice(preview)}</span>
              </div>
            </div>
            <span className="field-label">Couleur</span>
            <div className="swatches">
              {PROJECT_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={c === form.color ? "swatch active" : "swatch"}
                  style={{ background: c }}
                  onClick={() => set("color", c)}
                  aria-label={`Couleur ${c}`}
                  aria-pressed={c === form.color}
                />
              ))}
            </div>
          </div>
          <label className="tile field notes-field">
            <span className="field-label">Notes</span>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Brief, liens, infos utiles…" />
          </label>
        </div>
      </div>
    </form>
  );
}
