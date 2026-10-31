import { isOpen, isTaskLate, lateByProject, taskBucket, toIsoDay } from "../projects";
import { pickNickname, withName } from "../nickname";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Check, Clock3, Plus } from "lucide-react";
import { createTask, setSetting, toggleTask } from "../db";
import { addDays, formatClock, formatDuration, isRunning, NO_PROJECT_COLOR, startOfDay, startOfWeek, totalMs } from "../time";
import type { Data } from "../useData";

const COUNTDOWN_PRESETS = [5, 10, 15, 25];
const pad = (n: number) => String(n).padStart(2, "0");
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Anneau de progression réutilisable (minuteur, tâches). */
export function ProgressRing({
  ratio,
  size,
  stroke = 4,
  children,
}: {
  ratio: number;
  size: number;
  stroke?: number;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ring-track" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="ring-fill"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, ratio))) }}
          transition={{ type: "spring", stiffness: 120, damping: 22 }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <div className="ring-center">{children}</div>}
    </div>
  );
}

export function Today({ now, onOpen, ...data }: Data & { now: Date; onOpen: (tab: "time" | "reminders" | "tasks") => void }) {
  return (
    <div className="today-board">
      <div className="today-col">
        <ClockTile now={now} settings={data.settings} />
        <WorkTile {...data} now={now} onOpen={() => onOpen("time")} />
      </div>
      <div className="today-col">
        <WeekTile {...data} now={now} onOpen={() => onOpen("reminders")} />
        <CountdownTile {...data} now={now} />
      </div>
      <TodoTile {...data} now={now} onOpen={() => onOpen("tasks")} />
    </div>
  );
}

function greeting(now: Date) {
  const h = now.getHours();
  if (h < 5) return "Bonne nuit";
  if (h < 12) return "Bonjour";
  if (h < 18) return "Bon après-midi";
  return "Bonsoir";
}

function ClockTile({ now, settings }: { now: Date; settings: Data["settings"] }) {
  return (
    <div className="tile clock-tile">
      <span className="clock-greeting">{withName(greeting(now), pickNickname(settings))}</span>
      <span className="clock-digits">{pad(now.getHours())}</span>
      <span className="clock-dots" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <motion.i
            key={i}
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.25 }}
          />
        ))}
      </span>
      <span className="clock-digits">{pad(now.getMinutes())}</span>
      <span className="tile-caption">
        {now.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })}
      </span>
    </div>
  );
}

function WorkTile({ entries, timers, projects, now, onOpen }: Data & { now: Date; onOpen: () => void }) {
  const today = totalMs(entries, startOfDay(now), addDays(startOfDay(now), 1), now);
  const running = timers.filter((t) => isRunning(entries, t.project_id));
  const byId = new Map(projects.map((p) => [p.id, p]));
  return (
    <button className="tile work-tile" onClick={onOpen}>
      <span className="tile-caption with-icon">
        <Clock3 size={12} /> Aujourd'hui
      </span>
      <span className="work-value">{formatDuration(today)}</span>
      {running.length ? (
        <span className="work-running">
          {running.slice(0, 3).map((t) => (
            <span
              key={t.id}
              className="pulse"
              style={{ background: (t.project_id != null && byId.get(t.project_id)?.color) || NO_PROJECT_COLOR }}
              title={(t.project_id != null && byId.get(t.project_id)?.name) || "Autre projet"}
            />
          ))}
          <span className="tile-caption">en cours</span>
        </span>
      ) : (
        <span className="tile-caption">de travail</span>
      )}
    </button>
  );
}

