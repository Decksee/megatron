import { useState } from "react";
import { motion } from "motion/react";
import { setSetting } from "../db";
import { THEME_OPTIONS, type ThemePref } from "../theme";
import { USAGES, usageOf, type Usage } from "../projects";
import { aiConfig } from "../ai/session";
import { PROVIDERS } from "../ai/providers";
import { AiSetup } from "../views/Assistant";
import { DataSettings, MemorySetting, SpeechSetting } from "../views/Settings";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
import { briefingOn } from "../wellbeing";
import type { Data } from "../useData";
import { BackgroundSteps, guideRemaining, useBackgroundStatus } from "./MobileGuide";

/** Réglages du téléphone : les mêmes blocs que sur le PC, sans ce qui n'existe pas sur mobile (encoche, Windows). */
export function MobileSettings({ settings, memories }: Data) {
  const background = useBackgroundStatus();
  const left = guideRemaining(background, settings);
  const [editingAi, setEditingAi] = useState(false);
  const config = aiConfig(settings);
  const usage = usageOf(settings);

  return (
    <div className="m-settings">
      <h2 className="m-section-title">Général</h2>
      <div className="settings">
        <section className="setting column">
          <div>
            <div className="setting-title">Tes projets</div>
            <div className="muted small">{USAGES[usage].hint}</div>
          </div>
          <div className="segmented m-segmented">
            {(Object.keys(USAGES) as Usage[]).map((u) => (
              <button key={u} className={u === usage ? "seg active" : "seg"} onClick={() => setSetting("usage", u)}>
                {u === usage && (
                  <motion.span layoutId="m-usage-seg" className="m-seg-pill" transition={{ type: "spring", stiffness: 500, damping: 38 }} />
                )}
                <span className="tab-label">{USAGES[u].label}</span>
              </button>
            ))}
          </div>
        </section>
        <section className="setting">
          <div>
            <div className="setting-title">Thème</div>
            <div className="muted small">Clair, sombre, ou comme le téléphone.</div>
          </div>
          <Select<ThemePref>
            value={(settings.theme as ThemePref) || "system"}
            onChange={(v) => setSetting("theme", v)}
            options={THEME_OPTIONS}
          />
        </section>
        <section className="setting">
          <div>
            <div className="setting-title">Tâche en cours dans les notifications</div>
            <div className="muted small">Toujours visible dans le volet, avec Fait et Replanifier, même appli fermée.</div>
          </div>
          <Switch label="Tâche en cours" checked={settings.pin_task !== "0"} onChange={(v) => setSetting("pin_task", v ? "1" : "0")} />
        </section>
        <section className="setting">
          <div>
            <div className="setting-title">Point du matin</div>
            <div className="muted small">À 8 h, une notification avec ce que tu as à faire aujourd'hui.</div>
          </div>
          <Switch label="Point du matin" checked={briefingOn(settings)} onChange={(v) => setSetting("briefing", v ? "1" : "0")} />
        </section>
      </div>

      <h2 className="m-section-title">Appli fermée {left > 0 && <span className="m-section-badge">{left} à faire</span>}</h2>
      <BackgroundSteps status={background} settings={settings} />

      <h2 className="m-section-title">IA</h2>
      {!config || editingAi ? (
        <AiSetup settings={settings} onDone={() => setEditingAi(false)} canCancel={!!config} />
      ) : (
        <div className="settings">
          <section className="setting column">
            <div>
              <div className="setting-title">Connecté à {PROVIDERS[config.provider].label}</div>
              <div className="muted small">Modèle : {config.model}. La clé reste sur ce téléphone.</div>
            </div>
            <button className="btn ghost" onClick={() => setEditingAi(true)}>
              Changer de fournisseur ou de clé
            </button>
          </section>
          <SpeechSetting settings={settings} />
          <MemorySetting settings={settings} memories={memories} />
        </div>
      )}

      <h2 className="m-section-title">Sauvegarde</h2>
      <p className="muted small m-hint">
        Pour retrouver tes données du PC : sur le PC, Réglages → Données → Exporter, envoie-toi le fichier, puis importe-le ici.
      </p>
      <DataSettings />
    </div>
  );
}
