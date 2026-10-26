import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlarmClock, ArrowRight, Bell, Bot as BotIcon, Briefcase, Check, GraduationCap, LayoutGrid, ListChecks, Mic, ShieldCheck, Sparkles, Target } from "lucide-react";
import { setSetting } from "../db";
import { Bot } from "../components/Bot";
import { USAGES, type Usage } from "../projects";
import type { Mood } from "../mood";
import type { Data } from "../useData";
import { BackgroundSteps, useBackgroundStatus } from "./MobileGuide";
import { useBack } from "./useBack";
import { MemoryAdd, NamesSetting } from "../views/Settings";

const isTauri = "__TAURI_INTERNALS__" in window;
const USAGE_ICON: Record<Usage, typeof Briefcase> = { freelance: Briefcase, studies: GraduationCap, personal: Sparkles };
const STEPS = 6;

/** Doit-on présenter l'appli ? (premier lancement ; `?onboarding` pour la revoir dans l'aperçu) */
export const needsOnboarding = (settings: Data["settings"]) =>
  new URLSearchParams(location.search).has("onboarding") || (isTauri && settings.m_onboarded !== "1");

function Feature({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="m-ob-feature">
      <span className="m-ob-feature-icon">{icon}</span>
      <span>
        <b>{title}</b>
        <span className="muted">{text}</span>
      </span>
    </div>
  );
}

/**
 * Présentation au premier lancement : bienvenue, profil, ce que fait l'appli, réglages Android.
 * Plein écran, on avance d'un geste (glisser) ou avec « Suivant » ; « Passer » à tout moment.
 */
