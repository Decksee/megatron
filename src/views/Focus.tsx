import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  endFocus,
  pauseFocus,
  resumeFocus,
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
  IDLE_KEY,
  type FocusStatus,
} from "../focus";
import { formatClock, formatDuration, NO_PROJECT_COLOR, startOfDay } from "../time";
import type { Data } from "../useData";
import { Select } from "../components/Select";
import { Blocklist } from "../components/Blocklist";
import { FocusDial } from "../components/FocusDial";
import { Ban, Bell, Check, Minus, Pause, Play, Plus, Target } from "lucide-react";
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
  const elapsed = Math.max(1, focusElapsedMs(s, end));
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

const TIMER_SIZE = 196;
const TIMER_R = 80;
const TIMER_STROKE = 8;
const TIMER_TICKS = 60;

/** Le grand minuteur du focus : graduations qui s'allument, arc en dégradé, curseur au bout. */
function FocusTimer({ ratio, alert, paused = false, children }: { ratio: number; alert: boolean; paused?: boolean; children: React.ReactNode }) {
  const c = TIMER_SIZE / 2;
  const circumference = 2 * Math.PI * TIMER_R;
  const color = alert ? "var(--danger)" : "var(--accent)";
  const angle = ratio * 2 * Math.PI - Math.PI / 2;
  return (
    <div className={`focus-timer${alert ? " alert" : ""}${paused ? " paused" : ""}`}>
      <motion.div
        className="focus-timer-glow"
        animate={{ opacity: [0.35, 0.7, 0.35], scale: [0.96, 1.02, 0.96] }}
        transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
      />
      <svg width={TIMER_SIZE} height={TIMER_SIZE} viewBox={`0 0 ${TIMER_SIZE} ${TIMER_SIZE}`} aria-hidden="true">
        <defs>
          <linearGradient id="focus-timer-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.5" />
            <stop offset="1" stopColor={color} />
          </linearGradient>
        </defs>
        {Array.from({ length: TIMER_TICKS }, (_, i) => {
          const a = (i / TIMER_TICKS) * 2 * Math.PI - Math.PI / 2;
          const major = i % 5 === 0;
          const r1 = TIMER_R + TIMER_STROKE / 2 + 6;
          const r2 = r1 + (major ? 6 : 3);
          return (
            <line
              key={i}
              x1={c + r1 * Math.cos(a)}
              y1={c + r1 * Math.sin(a)}
              x2={c + r2 * Math.cos(a)}
              y2={c + r2 * Math.sin(a)}
              className={i / TIMER_TICKS <= ratio ? "dial-tick lit" : "dial-tick"}
              style={alert && i / TIMER_TICKS <= ratio ? { stroke: "rgb(var(--danger-rgb) / 0.75)" } : undefined}
              strokeWidth={major ? 1.6 : 1}
              strokeLinecap="round"
            />
          );
        })}
        <circle cx={c} cy={c} r={TIMER_R} fill="none" className="ring-track" strokeWidth={TIMER_STROKE} />
        <motion.circle
          cx={c}
          cy={c}
          r={TIMER_R}
          fill="none"
          stroke="url(#focus-timer-grad)"
          strokeWidth={TIMER_STROKE}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - ratio) }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          transform={`rotate(-90 ${c} ${c})`}
        />
        <motion.circle
          r={6}
          className="dial-knob"
          initial={false}
          animate={{ cx: c + TIMER_R * Math.cos(angle), cy: c + TIMER_R * Math.sin(angle) }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        />
      </svg>
      <div className="focus-timer-center">{children}</div>
    </div>
  );
}

