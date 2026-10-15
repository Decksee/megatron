import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { CHANGELOG } from "../changelog";
import type { Settings } from "../db";
import { UpdateSetting } from "./UpdatePanel";

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Historique des versions : ce qu'apporte chacune, la version installée repérée. */
export function Versions({ settings }: { settings: Settings }) {
  const [installed, setInstalled] = useState<string | null>(null);
  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) getVersion().then(setInstalled).catch(() => {});
  }, []);
  const update = (() => {
    try {
      return JSON.parse(settings.update_available || "null") as { version: string; notes: string } | null;
    } catch {
      return null;
    }
  })();
  const available = update?.version ?? null;
  // Une version plus récente que l'app n'est pas encore dans l'historique embarqué : on montre ses notes.
  const releases = [
    ...(update && !CHANGELOG.some((r) => r.version === update.version)
      ? [{ version: update.version, date: "", title: "Nouvelle version", changes: update.notes ? [update.notes] : [] }]
      : []),
    ...CHANGELOG,
  ];

  return (
    <div className="settings">
      <UpdateSetting settings={settings} />
      <ol className="versions">
        {releases.map((r) => {
          const current = r.version === installed;
          return (
            <li key={r.version} className={current ? "version current" : "version"}>
              <div className="version-head">
                <b className="version-number">{r.version}</b>
                <span className="version-title">{r.title}</span>
                {current && <span className="version-badge">Installée</span>}
                {r.version === available && <span className="version-badge new">Disponible</span>}
                {r.date && <span className="muted small version-date">{formatDate(r.date)}</span>}
              </div>
              <ul className="version-changes">
                {r.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
