import { isOpen } from "../projects";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { pauseTimer, resumeTimers, setSetting, startTimer, stopTimer, type Project, type Timer } from "../db";
import type { Data } from "../useData";
import { Select } from "../components/Select";
import { Pause, Play, Plus, Square } from "lucide-react";
import { projectOptions } from "../options";
import {
  formatClock,
  formatDuration,
  hours,
  isRunning,
  NO_PROJECT_COLOR,
  overlapMs,
  periodBuckets,
  timerElapsed,
  totalMs,
  type Period,
} from "../time";

const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
];
const BAR_COLOR = "var(--accent)";

export function Time(data: Data & { now: Date }) {
  const { projects, entries, now } = data;
  const [period, setPeriod] = useState<Period>("week");
  const { from, to, buckets } = periodBuckets(period, now);
  const total = totalMs(entries, from, to, now);

  const byProject = new Map<number | null, number>();
  for (const e of entries) {
    const ms = overlapMs(e, from, to, now);
    if (ms > 0) byProject.set(e.project_id, (byProject.get(e.project_id) ?? 0) + ms);
  }
  const rows = [...byProject.entries()].sort((a, b) => b[1] - a[1]);
  const rowsSum = rows.reduce((s, [, ms]) => s + ms, 0);
  const projectById = new Map(projects.map((p) => [p.id, p]));

  return (
    <div className="view time">
      <Timers {...data} />

      <div className="time-grid">
      <div className="tile chart-tile">
      <div className="view-head">
        <div className="segmented">
          {PERIODS.map((p) => (
            <button key={p.id} className={p.id === period ? "seg active" : "seg"} onClick={() => setPeriod(p.id)}>
              {p.id === period && <motion.span layoutId="seg-pill" className="seg-pill" />}
              <span className="tab-label">{p.label}</span>
            </button>
          ))}
        </div>
        <div className="period-total" title="Temps réel : les projets menés en même temps ne sont comptés qu'une fois">
          <span className="muted small">Total</span> {formatDuration(total)}
        </div>
      </div>

        <BarChart
          bars={buckets.map((b) => ({
            label: b.label,
            short: b.short,
            ms: totalMs(entries, b.start, b.end, now),
          }))}
        />
      </div>
        <ul className="tile breakdown">
          <li className="tile-title breakdown-head">Par projet</li>
          {rows.map(([projectId, ms]) => {
            const p = projectId != null ? projectById.get(projectId) : undefined;
            return (
              <li key={String(projectId)} className="breakdown-row">
                <span className="chip-dot" style={{ background: p?.color ?? NO_PROJECT_COLOR }} />
                <span className="breakdown-name">{p?.name ?? "Autre projet"}</span>
                <span className="breakdown-value">{formatDuration(ms)}</span>
                <span className="muted small breakdown-pct">{Math.round((ms / rowsSum) * 100)}%</span>
              </li>
            );
          })}
          {rows.length === 0 && <li className="empty">Pas encore de temps sur cette période.</li>}
        </ul>
      </div>
    </div>
  );
}

/** Boutons pause / reprise / arrêt d'un minuteur (réutilisés dans la fiche projet). */
export function TimerButtons({ timer, running }: { timer: Timer; running: boolean }) {
  return (
    <div className="row">
      {running ? (
        <button className="btn ghost icon" onClick={() => pauseTimer(timer.project_id)} title="Pause">
          <Pause size={13} fill="currentColor" />
        </button>
      ) : (
        <button className="btn primary icon" onClick={() => startTimer(timer.project_id)} title="Reprendre">
          <Play size={13} fill="currentColor" />
        </button>
      )}
      <button className="btn ghost icon stop" onClick={() => stopTimer(timer.project_id)} title="Arrêter">
        <Square size={11} fill="currentColor" />
      </button>
    </div>
  );
}