function WeekTile({ reminders, projects, now, onOpen }: Data & { now: Date; onOpen: () => void }) {
  const monday = startOfWeek(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const pending = reminders.filter((r) => !r.done);
  // Jours avec un rappel ou une deadline : petit point sous la date.
  const marked = (d: Date) =>
    pending.some((r) => sameDay(new Date(r.due_at), d)) ||
    projects.some((p) => p.deadline && isOpen(p) && sameDay(new Date(`${p.deadline}T12:00`), d));

  const next = pending.filter((r) => new Date(r.due_at) >= now).sort((a, b) => a.due_at.localeCompare(b.due_at))[0];
  const range = `${days[0].getDate()} – ${days[6].toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;

  return (
    <button className="tile week-tile" onClick={onOpen}>
      <div className="tile-head">
        <span className="tile-title">Cette semaine</span>
        <span className="tile-caption">{range}</span>
      </div>
      <div className="week-days">
        {days.map((d) => (
          <div key={d.toISOString()} className={sameDay(d, now) ? "week-day today" : "week-day"}>
            <span className="week-name">{d.toLocaleDateString("fr-FR", { weekday: "short" }).slice(0, 3)}</span>
            <span className="week-num">{d.getDate()}</span>
            <span className={marked(d) ? "week-dot on" : "week-dot"} />
          </div>
        ))}
      </div>
      <div className="week-next">
        {next ? (
          <>
            <span className="tile-caption">
              Prochain · {new Date(next.due_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              {!sameDay(new Date(next.due_at), now) &&
                ` (${new Date(next.due_at).toLocaleDateString("fr-FR", { weekday: "short" })})`}
            </span>
            <span className="week-next-title">{next.title}</span>
          </>
        ) : (
          <span className="tile-caption">Aucun rappel à venir</span>
        )}
      </div>
    </button>
  );
}

function CountdownTile({ settings, now }: Data & { now: Date }) {
  const [minutes, setMinutes] = useState(5);
  const end = settings.countdown_end ? new Date(settings.countdown_end) : null;
  const total = Number(settings.countdown_total) || minutes * 60_000;
  const running = !!end && end > now;
  const remaining = running ? end.getTime() - now.getTime() : minutes * 60_000;

  const start = async () => {
    await setSetting("countdown_total", String(minutes * 60_000));
    await setSetting("countdown_end", new Date(Date.now() + minutes * 60_000).toISOString());
  };

  return (
    <div className="tile countdown-tile">
      <ProgressRing ratio={running ? remaining / total : 1} size={78} stroke={5}>
        <span className="countdown-time">{formatClock(remaining)}</span>
      </ProgressRing>
      <div className="countdown-side">
        <div className="row wrap">
          {COUNTDOWN_PRESETS.map((m) => (
            <button
              key={m}
              className={!running && m === minutes ? "chip small active" : "chip small"}
              onClick={() => setMinutes(m)}
              disabled={running}
            >
              {m} min
            </button>
          ))}
        </div>
        <div className="row">
          {running ? (
            <button className="btn ghost grow" onClick={() => setSetting("countdown_end", "")}>
              Arrêter
            </button>
          ) : (
            <button className="btn primary grow" onClick={start}>
              Démarrer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TodoTile({ tasks, projects, now, onOpen }: Data & { now: Date; onOpen: () => void }) {
  const colorOf = new Map(projects.map((p) => [p.id, p.color]));
  const [title, setTitle] = useState("");
  // Seulement les tâches prévues ou à rendre aujourd'hui (ou en retard) : ni les jours suivants, ni les tâches sans date.
  const pending = tasks.filter((t) => !t.done && taskBucket(t, now) === "today");
  const doneToday = tasks.filter(
    (t) => t.done && t.completed_at && sameDay(new Date(t.completed_at + "Z"), now),
  );
  // Les tâches en retard d'abord.
  const shown = [...pending.filter((t) => isTaskLate(t, now)), ...pending.filter((t) => !isTaskLate(t, now)), ...doneToday];
  const late = lateByProject(tasks, now);
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const ratio = shown.length ? doneToday.length / shown.length : 0;

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle("");
    await createTask(t, null, null, null, toIsoDay(new Date()));
  };

  return (
    <div className="tile todo-tile">
      <div className="tile-head">
        <span className="tile-title">Aujourd'hui</span>
        <ProgressRing ratio={ratio} size={26} stroke={3}>
          <span className="todo-count">
            {doneToday.length}/{shown.length}
          </span>
        </ProgressRing>
      </div>
      {late.total > 0 && (
        <button className="late-banner" onClick={onOpen} title="Voir les tâches">
          <AlertTriangle size={13} />
          <span>
            <b>
              {late.total} tâche{late.total > 1 ? "s" : ""} en retard
            </b>
            {" · "}
            {late.groups
              .slice(0, 3)
              .map(([id, n]) => `${id == null ? "autre projet" : nameOf.get(id)} ${n}`)
              .join(" · ")}
            {late.groups.length > 3 ? " …" : ""}
          </span>
        </button>
      )}
      <ul className="todo-list">
        <AnimatePresence initial={false}>
          {shown.map((t) => (
            <motion.li
              key={t.id}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={t.done ? "todo done" : isTaskLate(t, now) ? "todo late" : "todo"}
            >
              <button className="todo-check" onClick={() => toggleTask(t)} aria-label={t.done ? "Marquer à faire" : "Marquer faite"}>
                {t.done ? <Check size={11} strokeWidth={3} /> : null}
              </button>
              <span className="todo-title">{t.title}</span>
              {t.project_id != null && colorOf.get(t.project_id) && (
                <span className="chip-dot" style={{ background: colorOf.get(t.project_id) }} />
              )}
            </motion.li>
          ))}
        </AnimatePresence>
        {shown.length === 0 && <li className="todo-empty">Rien de prévu. Ajoute une tâche ↓</li>}
      </ul>
      <form
        className="todo-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus size={14} className="tile-icon" />
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ajouter une tâche…" />
        <button type="submit" className="todo-send" disabled={!title.trim()} aria-label="Ajouter">
          →
        </button>
      </form>
    </div>
  );
}
