import { useState } from "react";
import { ConfirmDelete } from "../components/ConfirmDelete";
import { AnimatePresence, motion } from "motion/react";
import { entryMs, startOfDay, formatDuration, isRunning } from "../time";
import { TimerButtons } from "./Time";
import {
  createProject,
  startTimer,
  deleteProject,
  PROJECT_COLORS,
  setSetting,
  updateProject,
  type Project,
  type ProjectInput,
  type ProjectStatus,
} from "../db";
import type { Data } from "../useData";
import { TaskList } from "./TaskList";
import { Select } from "../components/Select";
import { ClientInput } from "../components/ClientInput";
import { Briefcase, CalendarClock, ChevronLeft, ChevronRight, GraduationCap, Pencil, Play, Plus, Sparkles, Trash2, Users } from "lucide-react";
import { DatePicker } from "../components/DatePicker";
import { ExtrasPanel, PaidBar, PaymentsPanel } from "./ProjectMoney";
import {
  awaitingPayment,
  changeStatus,
  clientNames,
  clientSummaries,
  convertAmounts,
  displayStatus,
  formatAmounts,
  formatDay,
  formatMoney,
  fromIsoDay,
  isOpen,
  mixesEuroAndCfa,
  moneyTotals,
  type MoneyView,
  projectMoney,
  statusesFor,
  statusLabel,
  toIsoDay,
  usageProfile,
  USAGES,
  type ClientSummary,
  type Ledger,
  type Usage,
  type UsageProfile,
} from "../projects";

/** Devises proposées (codes ISO : le franc CFA existe en deux zones, Afrique de l'Ouest et Afrique centrale). */
const CURRENCIES = [
  { value: "EUR", label: "EUR" },
  { value: "XOF", label: "FCFA", hint: "Ouest" },
  { value: "XAF", label: "FCFA", hint: "Centre" },
  { value: "USD", label: "USD" },
  { value: "GBP", label: "GBP" },
  { value: "CHF", label: "CHF" },
  { value: "CAD", label: "CAD" },
];

const formatPrice = (p: Pick<Project, "price" | "currency">) => formatMoney(p.price, p.currency);

