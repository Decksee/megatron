import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  endFocus,
  saveFocusProgress,
  setSetting,
  startFocus,
  type FocusMode,
  type FocusSession,
} from "../db";
import {
  activeFocus,
  FOCUS_BUDGETS,
  FOCUS_DURATIONS,
  focusElapsedMs,
  type FocusStatus,
} from "../focus";
import { formatClock, formatDuration, NO_PROJECT_COLOR, startOfDay } from "../time";
import type { Data } from "../useData";
import { Select } from "../components/Select";
import { Blocklist } from "../components/Blocklist";
import { FocusDial } from "../components/FocusDial";
import { Ban, Bell, Check, Minus, Plus, Target } from "lucide-react";
import { projectOptions } from "../options";

const fade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.18 },
};

/** Part du temps passée concentré (hors distractions). */
const score = (s: FocusSession, distractionMs: number, now: Date) => {
  const end = s.ended_at ? new Date(s.ended_at) : now;
  const elapsed = Math.max(1, end.getTime() - new Date(s.started_at).getTime());
  return Math.max(0, Math.round((1 - distractionMs / elapsed) * 100));
};

export function Focus(data: Data & { now: Date; status: FocusStatus | null }) {
  const active = activeFocus(data.focusSessions);
  const last = data.focusSessions[0];
  const showSummary = !active && last?.ended_at && data.settings.focus_summary_seen !== String(last.id);

  return (
    <AnimatePresence mode="wait" initial={false}>
      {active ? (
        <motion.div key={`active-${active.id}`} className="view" {...fade}>
          <ActiveFocus session={active} {...data} />
        </motion.div>
      ) : showSummary ? (
        <motion.div key={`summary-${last.id}`} className="view" {...fade}>
          <Summary session={last} {...data} />
        </motion.div>
      ) : (
        <motion.div key="setup" className="view" {...fade}>
          <Setup {...data} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Setup({ projects, settings, focusSessions, now }: Data & { now: Date }) {
  const [minutes, setMinutes] = useState(() => Number(settings.focus_duration ?? 50));
  const [budget, setBudget] = useState(() => Number(settings.focus_budget ?? 5));
  const [mode, setMode] = useState<FocusMode>(() => (settings.focus_mode as FocusMode) ?? "alert");
  const [projectId, setProjectId] = useState<number | null>(null);

  const today = focusSessions.filter((s) => s.ended_at && new Date(s.started_at) >= startOfDay(now));
  const todayMs = today.reduce((sum, s) => sum + (new Date(s.ended_at!).getTime() - new Date(s.started_at).getTime()), 0);
  const avgScore = today.length ? Math.round(today.reduce((sum, s) => sum + score(s, s.distraction_ms, now), 0) / today.length) : null;

  const start = async () => {
    await Promise.all([
      setSetting("focus_duration", String(minutes)),
      setSetting("focus_budget", String(budget)),
      setSetting("focus_mode", mode),
    ]);
    await startFocus({ projectId, plannedMinutes: minutes, budgetMinutes: budget, mode });
  };

  return (
    <div className="focus-grid">
      <div className="tile focus-hero">
        <FocusDial minutes={minutes} onChange={setMinutes} now={now} />
        <div className="duration-bar" role="group" aria-label="Durée">
          <button className="duration-step" onClick={() => setMinutes((m) => Math.max(5, m - 5))} aria-label="5 minutes de moins">
            <Minus size={14} />
          </button>
          {FOCUS_DURATIONS.map((m) => (
            <button key={m} className={m === minutes ? "duration-preset active" : "duration-preset"} onClick={() => setMinutes(m)}>
              {m === minutes && <motion.span layoutId="duration-pill" className="duration-pill" />}
              <span>{m}</span>
            </button>
          ))}
          <button className="duration-step" onClick={() => setMinutes((m) => Math.min(480, m + 5))} aria-label="5 minutes de plus">
            <Plus size={14} />
          </button>
        </div>
        <button className="btn primary big" onClick={start}>
          <Target size={15} /> Lancer le focus
        </button>
      </div>

      <div className="tile focus-options">
        <div className="field">
          <span className="field-label">Projet</span>
          <Select
            value={projectId}
            onChange={setProjectId}
            options={projectOptions(projects, "Aucun").map((o) =>
              o.value == null ? o : { ...o, hint: "lance son minuteur" },
            )}
            ariaLabel="Projet de la session"
          />
        </div>
        <div className="field">
          <span className="field-label">Distraction autorisée</span>
          <div className="row wrap">
            {FOCUS_BUDGETS.map((b) => (
              <button key={b} className={b === budget ? "chip active" : "chip"} onClick={() => setBudget(b)}>
                {b} min
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field-label">Une fois le budget dépassé</span>
          <div className="mode-cards">
            {(["alert", "block"] as const).map((m) => (
              <button key={m} className={m === mode ? "mode-card active" : "mode-card"} onClick={() => setMode(m)}>
                {m === "alert" ? <Bell size={16} /> : <Ban size={16} />}
                <span className="mode-name">{m === "alert" ? "M'alerter" : "Bloquer"}</span>
                <span className="tile-caption">
                  {m === "alert" ? "Notification et encoche rouge" : "Réduit la fenêtre qui distrait"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="focus-side">
        <div className="tile blocklist-tile">
          <Blocklist settings={settings} />
        </div>
        <div className="tile focus-stats">
          <div>
            <span className="stat-value">{today.length}</span>
            <span className="tile-caption">session{today.length > 1 ? "s" : ""}</span>
          </div>
          <div>
            <span className="stat-value">{formatDuration(todayMs)}</span>
            <span className="tile-caption">de focus</span>
          </div>
          <div>
            <span className="stat-value">{avgScore != null ? `${avgScore}%` : "—"}</span>
            <span className="tile-caption">concentré</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ring({ ratio, color, children }: { ratio: number; color: string; children: React.ReactNode }) {
  const r = 64;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring">
      <svg viewBox="0 0 150 150" width={150} height={150}>
        <circle cx={75} cy={75} r={r} fill="none" className="ring-track" strokeWidth={8} />
        <motion.circle
          cx={75}
          cy={75}
          r={r}
          fill="none"
          stroke={color}
          style={{ transition: "stroke 0.4s" }}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - ratio) }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          transform="rotate(-90 75 75)"
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

function ActiveFocus({ session, projects, now, status }: Data & { session: FocusSession; now: Date; status: FocusStatus | null }) {
  const [confirmQuit, setConfirmQuit] = useState(false);
  const planned = session.planned_minutes * 60_000;
  const elapsed = Math.min(planned, focusElapsedMs(session, now));
  const project = projects.find((p) => p.id === session.project_id);
  const distractionMs = status?.distractionMs ?? session.distraction_ms;
  const budget = session.budget_minutes * 60_000;
  const over = distractionMs > budget;
  const distracted = status?.distraction;

  const stop = async (completed: boolean) => {
    if (status) await saveFocusProgress(session.id, status.distractionMs, status.byKey);
    await endFocus(session, completed);
  };

  return (
    <div className="tile focus-active">
      <Ring ratio={elapsed / planned} color={distracted ? "var(--danger)" : "var(--accent)"}>
        <span className="ring-time">{formatClock(planned - elapsed)}</span>
        <span className="muted small">sur {session.planned_minutes} min</span>
      </Ring>

      <div className="focus-info">
        <div className="focus-project">
          <span className="chip-dot" style={{ background: project?.color ?? NO_PROJECT_COLOR }} />
          {project?.name ?? "Focus libre"}
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={distracted ?? "ok"}
            className={distracted ? "focus-state bad" : "focus-state good"}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 6 }}
          >
            {distracted ? `Distraction : ${distracted}` : "Concentré"}
          </motion.div>
        </AnimatePresence>

        <div className="field">
          <div className="budget-head">
            <span className="field-label">Distraction</span>
            <span className={over ? "budget-value over" : "budget-value"}>
              {formatClock(distractionMs)} / {session.budget_minutes} min
            </span>
          </div>
          <div className="progress">
            <motion.div
              className="progress-fill"
              style={{ background: over ? "var(--danger)" : "var(--warning)", transition: "background 0.3s" }}
              initial={false}
              animate={{
                width: `${budget ? Math.min(100, (distractionMs / budget) * 100) : distractionMs ? 100 : 0}%`,
              }}
            />
          </div>
          {over && (
            <span className="small over-text">
              {session.mode === "block" ? "Budget épuisé : les distractions sont bloquées." : "Budget épuisé !"}
            </span>
          )}
        </div>

        <div className="row">
          <button className="btn primary" onClick={() => stop(true)}>
            <Check size={14} strokeWidth={2.5} /> Terminer
          </button>
          {confirmQuit ? (
            <button className="btn danger" onClick={() => stop(false)}>
              Confirmer l'abandon
            </button>
          ) : (
            <button className="btn ghost" onClick={() => setConfirmQuit(true)}>
              Abandonner
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ session, now }: Data & { session: FocusSession; now: Date }) {
  const duration = new Date(session.ended_at!).getTime() - new Date(session.started_at).getTime();
  const byKey = Object.entries(JSON.parse(session.distractions || "{}") as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const pct = score(session, session.distraction_ms, now);

  return (
    <div className="tile focus-summary">
      <Target size={28} className="summary-icon" />
      <div className="summary-title">{session.completed ? "Session terminée" : "Session arrêtée"}</div>
      <div className="focus-today">
        <div className="stat">
          <span className="stat-value">{formatDuration(duration)}</span>
          <span className="muted small">de focus</span>
        </div>
        <div className="stat">
          <span className="stat-value">{formatDuration(session.distraction_ms)}</span>
          <span className="muted small">distrait</span>
        </div>
        <div className="stat">
          <span className="stat-value">{pct}%</span>
          <span className="muted small">concentré</span>
        </div>
      </div>
      {byKey.length > 0 && (
        <div className="muted small">
          Distractions : {byKey.map(([k, ms]) => `${k} (${formatDuration(ms)})`).join(", ")}
        </div>
      )}
      <button className="btn primary" onClick={() => setSetting("focus_summary_seen", String(session.id))}>
        OK
      </button>
    </div>
  );
}
