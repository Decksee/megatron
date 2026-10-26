import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { enable as enableAutostart, disable as disableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Briefcase,
  Clock3,
  FolderKanban,
  GraduationCap,
  ListChecks,
  MousePointer2,
  Smartphone,
  Sparkles,
  Target,
} from "lucide-react";
import { setSetting } from "../db";
import { USAGES, usageOf, type Usage } from "../projects";
import { aiConfig } from "../ai/session";
import { BREAK_OPTIONS, briefingOn } from "../wellbeing";
import { Bot } from "../components/Bot";
import { Switch } from "../components/Switch";
import { Select } from "../components/Select";
import type { Data } from "../useData";
import { MemoryAdd, NamesSetting } from "./Settings";

const USAGE_ICONS: Record<Usage, typeof Briefcase> = { freelance: Briefcase, studies: GraduationCap, personal: Sparkles };
const STEPS = ["Bienvenue", "Ton usage", "Toi", "Ce que je fais", "Me parler", "C'est parti"];

/**
 * Visite guidée du premier lancement : présentation, type d'usage, fonctions, IA, puis réglages de départ.
 * `onFinish(target)` : ferme la visite et ouvre la page voulue (« ia » pour connecter une IA).
 */
export function Welcome({ settings, onFinish }: Pick<Data, "settings"> & { onFinish: (target: "tasks" | "ia") => void }) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [usage, setUsage] = useState<Usage | null>(settings.usage ? usageOf(settings) : null);
  const hasAi = !!aiConfig(settings);

  const go = (next: number) => {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  };
  const finish = async (target: "tasks" | "ia") => {
    try {
      await setSetting("usage", usage ?? "freelance");
      await setSetting("onboarded", "1");
    } catch (e) {
      console.error(e);
    }
    onFinish(target);
  };

  return (
    <div className="welcome">
      <div className="welcome-progress" aria-label={`Étape ${step + 1} sur ${STEPS.length}`}>
        {STEPS.map((label, i) => (
          <span key={label} className={i === step ? "active" : i < step ? "done" : ""} title={label} />
        ))}
      </div>

      <AnimatePresence mode="wait" custom={direction} initial={false}>
        <motion.div
          key={step}
          className="welcome-step"
          custom={direction}
          initial={{ opacity: 0, x: direction * 28 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: direction * -28, transition: { duration: 0.12 } }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === 0 && (
            <div className="welcome-hero">
              <Bot mood="happy" size={88} />
              <h1>Salut, moi c'est Mégatron</h1>
              <p className="muted">
                Je vis dans l'encoche en haut de ton écran. Je t'aide à t'organiser : tâches, projets, temps de travail,
                focus et rappels, avec une IA à qui tu peux parler.
              </p>
              <p className="muted small">La visite prend une minute.</p>
            </div>
          )}

          {step === 1 && (
            <>
              <h2>Tu m'utilises plutôt pour…</h2>
              <p className="muted">J'adapte les projets à ton usage. Tu pourras changer à tout moment dans les Réglages.</p>
              <div className="welcome-usages">
                {(Object.keys(USAGES) as Usage[]).map((u) => {
                  const Icon = USAGE_ICONS[u];
                  return (
                    <button
                      key={u}
                      className={usage === u ? "usage-option selected" : "usage-option"}
                      onClick={() => {
                        setUsage(u);
                        void setSetting("usage", u).catch(console.error);
                      }}
                      aria-pressed={usage === u}
                    >
                      <Icon size={22} />
                      <b>{USAGES[u].label}</b>
                      <span className="muted small">{USAGES[u].hint}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2>Et toi, comment je t'appelle ?</h2>
              <p className="muted">Je m'en sers pour te dire bonjour et dans mes notifications. Tout est facultatif et se change dans Réglages → Toi.</p>
              <div className="settings welcome-settings">
                <NamesSetting settings={settings} />
                <section className="setting column">
                  <div>
                    <div className="setting-title">Parle-moi un peu de toi</div>
                    <div className="muted small">Ton métier, tes clients, ta façon de travailler : je m'en souviendrai pour mieux t'aider.</div>
                  </div>
                  <MemoryAdd />
                </section>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2>Ce que je fais pour toi</h2>
              <div className="welcome-features">
                <Feature icon={MousePointer2} title="L'encoche">
                  Passe la souris en haut de l'écran : elle s'ouvre sur ta journée. Double-clic sur mon icône près de
                  l'horloge pour cette fenêtre.
                </Feature>
                <Feature icon={ListChecks} title="Tâches">
                  Un jour prévu (quand tu comptes la faire) et une échéance (la date limite). Chaque matin, je te dis ce
                  qui t'attend.
                </Feature>
                <Feature icon={FolderKanban} title="Projets">
                  {usage && USAGES[usage].money
                    ? "Clients, prix, extras et paiements : tu sais toujours ce qu'on te doit."
                    : "Statuts, dates et tâches de chaque projet, au même endroit."}
                </Feature>
                <Feature icon={Clock3} title="Temps">
                  Lance un minuteur par projet. Il se met en pause tout seul quand tu t'absentes.
                </Feature>
                <Feature icon={Target} title="Focus">
                  Une session de concentration qui surveille ce qui te distrait. Et quand tu bosses trop longtemps, je te
                  propose une pause.
                </Feature>
                <Feature icon={BellRing} title="Rappels">
                  À une heure précise, une fois ou tous les jours, sur ton PC et ton téléphone.
                </Feature>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2>Parle-moi</h2>
              <p className="muted">Je comprends ce que tu me demandes et je le fais pour toi.</p>
              <div className="welcome-ways">
                <div className="tile">
                  <span className="shortcut-list">
                    <span>
                      <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Espace</kbd>
                    </span>
                  </span>
                  <span className="muted small">Appui court pour m'écrire, appui long pour me parler.</span>
                </div>
                <div className="tile">
                  <b>« Salut Mégatron »</b>
                  <span className="muted small">Dis-le à voix haute (à activer dans Réglages → IA) et on discute.</span>
                </div>
                <div className="tile">
                  <Smartphone size={16} />
                  <span className="muted small">Ou depuis ton téléphone, avec Telegram (Réglages → Téléphone).</span>
                </div>
              </div>
              <div className="welcome-examples">
                <span className="tile-caption">Par exemple</span>
                <span>« Ajoute appeler le client demain, à rendre pour vendredi »</span>
                <span>« Crée le projet Site vitrine pour Awa, 1 500 € »</span>
                <span>« Lance un focus de 50 minutes »</span>
                <span>« Rappelle-moi d'envoyer la facture à 17 h »</span>
              </div>
              {!hasAi && (
                <p className="muted small">
                  Pour ça, il me faut une clé d'IA (Gemini propose une offre gratuite). Tu pourras la connecter à la fin de
                  la visite.
                </p>
              )}
            </>
          )}

          {step === 5 && <LastTouches settings={settings} />}
        </motion.div>
      </AnimatePresence>

      <div className="welcome-nav">
        {step > 0 ? (
          <button className="btn ghost" onClick={() => go(step - 1)}>
            <ArrowLeft size={14} /> Retour
          </button>
        ) : (
          <button className="link muted" onClick={() => finish("tasks")}>
            Passer la visite
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button className="btn primary" onClick={() => go(step + 1)} disabled={step === 1 && !usage}>
            {step === 0 ? "On commence" : "Suivant"} <ArrowRight size={14} />
          </button>
        ) : (
          <div className="row">
            {!hasAi && (
              <button className="btn ghost" onClick={() => finish("ia")}>
                Connecter une IA
              </button>
            )}
            <button className="btn primary" onClick={() => finish("tasks")}>
              C'est parti <ArrowRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Feature({ icon: Icon, title, children }: { icon: typeof Briefcase; title: string; children: React.ReactNode }) {
  return (
    <div className="welcome-feature">
      <span className="window-head-icon">
        <Icon size={16} />
      </span>
      <div>
        <b>{title}</b>
        <p className="muted small">{children}</p>
      </div>
    </div>
  );
}

/** Derniers réglages : démarrage avec Windows, point du matin, conseils de pause. */
function LastTouches({ settings }: Pick<Data, "settings">) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) autostartEnabled().then(setAutostart).catch(() => setAutostart(null));
  }, []);
  return (
    <>
      <h2>Dernières touches</h2>
      <p className="muted">Tout ça se change plus tard dans Réglages → Général.</p>
      <div className="settings welcome-settings">
        <section className="setting">
          <div>
            <div className="setting-title">Démarrer avec Windows</div>
            <div className="muted small">L'encoche est là dès que tu allumes ton PC.</div>
          </div>
          <Switch
            label="Démarrer avec Windows"
            checked={!!autostart}
            disabled={autostart == null}
            onChange={async (next) => {
              setAutostart(next);
              try {
                await (next ? enableAutostart() : disableAutostart());
              } catch {
                setAutostart(!next);
              }
            }}
          />
        </section>
        <section className="setting">
          <div>
            <div className="setting-title">Point du matin</div>
            <div className="muted small">Une notification avec ce que tu as à faire, quand tu allumes ton PC.</div>
          </div>
          <Switch label="Point du matin" checked={briefingOn(settings)} onChange={(v) => setSetting("briefing", v ? "1" : "0")} />
        </section>
        <section className="setting">
          <div>
            <div className="setting-title">Conseils de pause</div>
            <div className="muted small">Quand tu travailles longtemps sans t'arrêter, je te le dis.</div>
          </div>
          <Select value={settings.break_after ?? "90"} onChange={(v) => setSetting("break_after", v)} options={BREAK_OPTIONS} />
        </section>
      </div>
    </>
  );
}
