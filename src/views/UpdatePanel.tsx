import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, RefreshCw } from "lucide-react";
import type { Settings } from "../db";
import { ErrorNote } from "../components/ErrorNote";
import { availableUpdate, checkForUpdate, installUpdate } from "../updater";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Installe la mise à jour, avec la progression du téléchargement. */
function InstallButton({ label = "Installer maintenant" }: { label?: string }) {
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const install = async () => {
    setError(null);
    setProgress(0);
    try {
      await installUpdate(setProgress);
    } catch (e) {
      setProgress(null);
      setError(String((e as Error)?.message ?? e));
    }
  };
  return (
    <>
      <button className="btn primary" onClick={install} disabled={progress != null}>
        <Download size={13} /> {progress == null ? label : progress < 1 ? `Téléchargement… ${Math.round(progress * 100)} %` : "Installation…"}
      </button>
      {error && <ErrorNote raw={error} service="compatible" />}
    </>
  );
}

/** Bandeau en haut de la fenêtre Mégatron quand une nouvelle version est prête. */
export function UpdateBanner({ settings }: { settings: Settings }) {
  const update = availableUpdate(settings);
  if (!update) return null;
  return (
    <div className="update-banner">
      <span>
        <b>Mégatron {update.version} est disponible.</b> L'installation prend quelques secondes, puis il redémarre.
      </span>
      <InstallButton />
    </div>
  );
}

/** Dans « À propos » : version actuelle et vérification à la demande. */
export function UpdateSetting({ settings }: { settings: Settings }) {
  const [version, setVersion] = useState("");
  const [state, setState] = useState<"idle" | "checking" | "uptodate" | string>("idle");
  const update = availableUpdate(settings);

  useEffect(() => {
    if (isTauri) getVersion().then(setVersion).catch(() => {});
  }, []);

  const verify = async () => {
    setState("checking");
    try {
      const found = await checkForUpdate();
      setState(found ? "idle" : "uptodate");
    } catch (e) {
      setState(String((e as Error)?.message ?? e));
    }
  };

  return (
    <section className="setting column">
      <div className="row">
        <div className="grow">
          <div className="setting-title">Mises à jour</div>
          <span className="muted small">
            Version installée : {version || "—"}
            {update ? ` · nouvelle version ${update.version} disponible` : state === "uptodate" ? " · tu as la dernière version" : ""}
          </span>
        </div>
        {update ? (
          <InstallButton />
        ) : (
          <button className="btn ghost" onClick={verify} disabled={state === "checking"}>
            <RefreshCw size={13} className={state === "checking" ? "spin" : undefined} /> Vérifier
          </button>
        )}
      </div>
      {update?.notes && <p className="update-notes muted small">{update.notes}</p>}
      {state !== "idle" && state !== "checking" && state !== "uptodate" && (
        <div className="status warn">Impossible de vérifier les mises à jour pour le moment (pas de connexion ou aucune version publiée).</div>
      )}
      <span className="muted small">Mégatron vérifie tout seul au démarrage puis toutes les 6 heures.</span>
    </section>
  );
}
