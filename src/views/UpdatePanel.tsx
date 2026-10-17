import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Download, PartyPopper, RefreshCw, X } from "lucide-react";
import { setSetting, type Settings } from "../db";
import { ErrorNote } from "../components/ErrorNote";
import { autoUpdateOn, availableUpdate, checkForUpdate, installUpdate, isNewer } from "../updater";
import { Switch } from "../components/Switch";

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

/** Le bandeau de félicitations disparaît tout seul au bout de ce temps. */
const CONGRATS_MS = 20_000;

/**
 * Bandeau en haut de la fenêtre Mégatron : une nouvelle version à installer (seulement si elle est
 * plus récente que celle installée), ou des félicitations juste après une mise à jour.
 */
export function UpdateBanner({ settings, onNews }: { settings: Settings; onNews?: () => void }) {
  const [installed, setInstalled] = useState<string | null>(null);
  useEffect(() => {
    if (isTauri) getVersion().then(setInstalled).catch(() => {});
  }, []);
  const justUpdated = !!installed && settings.just_updated === installed;
  useEffect(() => {
    if (!justUpdated) return;
    const t = window.setTimeout(() => void setSetting("just_updated", ""), CONGRATS_MS);
    return () => window.clearTimeout(t);
  }, [justUpdated]);

  if (justUpdated) {
    const close = () => void setSetting("just_updated", "");
    return (
      <div className="update-banner congrats">
        <span className="with-icon">
          <PartyPopper size={15} />
          <span>
            <b>Mégatron est à jour : version {installed}.</b> Découvre ce qui a changé.
          </span>
        </span>
        <span className="row">
          {onNews && (
            <button
              className="btn primary"
              onClick={() => {
                close();
                onNews();
              }}
            >
              Voir les nouveautés
            </button>
          )}
          <button className="icon-round" onClick={close} aria-label="Fermer">
            <X size={14} />
          </button>
        </span>
      </div>
    );
  }

  const update = availableUpdate(settings);
  // Une info périmée (version déjà installée ou plus ancienne) ne s'affiche jamais.
  if (!update || !installed || !isNewer(update.version, installed)) return null;
  return (
    <div className="update-banner">
      <span>
        <b>Mégatron {update.version} est disponible.</b>{" "}
        {autoUpdateOn(settings)
          ? "Il s'installera tout seul à ta prochaine pause, ou maintenant si tu préfères."
          : "L'installation prend quelques secondes, puis il redémarre."}
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
    <>
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
      <span className="muted small">Mégatron vérifie tout seul au démarrage, toutes les 30 minutes et quand tu reviens sur la fenêtre.</span>
    </section>
    <section className="setting">
      <div>
        <div className="setting-title">Mises à jour automatiques</div>
        <div className="muted small">
          Mégatron télécharge chaque nouvelle version et l'installe tout seul à ta prochaine pause (jamais pendant un
          focus, un minuteur ou une conversation), puis redémarre.
        </div>
      </div>
      <Switch
        label="Mises à jour automatiques"
        checked={autoUpdateOn(settings)}
        onChange={(v) => setSetting("auto_update", v ? "1" : "0")}
      />
    </section>
    </>
  );
}
