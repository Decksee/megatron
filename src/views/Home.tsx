import type { Data } from "../useData";

export function Home({ projects, tasks, now }: Data & { now: Date }) {
  const todo = tasks.filter((t) => !t.done).length;
  const doneToday = tasks.filter(
    (t) => t.completed_at && new Date(t.completed_at + "Z").toDateString() === now.toDateString(),
  ).length;
  const active = projects.filter((p) => p.status === "active").length;

  return (
    <div className="home">
      <div className="big-time">
        {now.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
      </div>
      <div className="date">
        {now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
      </div>
      <div className="stats">
        <div className="stat">
          <span className="stat-value">{todo}</span>
          <span className="muted small">à faire</span>
        </div>
        <div className="stat">
          <span className="stat-value">{doneToday}</span>
          <span className="muted small">faites aujourd'hui</span>
        </div>
        <div className="stat">
          <span className="stat-value">{active}</span>
          <span className="muted small">projets en cours</span>
        </div>
      </div>
    </div>
  );
}