function Timers({ projects, entries, timers, settings, now }: Data & { now: Date }) {
  const [projectId, setProjectId] = useState<number | null>(null);
  const tracked = new Set(timers.map((t) => t.project_id));
  const available = projects.filter((p) => isOpen(p) && !tracked.has(p.id));
  const canAddNoProject = !tracked.has(null);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const anyRunning = timers.some((t) => isRunning(entries, t.project_id));
  const autoPausedAt = settings.auto_paused_at;

  // Un chronomètre relancé (d'ici, de l'encoche ou d'ailleurs) : l'avis « Mis en pause… » n'a plus lieu d'être.
  useEffect(() => {
    if (autoPausedAt && anyRunning) setSetting("auto_paused_at", "");
  }, [autoPausedAt, anyRunning]);

  // Si le projet choisi vient d'être lancé, on passe au suivant disponible.
  const selected: number | null | undefined =
    projectId === null ? (canAddNoProject ? null : available[0]?.id) : tracked.has(projectId) ? available[0]?.id : projectId;

  const start = (id: number | null) => {
    setSetting("auto_paused_at", "");
    startTimer(id);
  };

  return (
    <div className={anyRunning ? "timer-card running" : "timer-card"}>
      <AnimatePresence initial={false}>
        {autoPausedAt && (
          <motion.div
            className="auto-pause"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            Mis en pause à{" "}
            {new Date(autoPausedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} (inactivité).
            <button
              className="link"
              onClick={async () => {
                await setSetting("auto_paused_at", "");
                await resumeTimers(JSON.parse(settings.auto_paused_projects || "[]"));
              }}
            >
              Tout reprendre
            </button>
            <button className="link" onClick={() => setSetting("auto_paused_at", "")}>
              OK
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <ul className="timers">
        <AnimatePresence initial={false}>
          {timers.map((t) => {
            const p = t.project_id != null ? projectById.get(t.project_id) : undefined;
            const running = isRunning(entries, t.project_id);
            return (
              <motion.li
                key={t.id}
                layout
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={running ? "timer-row" : "timer-row paused"}
              >
                <span
                  className={running ? "pulse" : "chip-dot"}
                  style={{ background: p?.color ?? NO_PROJECT_COLOR }}
                />
                <span className="timer-project">{p?.name ?? "Autre projet"}</span>
                {!running && <span className="muted small">en pause</span>}
                <span className="timer-clock">{formatClock(timerElapsed(t, entries, now))}</span>
                <TimerButtons timer={t} running={running} />
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>

      {(available.length > 0 || canAddNoProject) && (
        <div className="timer-add">
          <Select
            className="timer-select"
            value={selected ?? null}
            onChange={setProjectId}
            options={projectOptions(available, canAddNoProject ? "Autre projet" : null)}
            ariaLabel="Projet du minuteur"
          />
          <button className="btn primary" onClick={() => selected !== undefined && start(selected)}>
            {timers.length ? <Plus size={14} strokeWidth={2.5} /> : <Play size={13} fill="currentColor" />}
            {timers.length ? "Ajouter un minuteur" : "Démarrer"}
          </button>
        </div>
      )}
    </div>
  );
}

function BarChart({ bars }: { bars: { label: string; short: string; ms: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.ms), 60 * 60_000); // au moins 1h d'échelle
  const scaleHours = Math.ceil(hours(max));

  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="chart-scale muted small">{scaleHours}h</div>
      <div className="chart-plot">
        <div className="chart-grid" />
        {bars.map((b, i) => (
          <div key={i} className="bar-slot" onMouseEnter={() => setHover(i)}>
            <motion.div
              className={hover === i ? "bar hover" : "bar"}
              style={{ background: BAR_COLOR }}
              initial={false}
              animate={{ height: `${(b.ms / (scaleHours * 3_600_000)) * 100}%` }}
              transition={{ type: "spring", stiffness: 260, damping: 30 }}
            />
            {hover === i && (
              <div className="tooltip" style={{ left: `clamp(56px, ${((i + 0.5) / bars.length) * 100}%, calc(100% - 56px))` }}>
                <span className="tooltip-label">{b.label}</span>
                <span className="tooltip-value">{formatDuration(b.ms)}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="chart-axis">
        {bars.map((b, i) => (
          <span key={i} className="muted">
            {b.short}
          </span>
        ))}
      </div>
    </div>
  );
}