/** Options de statut : celles du type d'usage, plus le statut actuel s'il n'en fait pas partie. */
function statusOptions(profile: UsageProfile, current?: ProjectStatus) {
  const options = statusesFor(profile);
  if (current && !options.some((o) => o.value === current)) {
    const shown = displayStatus(profile, current);
    if (!options.some((o) => o.value === shown)) {
      options.push({ value: current, label: statusLabel(profile, current), color: "#8e8e93" });
    }
  }
  return options;
}

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
  const profile = usageProfile(data.settings);
  const project =
    (mode.kind === "detail" || mode.kind === "edit") && mode.id != null ? data.projects.find((p) => p.id === mode.id) : undefined;
  const goBack = (back: Back) => setMode(back.kind === "client" ? { kind: "client", name: back.name } : { kind: "list" });

  return (
    <AnimatePresence mode="wait" initial={false}>
      {mode.kind === "list" && (
        <motion.div key="list" className="view" {...slide}>
          <ProjectList
            {...data}
            profile={profile}
            onOpen={(id) => setMode({ kind: "detail", id, back: { kind: "list" } })}
            onNew={() => setMode({ kind: "edit", id: null, back: { kind: "list" } })}
            onClients={() => setMode({ kind: "clients" })}
          />
        </motion.div>
      )}
      {mode.kind === "clients" && (
        <motion.div key="clients" className="view" {...slide}>
          <ClientList
            {...data}
            profile={profile}
            onBack={() => setMode({ kind: "list" })}
            onOpen={(name) => setMode({ kind: "client", name })}
          />
        </motion.div>
      )}
      {mode.kind === "client" && (
        <motion.div key={`client-${mode.name}`} className="view" {...slide}>
          <ClientDetail
            {...data}
            profile={profile}
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
            profile={profile}
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
            profile={profile}
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

function ProjectCard({
  p,
  tasks,
  profile,
  ledger,
  onOpen,
}: {
  p: Project;
  tasks: Data["tasks"];
  profile: UsageProfile;
  ledger: Ledger;
  onOpen: () => void;
}) {
  const pr = progress(tasks, p.id);
  const money = projectMoney(p, ledger);
  const shown = displayStatus(profile, p.status);
  const client = profile.clientLabel ? p.client : "";
  return (
    <motion.button layout className="project-card" onClick={onOpen}>
      <div className="card-top">
        <span className="chip-dot" style={{ background: p.color }} />
        <span className="card-name">{p.name}</span>
        <span className={`badge ${shown}`}>{statusLabel(profile, p.status)}</span>
      </div>
      {(client || profile.money) && (
        <div className="card-meta">
          <span>{client || (profile.money ? "Sans client" : "")}</span>
          {profile.money && <span className="card-price">{formatMoney(money.total, p.currency)}</span>}
        </div>
      )}
      <ProgressBar ratio={pr.ratio} color={p.color} />
      <div className="card-foot muted small">
        {pr.total ? `${pr.done}/${pr.total} tâches` : "Aucune tâche"}
        {p.deadline && isOpen(p) && (
          <span className="with-icon">
            <CalendarClock size={12} /> {formatDay(p.deadline)}
          </span>
        )}
        {profile.money && money.paid > 0 && money.remaining > 0 && (
          <span className="unpaid">Reste {formatMoney(money.remaining, p.currency)}</span>
        )}
        {profile.money && p.status === "paid" && money.remaining === 0 && p.paid_at && (
          <span>Payé le {formatDay(p.paid_at.slice(0, 10))}</span>
        )}
      </div>
    </motion.button>
  );
}

/** Premier projet : on demande pour quoi Mégatron sert, pour n'afficher que l'utile. */
function UsageChooser() {
  const icons: Record<Usage, typeof Briefcase> = { freelance: Briefcase, studies: GraduationCap, personal: Sparkles };
  return (
    <div className="tile usage-chooser">
      <span className="tile-title">Tes projets, c'est plutôt…</span>
      <div className="usage-options">
        {(Object.keys(USAGES) as Usage[]).map((u) => {
          const Icon = icons[u];
          return (
            <button key={u} className="usage-option" onClick={() => setSetting("usage", u)}>
              <Icon size={18} />
              <b>{USAGES[u].label}</b>
              <span className="muted small">{USAGES[u].hint}</span>
            </button>
          );
        })}
      </div>
      <span className="muted small">Tu pourras changer dans Réglages → Général.</span>
    </div>
  );
}

type Filter = "all" | ProjectStatus;

function ProjectList({
  projects,
  tasks,
  settings,
  extras,
  payments,
  profile,
  onOpen,
  onNew,
  onClients,
}: Data & { profile: UsageProfile; onOpen: (id: number) => void; onNew: () => void; onClients: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [moneyView, setMoneyView] = useMoneyView();
  const ledger = { extras, payments };
  const open = projects.filter(isOpen);
  const unpaid = awaitingPayment(projects, ledger);
  const totals = moneyTotals(projects, ledger);
  // En cours : reste à gagner sur ce qui n'est pas livré (acomptes déduits).
  // À encaisser : tout ce qui reste dû, dont la part exigible (travail déjà livré).
  const canConvert = profile.money && mixesEuroAndCfa(totals.ongoing, totals.owed);
  const view = canConvert ? moneyView : null;
  const openAmount = formatAmounts(convertAmounts(totals.ongoing, view));
  const owedAmount = formatAmounts(convertAmounts(totals.owed, view));
  const dueNowAmount = formatAmounts(convertAmounts(totals.pending, view));
  const now = new Date();
  const nextDeadline = open
    .filter((p) => p.deadline && fromIsoDay(p.deadline) >= startOfDay(now))
    .sort((a, b) => a.deadline!.localeCompare(b.deadline!))[0];
  const visible = filter === "all" ? projects : projects.filter((p) => displayStatus(profile, p.status) === filter);
  const clientCount = profile.clientsLabel ? clientSummaries(projects).length : 0;
  const openIds = new Set(open.map((p) => p.id));
  const tasksLeft = tasks.filter((t) => !t.done && t.project_id != null && openIds.has(t.project_id)).length;
  const statuses = statusesFor(profile);
  const askUsage = !settings.usage && projects.length === 0;

  return (
    <>
      <div className="stat-strip">
        <div className="tile strip-tile">
          <span className="tile-caption">En cours</span>
          <span className="strip-value" title={profile.money ? openAmount : undefined}>
            {profile.money ? openAmount : `${open.length} projet${open.length > 1 ? "s" : ""}`}
          </span>
          <span className="strip-foot">
            <span className="tile-caption">
              {profile.money
                ? `${open.length} projet${open.length > 1 ? "s" : ""} à livrer`
                : profile.doneLabel === "Rendu"
                  ? "à rendre"
                  : "à terminer"}
            </span>
            {canConvert && <MoneySwitch value={moneyView} onChange={setMoneyView} />}
          </span>
        </div>
        {profile.money ? (
          <div className="tile strip-tile">
            <span className="tile-caption">À encaisser</span>
            <span className={unpaid.length ? "strip-value unpaid" : "strip-value"} title={owedAmount}>
              {owedAmount}
            </span>
            <span className="strip-foot">
              <span className="tile-caption" title={unpaid.length ? `${unpaid.length} projet(s) livré(s) en attente de paiement` : undefined}>
                {unpaid.length
                  ? `dont ${dueNowAmount} sur du livré`
                  : Object.keys(totals.owed).length
                    ? "rien d'exigible pour l'instant"
                    : "Rien en attente"}
              </span>
              {canConvert && <MoneySwitch value={moneyView} onChange={setMoneyView} />}
            </span>
          </div>
        ) : (
          <div className="tile strip-tile">
            <span className="tile-caption">Tâches restantes</span>
            <span className="strip-value">{tasksLeft}</span>
            <span className="tile-caption">dans tes projets en cours</span>
          </div>
        )}
        <div className="tile strip-tile">
          <span className="tile-caption">{profile.nextDeadlineLabel}</span>
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
          {statuses.map((s) => {
            const n = projects.filter((p) => displayStatus(profile, p.status) === s.value).length;
            if (!n) return null;
            return (
              <button key={s.value} className={filter === s.value ? "chip active" : "chip"} onClick={() => setFilter(s.value)}>
                <span className="chip-dot" style={{ background: s.color }} />
                {s.label} · {n}
              </button>
            );
          })}
        </div>
        {/* Pas de client / matière renseigné : pas d'espace dédié. */}
        {clientCount > 0 && (
          <button className="btn ghost clients-btn" onClick={onClients}>
            <Users size={13} /> {profile.clientsLabel} · {clientCount}
          </button>
        )}
      </div>
      {askUsage ? (
        <UsageChooser />
      ) : (
        <div className="project-grid">
          {visible.map((p) => (
            <ProjectCard key={p.id} p={p} tasks={tasks} profile={profile} ledger={ledger} onOpen={() => onOpen(p.id)} />
          ))}
          {visible.length === 0 && (
            <div className="empty">{projects.length ? "Aucun projet avec ce statut." : "Aucun projet pour l'instant."}</div>
          )}
        </div>
      )}
    </>
  );
}

function ClientAvatar({ name }: { name: string }) {
  return <span className="client-avatar">{name.trim()[0]?.toUpperCase()}</span>;
}

/** Temps passé sur tous les projets d'un client (ou d'une matière). */
function clientTime(c: ClientSummary, entries: Data["entries"], now: Date) {
  const ids = new Set(c.projects.map((p) => p.id));
  return entries.filter((e) => e.project_id != null && ids.has(e.project_id)).reduce((s, e) => s + entryMs(e, now), 0);
}

function ClientList({
  projects,
  entries,
  extras,
  payments,
  profile,
  onBack,
  onOpen,
}: Data & { profile: UsageProfile; onBack: () => void; onOpen: (name: string) => void }) {
  const ledger = { extras, payments };
  const clients = clientSummaries(projects, ledger);
  const { paid, pending } = moneyTotals(
    projects.filter((p) => p.client.trim()),
    ledger,
  );
  const now = new Date();
  const totalTime = clients.reduce((s, c) => s + clientTime(c, entries, now), 0);

  return (
    <>
      <div className="view-head">
        <button className="btn ghost" onClick={onBack}>
          <ChevronLeft size={14} /> Projets
        </button>
        <div className="client-totals">
          {profile.money ? (
            <>
              <span>
                <span className="tile-caption">Encaissé</span> <b>{formatAmounts(paid)}</b>
              </span>
              <span>
                <span className="tile-caption">À encaisser</span>{" "}
                <b className={Object.keys(pending).length ? "unpaid" : ""}>{formatAmounts(pending)}</b>
              </span>
            </>
          ) : (
            <span>
              <span className="tile-caption">Temps total</span> <b>{formatDuration(totalTime)}</b>
            </span>
          )}
        </div>
      </div>
      <div className="client-list">
        {clients.map((c) => {
          const open = c.projects.filter(isOpen).length;
          return (
            <button key={c.name} className="client-row" onClick={() => onOpen(c.name)}>
              <ClientAvatar name={c.name} />
              <span className="client-main">
                <span className="client-name">{c.name}</span>
                <span className="muted small">
                  {c.projects.length} projet{c.projects.length > 1 ? "s" : ""} · {formatDuration(clientTime(c, entries, now))}
                </span>
              </span>
              {profile.money ? (
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
              ) : (
                <span className="client-money">
                  <b>{open}</b>
                  <span className="small muted">en cours</span>
                </span>
              )}
              <ChevronRight size={14} className="muted" />
            </button>
          );
        })}
        {clients.length === 0 && <div className="empty">Rien ici pour l'instant.</div>}
      </div>
    </>
  );
}

function ClientDetail({
  name,
  projects,
  tasks,
  entries,
  extras,
  payments,
  profile,
  onBack,
  onOpen,
  onNew,
}: Data & { name: string; profile: UsageProfile; onBack: () => void; onOpen: (id: number) => void; onNew: () => void }) {
  const ledger = { extras, payments };
  const c = clientSummaries(projects, ledger).find((x) => x.name.toLocaleLowerCase("fr") === name.toLocaleLowerCase("fr"));
  const back = (
    <button className="btn ghost" onClick={onBack}>
      <ChevronLeft size={14} /> {profile.clientsLabel}
    </button>
  );
  if (!c) return <div className="view-head">{back}</div>;
  const now = new Date();
  const first = c.projects.reduce((min, p) => (p.created_at < min ? p.created_at : min), c.projects[0].created_at);
  const since = new Date(first.replace(" ", "T") + "Z").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const open = c.projects.filter(isOpen);
  const ids = new Set(c.projects.map((p) => p.id));
  const tasksLeft = tasks.filter((t) => !t.done && t.project_id != null && ids.has(t.project_id)).length;

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
            {profile.money ? `Client depuis ${since}` : `Depuis ${since}`} · {formatDuration(clientTime(c, entries, now))} de travail
          </span>
        </div>
        <div className="client-figures">
          {profile.money ? (
            <>
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
            </>
          ) : (
            <>
              <div>
                <span className="tile-caption">Projets en cours</span>
                <b>{open.length}</b>
              </div>
              <div>
                <span className="tile-caption">Tâches restantes</span>
                <b>{tasksLeft}</b>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="project-grid">
        {c.projects.map((p) => (
          <ProjectCard key={p.id} p={p} tasks={tasks} profile={profile} ledger={ledger} onOpen={() => onOpen(p.id)} />
        ))}
      </div>
    </>
  );
}

type DetailTab = "tasks" | "extras" | "payments";

function ProjectDetail({
  project: p,
  projects,
  tasks,
  entries,
  timers,
  extras,
  payments,
  profile,
  backLabel,
  onBack,
  onEdit,
}: Data & { project: Project; profile: UsageProfile; backLabel: string; onBack: () => void; onEdit: () => void }) {
  const [tab, setTab] = useState<DetailTab>("tasks");
  const ledger = { extras, payments };
  const money = projectMoney(p, ledger);
  const extraCount = extras.filter((x) => x.project_id === p.id).length;
  const paymentCount = payments.filter((x) => x.project_id === p.id).length;
  const own = tasks.filter((t) => t.project_id === p.id);
  const baseTasks = own.filter((t) => t.extra_id == null);
  const pr = progress(tasks, p.id);
  const now = new Date();
  const spent = entries.filter((e) => e.project_id === p.id).reduce((s, e) => s + entryMs(e, now), 0);
  const timer = timers.find((t) => t.project_id === p.id);
  const running = isRunning(entries, p.id);
  const options = statusOptions(profile, p.status);
  const shown = options.some((o) => o.value === p.status) ? p.status : displayStatus(profile, p.status);

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
          <ConfirmDelete variant="button" onConfirm={() => deleteProject(p.id).then(onBack)} ariaLabel={`Supprimer le projet ${p.name}`} />
        </div>
      </div>
      <div className="detail-grid">
        <div className="tile detail-info">
          <div className="detail-title">
            <span className="chip-dot" style={{ background: p.color }} />
            {p.name}
          </div>
          <Select<ProjectStatus>
            value={shown}
            onChange={(v) => changeStatus(p, v, ledger)}
            options={options}
            ariaLabel="Statut du projet"
            className="status-select"
          />
          <dl className="facts">
            {profile.clientLabel && (
              <>
                <dt>{profile.clientLabel}</dt>
                <dd>{p.client || "—"}</dd>
              </>
            )}
            {profile.money && (
              <>
                <dt>Prix</dt>
                <dd>{formatPrice(p)}</dd>
                {money.extras > 0 && (
                  <>
                    <dt>Extras</dt>
                    <dd>+ {formatMoney(money.extras, p.currency)}</dd>
                    <dt>Total</dt>
                    <dd>{formatMoney(money.total, p.currency)}</dd>
                  </>
                )}
              </>
            )}
            <dt>Début</dt>
            <dd>{p.start_date ? formatDay(p.start_date) : "—"}</dd>
            <dt>{profile.deadlineLabel}</dt>
            <dd>{p.deadline ? formatDay(p.deadline) : "—"}</dd>
            {profile.money && p.paid_at && (
              <>
                <dt>Payé le</dt>
                <dd>{formatDay(p.paid_at.slice(0, 10))}</dd>
              </>
            )}
            <dt>Temps</dt>
            <dd>{formatDuration(spent)}</dd>
          </dl>
          {profile.money && <PaidBar project={p} ledger={ledger} />}
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
          {profile.money && (
            <div className="segmented detail-tabs">
              {(
                [
                  ["tasks", `Tâches · ${baseTasks.filter((t) => !t.done).length}`],
                  ["extras", `Extras${extraCount ? ` · ${extraCount}` : ""}`],
                  ["payments", `Paiements${paymentCount ? ` · ${paymentCount}` : ""}`],
                ] as [DetailTab, string][]
              ).map(([id, label]) => (
                <button key={id} className={tab === id ? "seg active" : "seg"} onClick={() => setTab(id)}>
                  {tab === id && <motion.span layoutId={`detail-tab-${p.id}`} className="seg-pill" />}
                  <span className="tab-label">{label}</span>
                </button>
              ))}
            </div>
          )}
          {(!profile.money || tab === "tasks") && (
            <TaskList tasks={profile.money ? baseTasks : own} projects={projects} projectId={p.id} placeholder={`Tâche pour ${p.name}…`} />
          )}
          {profile.money && tab === "extras" && <ExtrasPanel project={p} tasks={tasks} projects={projects} extras={extras} />}
          {profile.money && tab === "payments" && <PaymentsPanel project={p} ledger={ledger} />}
        </div>
      </div>
    </>
  );
}

function ProjectForm({
  project,
  profile,
  clients,
  initialClient,
  backLabel,
  onCancel,
  onSaved,
}: {
  project?: Project;
  profile: UsageProfile;
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
  const options = statusOptions(profile, project?.status);

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
  const shownStatus = options.some((o) => o.value === form.status) ? form.status : displayStatus(profile, form.status);

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
            <input
              autoFocus
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder={profile.money ? "Site vitrine…" : profile.doneLabel === "Rendu" ? "Exposé, mémoire, TP…" : "Apprendre la guitare…"}
            />
          </label>
          {profile.clientLabel && (
            <div className="field">
              <span className="field-label">
                {profile.clientLabel} <span className="muted">(facultatif)</span>
              </span>
              <ClientInput value={form.client} onChange={(v) => set("client", v)} clients={clients} placeholder={profile.clientPlaceholder} />
            </div>
          )}
          <div className="field-row">
            {profile.money && (
              <>
                <label className="field grow">
                  <span className="field-label">
                    Prix <span className="muted">(facultatif)</span>
                  </span>
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
                    options={CURRENCIES}
                    ariaLabel="Devise"
                  />
                </div>
              </>
            )}
            <div className="field grow">
              <span className="field-label">Statut</span>
              <Select<ProjectStatus> value={shownStatus} onChange={(v) => set("status", v)} options={options} ariaLabel="Statut" />
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
              <span className="field-label">{profile.deadlineLabel}</span>
              <DatePicker
                clearable
                placeholder={profile.noDeadline}
                value={form.deadline ? fromIsoDay(form.deadline) : null}
                onChange={(d) => set("deadline", d ? toIsoDay(d) : null)}
                ariaLabel={profile.deadlineLabel}
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
                <span className={`badge ${displayStatus(profile, form.status)}`}>{statusLabel(profile, form.status)}</span>
              </div>
              {(profile.money || (profile.clientLabel && form.client.trim())) && (
                <div className="card-meta">
                  <span>{form.client.trim() || (profile.money ? "Sans client" : "")}</span>
                  {profile.money && <span className="card-price">{formatPrice(preview)}</span>}
                </div>
              )}
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
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder={profile.money ? "Brief, liens, infos utiles…" : "Consignes, liens, idées…"}
            />
          </label>
        </div>
      </div>
    </form>
  );
}

const MONEY_VIEW_KEY = "megatron:money-view";

/** Devise d'affichage des totaux (€ ou FCFA, ou par devise), retenue d'une ouverture à l'autre. */
function useMoneyView() {
  const [view, setView] = useState<MoneyView>(() => {
    try {
      const v = localStorage.getItem(MONEY_VIEW_KEY);
      return v === "EUR" || v === "XOF" ? v : null;
    } catch {
      return null;
    }
  });
  const change = (v: MoneyView) => {
    setView(v);
    try {
      if (v) localStorage.setItem(MONEY_VIEW_KEY, v);
      else localStorage.removeItem(MONEY_VIEW_KEY);
    } catch {
      /* stockage indisponible : le choix vaut pour cette ouverture */
    }
  };
  return [view, change] as const;
}

/** Bascule € / FCFA : un second clic sur l'option choisie revient aux montants par devise. */
function MoneySwitch({ value, onChange }: { value: MoneyView; onChange: (v: MoneyView) => void }) {
  const options: { value: Exclude<MoneyView, null>; label: string; hint: string }[] = [
    { value: "EUR", label: "€", hint: "Tout convertir en euros" },
    { value: "XOF", label: "FCFA", hint: "Tout convertir en francs CFA" },
  ];
  return (
    <span className="money-switch" role="group" aria-label="Devise d'affichage">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? "active" : ""}
          aria-pressed={value === o.value}
          title={value === o.value ? "Revenir aux montants par devise" : `${o.hint} (1 € = 655,957 FCFA)`}
          onClick={() => onChange(value === o.value ? null : o.value)}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}
