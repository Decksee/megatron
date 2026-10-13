import { useState } from "react";
import { motion } from "motion/react";
import type { Data } from "../useData";
import { TaskList } from "./TaskList";
import { ProgressRing } from "./Today";
import { addDays, startOfWeek } from "../time";

type Filter = "all" | "none" | number;

export function Tasks({ projects, tasks }: Data) {
  const [filter, setFilter] = useState<Filter>("all");
  const active = projects.filter((p) => p.status === "active");

  const visible = tasks.filter((t) =>
    filter === "all" ? true : filter === "none" ? t.project_id == null : t.project_id === filter,
  );
  const remaining = visible.filter((t) => !t.done).length;
  const done = visible.length - remaining;
  const today = new Date().toDateString();
  const doneToday = tasks.filter((t) => t.done && t.completed_at && new Date(t.completed_at + "Z").toDateString() === today).length;
  const monday = startOfWeek(new Date());
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    return {
      label: d.toLocaleDateString("fr-FR", { weekday: "narrow" }),
      isToday: d.toDateString() === today,
      count: tasks.filter((t) => t.completed_at && new Date(t.completed_at + "Z").toDateString() === d.toDateString()).length,
    };
  });
  const weekMax = Math.max(1, ...week.map((d) => d.count));
  const weekTotal = week.reduce((s, d) => s + d.count, 0);
  const perProject = active
    .map((p) => ({ p, left: tasks.filter((t) => t.project_id === p.id && !t.done).length }))
    .filter((x) => x.left > 0);

  const chip = (value: Filter, label: string, color?: string) => (
    <button
      key={String(value)}
      className={filter === value ? "chip active" : "chip"}
      onClick={() => setFilter(value)}
    >
      {color && <span className="chip-dot" style={{ background: color }} />}
      {label}
    </button>
  );

  return (
    <div className="split">
      <div className="view">
        <div className="chips">
          {chip("all", "Toutes")}
          {chip("none", "Sans projet")}
          {active.map((p) => chip(p.id, p.name, p.color))}
        </div>
        <TaskList
          tasks={visible}
          projects={projects}
          projectId={typeof filter === "number" ? filter : null}
          showProject={filter === "all"}
        />
      </div>
      <aside className="side">
        <div className="tile side-stat">
          <ProgressRing ratio={visible.length ? done / visible.length : 0} size={64} stroke={5}>
            <span className="ring-label">
              {done}/{visible.length}
            </span>
          </ProgressRing>
          <div>
            <div className="side-value">{remaining} à faire</div>
            <div className="tile-caption">{doneToday} faite{doneToday > 1 ? "s" : ""} aujourd'hui</div>
          </div>
        </div>
        <div className="tile week-done">
          <div className="tile-head">
            <span className="tile-title">Cette semaine</span>
            <span className="tile-caption">{weekTotal} faite{weekTotal > 1 ? "s" : ""}</span>
          </div>
          <div className="mini-bars">
            {week.map((d, i) => (
              <div key={i} className={d.isToday ? "mini-bar today" : "mini-bar"} title={`${d.count} tâche(s)`}>
                <div className="mini-bar-track">
                  <motion.i
                    initial={false}
                    animate={{ height: `${(d.count / weekMax) * 100}%` }}
                    transition={{ type: "spring", stiffness: 200, damping: 26 }}
                  />
                </div>
                <span>{d.label}</span>
              </div>
            ))}
          </div>
        </div>
        {perProject.length > 0 && (
          <div className="tile side-list">
            <span className="tile-title">Par projet</span>
            {perProject.map(({ p, left }) => (
              <button key={p.id} className="side-row" onClick={() => setFilter(p.id)}>
                <span className="chip-dot" style={{ background: p.color }} />
                <span className="side-row-name">{p.name}</span>
                <span className="side-row-value">{left}</span>
              </button>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