export function MobileOnboarding({ settings, onDone }: { settings: Data["settings"]; onDone: () => void }) {
  // Reprise à l'écran atteint : des téléphones (Tecno, Xiaomi…) ferment l'appli pendant qu'on est dans les réglages d'Android.
  const [step, setStep] = useState(() => Math.min(STEPS - 1, Math.max(0, Number(settings.m_ob_step) || 0)));
  const [dir, setDir] = useState(1);
  const [usage, setUsage] = useState<Usage | null>((settings.usage as Usage) || null);
  const status = useBackgroundStatus();
  // Retour d'Android : écran précédent (sur le premier, il ne fait rien de plus).
  useBack(step > 0, () => go(step - 1), step);

  useEffect(() => {
    if (settings.usage) setUsage(settings.usage as Usage);
  }, [settings.usage]);

  const go = (next: number) => {
    if (next < 0 || next >= STEPS) return;
    setDir(next > step ? 1 : -1);
    setStep(next);
    void setSetting("m_ob_step", String(next)).catch(console.error);
  };
  const finish = async () => {
    await Promise.all([setSetting("m_onboarded", "1"), setSetting("m_guide_seen", "1")]).catch(console.error);
    onDone();
  };
  const choose = (u: Usage) => {
    setUsage(u);
    void setSetting("usage", u).catch(console.error);
    window.setTimeout(() => go(2), 280);
  };

  const mood: Mood = step === 0 ? "happy" : step === 4 ? "focus" : step === 5 ? "think" : "happy";

  const screens = [
    <div className="m-ob-screen m-ob-hello" key="hello">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 220, damping: 16, delay: 0.1 }}>
        <Bot mood="happy" size={120} />
      </motion.div>
      <h1>Salut, moi c'est Mégatron</h1>
      <p className="muted">Ton assistant de productivité, dans ta poche : tes tâches, ton temps, ta concentration, sans rien oublier.</p>
    </div>,

    <div className="m-ob-screen" key="usage">
      <h2>Tu l'utilises surtout pour…</h2>
      <p className="muted">Mégatron adapte ses écrans (prix et paiements, matières, projets perso).</p>
      <div className="m-ob-usages">
        {(Object.keys(USAGES) as Usage[]).map((u) => {
          const Icon = USAGE_ICON[u];
          return (
            <motion.button key={u} className={usage === u ? "m-ob-usage active" : "m-ob-usage"} whileTap={{ scale: 0.97 }} onClick={() => choose(u)}>
              <span className="m-ob-usage-icon">
                <Icon size={22} />
              </span>
              <span>
                <b>{USAGES[u].label}</b>
                <span className="muted">{USAGES[u].hint}</span>
              </span>
              {usage === u && <Check size={20} strokeWidth={3} className="m-ob-check" />}
            </motion.button>
          );
        })}
      </div>
    </div>,

    <div className="m-ob-screen" key="you">
      <h2>Et toi, comment je t'appelle ?</h2>
      <p className="muted">Pour te dire bonjour à ma façon. Facultatif, ça se change dans Réglages → Toi.</p>
      <div className="settings">
        <NamesSetting settings={settings} />
        <section className="setting column">
          <div>
            <div className="setting-title">Parle-moi un peu de toi</div>
            <div className="muted small">Ton métier, ta façon de travailler : je m'en souviendrai.</div>
          </div>
          <MemoryAdd placeholder="Ex. Je suis étudiant en design" />
        </section>
      </div>
    </div>,

    <div className="m-ob-screen" key="tasks">
      <h2>Ta journée, sous contrôle</h2>
      <Feature icon={<ListChecks size={20} />} title="Aujourd'hui" text="Tes tâches du jour et tes retards, cochées d'un toucher." />
      <Feature icon={<Bell size={20} />} title="Tâche en cours" text="Toujours dans tes notifications, avec Fait et Replanifier." />
      <Feature icon={<AlarmClock size={20} />} title="Rappels" text="À la minute près, même appli fermée. Point du matin à 8 h." />
      <Feature icon={<LayoutGrid size={20} />} title="Widgets" text="Aujourd'hui, Focus et Prochain rappel sur ton écran d'accueil." />
    </div>,

    <div className="m-ob-screen" key="focus">
      <h2>Concentre-toi vraiment</h2>
      <Feature icon={<Target size={20} />} title="Focus" text="La durée que tu veux, avec compte à rebours dans les notifications." />
      <Feature icon={<ShieldCheck size={20} />} title="Applis bloquées" text="Pendant un focus, les applis que tu choisis restent fermées." />
      <Feature icon={<BotIcon size={20} />} title="Assistant IA" text="« Ajoute relancer Paul », « rappelle-moi demain à 9 h »…" />
      <Feature icon={<Mic size={20} />} title="À la voix" text="Touche le micro et parle, il s'occupe du reste." />
    </div>,

    <div className="m-ob-screen" key="android">
      <h2>Dernière chose</h2>
      <p className="muted">Trois réglages Android, une seule fois, pour que tout marche même appli fermée.</p>
      <BackgroundSteps status={status} settings={settings} />
    </div>,
  ];

  const last = step === STEPS - 1;
  return (
    <motion.div className="m-ob" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <div className="m-ob-top">
        <span className="m-ob-bot">{step > 0 && <Bot mood={mood} size={30} bare />}</span>
        {!last && (
          <button className="m-ob-skip" onClick={finish}>
            Passer
          </button>
        )}
      </div>

      <div className="m-ob-stage">
        <AnimatePresence mode="popLayout" initial={false} custom={dir}>
          <motion.div
            key={step}
            className="m-ob-slide"
            custom={dir}
            variants={{
              enter: (d: number) => ({ x: d * 60, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d * -60, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.25}
            onDragEnd={(_, info) => {
              if (info.offset.x < -70 || info.velocity.x < -500) go(step + 1);
              else if (info.offset.x > 70 || info.velocity.x > 500) go(step - 1);
            }}
          >
            {screens[step]}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="m-ob-bottom">
        <div className="m-ob-dots">
          {Array.from({ length: STEPS }, (_, i) => (
            <motion.span key={i} className={i === step ? "m-ob-dot on" : "m-ob-dot"} layout transition={{ type: "spring", stiffness: 500, damping: 34 }} />
          ))}
        </div>
        <motion.button className="m-start m-ob-next" whileTap={{ scale: 0.97 }} onClick={() => (last ? finish() : go(step + 1))} disabled={step === 1 && !usage}>
          {last ? "C'est parti 🚀" : step === 0 ? "Découvrir" : "Suivant"}
          {!last && <ArrowRight size={20} strokeWidth={2.4} />}
        </motion.button>
      </div>
    </motion.div>
  );
}
