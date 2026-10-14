import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bot as Bot2, Database, FolderKanban, Info, ListChecks, Minus, Settings2, Sparkles, Target, X } from "lucide-react";
import { useData } from "./useData";
import { useTheme } from "./theme";
import { setSetting, type FocusMode } from "./db";
import { aiConfig } from "./ai/session";
import { PROVIDERS } from "./ai/providers";
import { FOCUS_BUDGETS, FOCUS_DURATIONS } from "./focus";
import { Bot } from "./components/Bot";
import { Blocklist } from "./components/Blocklist";
import { Select } from "./components/Select";
import { AiSetup, Assistant } from "./views/Assistant";
import { Tasks } from "./views/Tasks";
import { Projects } from "./views/Projects";
import { useSpeechPrefs } from "./ai/speech";
import { DataSettings, GeneralSettings, MemorySetting, SpeechSetting, WakeWordSetting } from "./views/Settings";
import type { Data } from "./useData";

/** Sous-parties de « Réglages ». */
const SETTINGS = [
  { id: "general", label: "Général", icon: Settings2, hint: "Apparence, démarrage et comportement de l'encoche." },
  { id: "ia", label: "IA", icon: Sparkles, hint: "Ton assistant, ta clé, sa voix et la commande vocale." },
  { id: "focus", label: "Focus", icon: Target, hint: "Tes réglages de concentration par défaut et ce qui te distrait." },
  { id: "data", label: "Données", icon: Database, hint: "Sauvegarde et restauration de tout ce que contient Mégatron." },
  { id: "about", label: "À propos", icon: Info, hint: "Raccourcis et confidentialité." },
] as const;
type SettingsId = (typeof SETTINGS)[number]["id"];

const PAGES = [
  { id: "tasks", label: "Tâches", icon: ListChecks },
  { id: "projects", label: "Projets", icon: FolderKanban },
  { id: "assistant", label: "IA", icon: Bot2 },
  { id: "settings", label: "Réglages", icon: Settings2 },
] as const;
type PageId = (typeof PAGES)[number]["id"];

const isPage = (s: string | null): s is PageId => PAGES.some((x) => x.id === s);
const isSettings = (s: string | null): s is SettingsId => SETTINGS.some((x) => x.id === s);

/** « tasks », « settings », ou une sous-partie des réglages (« ia »…). */
function resolve(target: string | null): { page: PageId; sub?: SettingsId } | null {
  if (isPage(target)) return { page: target };
  if (isSettings(target)) return { page: "settings", sub: target };
  return null;
}

const pageMotion = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6, transition: { duration: 0.1 } },
  transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
} as const;