function ActiveFocus({ session, projects, now, status }: Data & { session: FocusSession; now: Date; status: FocusStatus | null }) {
  const [confirmQuit, setConfirmQuit] = useState(false);
  const planned = session.planned_minutes * 60_000;
  const elapsed = Math.min(planned, focusElapsedMs(session, now));
  const remaining = planned - elapsed;
  const project = projects.find((p) => p.id === session.project_id);
  const distractionMs = status?.distractionMs ?? session.distraction_ms;
  const budget = session.budget_minutes * 60_000;
  const over = distractionMs > budget;
  const paused = !!session.paused_at;
  const distracted = paused ? null : status?.distraction;
  const resting = distracted === IDLE_KEY;
  const budgetRatio = budget ? Math.min(1, distractionMs / budget) : distractionMs ? 1 : 0;
  const pct = score(session, distractionMs, now);
  const end = new Date(now.getTime() + remaining).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const byKey = Object.entries(status?.byKey ?? (JSON.parse(session.distractions || "{}") as Record<string, number>))
    .filter(([, ms]) => ms >= 1000)
    .sort((a, b) => b[1] - a[1]);
  const maxKey = Math.max(1, ...byKey.map(([, ms]) => ms));

  const stop = async (completed: boolean) => {
    if (status) await saveFocusProgress(session.id, status.distractionMs, status.byKey);
    await endFocus(session, completed);
  };

  return (
    <div className="focus-live">
      <div className={distracted && !resting ? "tile focus-live-main distracted" : "tile focus-live-main"}>
        <FocusTimer ratio={elapsed / planned} alert={!!distracted && !resting} paused={paused}>
          <span className="focus-timer-time">{formatClock(remaining)}</span>
          <span className="dial-unit">restantes</span>
          <span className="dial-end">{paused ? "en pause" : `fin à ${end}`}</span>
        </FocusTimer>

        <div className="focus-live-info">
          <div className="focus-live-head">
            <span className="focus-project">
              <span className="chip-dot" style={{ background: project?.color ?? NO_PROJECT_COLOR }} />
              {project?.name ?? "Focus libre"}
            </span>
            <span className="mode-chip">
              {session.mode === "block" ? <Ban size={12} /> : <Bell size={12} />}
              {session.mode === "block" ? "Blocage" : "Alerte"}
            </span>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={paused ? "paused" : (distracted ?? "ok")}
              className={paused ? "focus-state paused" : resting ? "focus-state rest" : distracted ? "focus-state bad" : "focus-state good"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
            >
              <motion.span
                className="state-dot"
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: distracted ? 0.9 : 2, repeat: Infinity }}
              />
              {paused
                ? "En pause · le temps est arrêté"
                : resting
                  ? "En pause · temps de repos"
                  : distracted
                    ? `Distrait par ${distracted}`
                    : "Concentré"}
            </motion.div>
          </AnimatePresence>

          <div className="focus-live-stats">
            <div>
              <span className="tile-caption">Écoulé</span>
              <b>{formatDuration(elapsed)}</b>
            </div>
            <div>
              <span className="tile-caption">Concentration</span>
              <b className={pct >= 90 ? "good" : pct < 70 ? "bad" : ""}>{pct} %</b>
            </div>
            <div>
              <span className="tile-caption">Objectif</span>
              <b>{session.planned_minutes} min</b>
            </div>
          </div>

          <div className="budget">
            <div className="budget-head">
              <span className="tile-caption">Repos et distractions autorisés</span>
              <span className={over ? "budget-value over" : "budget-value"}>
                {formatClock(distractionMs)} / {session.budget_minutes} min
              </span>
            </div>
            <div className="budget-track">
              <motion.div
                className={over ? "budget-fill over" : budgetRatio > 0.7 ? "budget-fill warn" : "budget-fill"}
                initial={false}
                animate={{ width: `${budgetRatio * 100}%` }}
                transition={{ type: "spring", stiffness: 200, damping: 28 }}
              />
            </div>
            {over && (
              <span className="small over-text">
                {session.mode === "block" ? "Budget épuisé : les distractions sont bloquées." : "Budget épuisé !"}
              </span>
            )}
          </div>

          <div className="row focus-live-actions">
            {paused ? (
              <button className="btn primary" onClick={() => resumeFocus(session)}>
                <Play size={13} fill="currentColor" /> Reprendre
              </button>
            ) : (
              <button className="btn ghost" onClick={() => pauseFocus(session)}>
                <Pause size={13} fill="currentColor" /> Pause
              </button>
            )}
            <button className={paused ? "btn ghost" : "btn primary"} onClick={() => stop(true)}>
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

      <aside className="tile focus-live-side">
        <span className="tile-title">Distractions</span>
        {byKey.length === 0 ? (
          <div className="focus-clean">
            <Target size={22} />
            <span>Aucune pour l'instant</span>
            <span className="muted small">Continue comme ça.</span>
          </div>
        ) : (
          <ul className="distraction-list">
            {byKey.map(([key, ms]) => (
              <li key={key} className={key === distracted ? "current" : undefined}>
                <div className="distraction-row">
                  <span className="distraction-name">{key}</span>
                  <span className="distraction-time">{formatClock(ms)}</span>
                </div>
                <div className="distraction-bar">
                  <motion.i initial={false} animate={{ width: `${(ms / maxKey) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Summary({ session, now }: Data & { session: FocusSession; now: Date }) {
  const duration = focusElapsedMs(session, new Date(session.ended_at!));
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
