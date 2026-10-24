import { useEffect, useState, type ReactNode } from "react";
import { BatteryCharging, Bell, Check, ChevronRight, Rocket } from "lucide-react";
import { setSetting } from "../db";
import { native } from "./native";
import type { Data } from "../useData";

const isTauri = "__TAURI_INTERNALS__" in window;

interface Status {
  brand: string;
  notifications: boolean;
  battery: boolean;
  exactAlarms: boolean;
}

/** Ce qu'Android autorise déjà ; revérifié à chaque retour dans l'appli (après un passage par les réglages). */
export function useBackgroundStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    if (!isTauri) {
      setStatus({ brand: "samsung", notifications: true, battery: false, exactAlarms: true });
      return;
    }
    const check = () => native<Status>("backgroundStatus").then(setStatus).catch(() => {});
    check();
    const onVisible = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);
  return status;
}

type Family = "samsung" | "transsion" | "other";
const familyOf = (brand: string): Family =>
  brand.includes("samsung") ? "samsung" : /tecno|infinix|itel|transsion/.test(brand) ? "transsion" : "other";

/** Étape propre à la marque : Android ne dit pas si elle est faite, on la coche soi-même. */
const BRAND_STEP: Record<Family, { title: string; text: string }> = {
  samsung: {
    title: "Applis jamais en veille",
    text: "Batterie → Limites d'utilisation en arrière-plan → Applis jamais en veille → « + » → Mégatron.",
  },
  transsion: {
    title: "Démarrage automatique",
    text: "Active le démarrage auto de Mégatron, puis verrouille-le dans les applis récentes (glisse sa carte vers le bas ou touche le cadenas).",
  },
  other: {
    title: "Démarrage automatique",
    text: "Si ton téléphone propose « Démarrage auto » ou « Applis protégées », active-le pour Mégatron.",
  },
};

export function guideRemaining(status: Status | null, settings: Data["settings"]) {
  if (!status) return 0;
  return [status.notifications, status.battery, settings.m_guide_brand === "1"].filter((ok) => !ok).length;
}

/** Les étapes, utilisables dans un panneau (premier lancement) ou dans les Réglages. */
export function BackgroundSteps({ status, settings }: { status: Status | null; settings: Data["settings"] }) {
  if (!status) return <span className="muted small">Vérification…</span>;
  const family = familyOf(status.brand);
  const brandDone = settings.m_guide_brand === "1";
  const open = (which: string) => void native("openBackgroundSettings", { which }).catch(console.error);

  const step = (done: boolean, icon: ReactNode, title: string, text: string, action: () => void, label: string, extra?: ReactNode) => (
    <div className={done ? "m-guide-step done" : "m-guide-step"}>
      <span className="m-guide-icon">{done ? <Check size={18} strokeWidth={3} /> : icon}</span>
      <div className="m-guide-body">
        <b>{title}</b>
        <span className="muted small">{text}</span>
        {!done && (
          <div className="m-guide-actions">
            <button type="button" className="btn primary" onClick={action}>
              {label} <ChevronRight size={15} />
            </button>
            {extra}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="m-guide">
      {step(
        status.notifications,
        <Bell size={18} />,
        "Notifications",
        "Pour la tâche en cours, tes rappels et le point du matin.",
        () => open("notifications"),
        "Autoriser",
      )}
      {step(
        status.battery,
        <BatteryCharging size={18} />,
        "Pas de mise en veille",
        "Android ne coupe plus Mégatron : rappels à l'heure, même appli fermée. Mégatron ne tourne pas en continu, ta batterie n'est pas touchée.",
        () => open("battery"),
        "Autoriser",
      )}
      {step(
        brandDone,
        <Rocket size={18} />,
        BRAND_STEP[family].title,
        BRAND_STEP[family].text,
        () => open("brand"),
        "Ouvrir les réglages",
        <button type="button" className="btn ghost" onClick={() => setSetting("m_guide_brand", "1")}>
          C'est fait
        </button>,
      )}
    </div>
  );
}