/** La fenêtre « classique » de Mégatron : tâches, projets, IA et réglages, hors de l'encoche. */
export function SettingsApp() {
  const data = useData();
  useTheme(data.settings);
  useSpeechPrefs(data.settings);
  const initial = resolve(new URLSearchParams(location.search).get("section"));
  const [page, setPage] = useState<PageId>(initial?.page ?? "tasks");
  const [sub, setSub] = useState<SettingsId>(initial?.sub ?? "general");

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const unlisten = listen<string>("settings-section", (e) => {
      const r = resolve(e.payload);
      if (!r) return;
      setPage(r.page);
      if (r.sub) setSub(r.sub);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const current = SETTINGS.find((s) => s.id === sub)!;

  return (
    <div className="settings-shell">
      <header className="window-bar" data-tauri-drag-region>
        <div className="window-brand" data-tauri-drag-region>
          <Bot mood="idle" size={20} />
          <span data-tauri-drag-region>Mégatron</span>
        </div>
        <div className="window-buttons">
          <button className="icon-round" onClick={() => getCurrentWindow().minimize()} aria-label="Réduire">
            <Minus size={14} />
          </button>
          <button className="icon-round close" onClick={() => getCurrentWindow().close()} aria-label="Fermer">
            <X size={14} />
          </button>
        </div>
      </header>

      <main className={page === "settings" ? "window-content" : "window-content wide"}>
        <AnimatePresence mode="wait">
          {page === "settings" ? (
            <motion.div key="settings" className="window-section" {...pageMotion}>
              <div className="segmented settings-tabs">
                {SETTINGS.map((s) => (
                  <button key={s.id} className={s.id === sub ? "seg active" : "seg"} onClick={() => setSub(s.id)}>
                    {s.id === sub && (
                      <motion.span
                        layoutId="settings-pill"
                        className="seg-pill"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <span className="tab-label">{s.label}</span>
                  </button>
                ))}
              </div>
              {/* Seul le contenu change : la barre d'onglets reste en place et la pastille glisse. */}
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={sub}
                  className="settings-panel"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.08 } }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  <header className="window-head">
                    <span className="window-head-icon">
                      <current.icon size={18} />
                    </span>
                    <div>
                      <h1 className="window-title">{current.label}</h1>
                      <p className="muted small">{current.hint}</p>
                    </div>
                  </header>
                  {sub === "general" && <GeneralSettings settings={data.settings} />}
                  {sub === "ia" && <AiSection settings={data.settings} memories={data.memories} />}
                  {sub === "focus" && <FocusSection {...data} />}
                  {sub === "data" && <DataSettings />}
                  {sub === "about" && <About />}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          ) : (
            <motion.div key={page} className={`window-page page-${page}`} {...pageMotion}>
              {page === "tasks" && <Tasks {...data} />}
              {page === "projects" && <Projects {...data} />}
              {page === "assistant" && <Assistant {...data} />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <nav className="dock" aria-label="Sections">
        {PAGES.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={id === page ? "dock-item active" : "dock-item"}
            onClick={() => setPage(id)}
            aria-current={id === page ? "page" : undefined}
            aria-label={label}
          >
            {id === page && <motion.span layoutId="dock-pill" className="dock-pill" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
            <Icon size={16} />
            <AnimatePresence initial={false}>
              {id === page && (
                <motion.span
                  className="dock-label"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: "auto" }}
                  exit={{ opacity: 0, width: 0 }}
                >
                  {label}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        ))}
      </nav>
    </div>
  );
}

function AiSection({ settings, memories }: Pick<Data, "settings" | "memories">) {
  const config = aiConfig(settings);
  const [editing, setEditing] = useState(false);
  if (!config || editing) return <AiSetup settings={settings} onDone={() => setEditing(false)} canCancel={!!config} />;
  return (
    <div className="settings">
      <WakeWordSetting settings={settings} />
      <SpeechSetting settings={settings} />
      <MemorySetting settings={settings} memories={memories} />
      <section className="setting">
        <div>
          <div className="setting-title">Connecté à {PROVIDERS[config.provider].label}</div>
          <div className="muted small">Modèle : {config.model}. Tu peux en changer depuis la page IA.</div>
        </div>
        <button className="btn ghost" onClick={() => setEditing(true)}>
          Changer de fournisseur ou de clé
        </button>
      </section>
    </div>
  );
}

function FocusSection({ settings }: Data) {
  const mode = (settings.focus_mode as FocusMode) || "alert";
  return (
    <div className="settings">
      <section className="setting">
        <div>
          <div className="setting-title">Durée par défaut</div>
          <div className="muted small">Proposée quand tu lances un focus.</div>
        </div>
        <Select
          value={settings.focus_duration ?? "50"}
          onChange={(v) => setSetting("focus_duration", v)}
          options={FOCUS_DURATIONS.map((m) => ({ value: String(m), label: `${m} min` }))}
        />
      </section>
      <section className="setting">
        <div>
          <div className="setting-title">Temps de distraction autorisé</div>
          <div className="muted small">Au-delà, Mégatron t'alerte ou bloque.</div>
        </div>
        <Select
          value={settings.focus_budget ?? "5"}
          onChange={(v) => setSetting("focus_budget", v)}
          options={FOCUS_BUDGETS.map((m) => ({ value: String(m), label: `${m} min` }))}
        />
      </section>
      <section className="setting">
        <div>
          <div className="setting-title">Une fois le budget dépassé</div>
          <div className="muted small">« Bloquer » réduit la fenêtre qui te distrait.</div>
        </div>
        <Select<FocusMode>
          value={mode}
          onChange={(v) => setSetting("focus_mode", v)}
          options={[
            { value: "alert", label: "M'alerter" },
            { value: "block", label: "Bloquer" },
          ]}
        />
      </section>
      <section className="setting column">
        <Blocklist settings={settings} />
      </section>
    </div>
  );
}

function About() {
  return (
    <div className="settings about">
      <div className="about-hero">
        <Bot mood="focus" size={52} />
        <div>
          <div className="about-name">Mégatron</div>
          <div className="muted small">Version 0.1 · ton encoche de productivité</div>
        </div>
      </div>
      <section className="setting column">
        <div className="setting-title">Raccourcis</div>
        <div className="shortcut-list">
          <span>
            <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Espace</kbd>
          </span>
          <span className="muted small">appui court : écrire à l'IA · appui long : lui parler</span>
        </div>
      </section>
      <section className="setting column">
        <div className="setting-title">Tes données</div>
        <span className="muted small">
          Tout reste sur ce PC (base locale). Les clés API sont dans le Gestionnaire d'identification Windows. Seules
          tes demandes à l'IA partent vers le fournisseur que tu as choisi.
        </span>
      </section>
    </div>
  );
}
