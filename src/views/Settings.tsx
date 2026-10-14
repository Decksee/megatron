import { useEffect, useState } from "react";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { Switch } from "../components/Switch";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion } from "motion/react";
import { clearMemories, deleteMemory, exportBackup, importBackup, setSetting } from "../db";
import { DEFAULT_IDLE_MINUTES } from "../time";
import { THEME_OPTIONS, type ThemePref } from "../theme";
import type { Data } from "../useData";
import { Select } from "../components/Select";
import { holdOpen } from "../hold";
import { ErrorNote } from "../components/ErrorNote";
import { USAGES, usageOf, type Usage } from "../projects";
import {
  AZURE_DEFAULT_VOICE,
  AZURE_REGIONS,
  AZURE_SLOT,
  azureRegion,
  loadAzureVoices,
  ONLINE_VOICES,
  onlineBlockedUntil,
  onlineProvider,
  PITCH_OPTIONS,
  RATE_OPTIONS,
  SPEAK_OPTIONS,
  speak,
  speechError,
  speechPrefs,
  STYLE_OPTIONS,
  useAzureVoices,
  useVoices,
  type SpeakEngine,
} from "../ai/speech";

type Status = { kind: "ok" | "error"; text: string } | null;

const FILTERS = [{ name: "Sauvegarde Mégatron", extensions: ["json"] }];

const IDLE_OPTIONS = [
  { value: "0", label: "Jamais" },
  { value: "3", label: "3 min" },
  { value: "5", label: "5 min" },
  { value: "10", label: "10 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
];

function Setting({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="setting">
      <div>
        <div className="setting-title">{title}</div>
        <div className="muted small">{hint}</div>
      </div>
      {children}
    </section>
  );
}

function AutostartSetting() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    autostartEnabled().then(setOn).catch(() => setOn(null));
  }, []);
  return (
    <Setting title="Lancer au démarrage de Windows" hint="L'encoche est là dès que tu allumes ton PC.">
      <Switch
        label="Lancer au démarrage de Windows"
        checked={!!on}
        disabled={on == null}
        onChange={async (next) => {
          setOn(next);
          try {
            await (next ? enableAutostart() : disableAutostart());
          } catch {
            setOn(!next);
          }
        }}
      />
    </Setting>
  );
}

export function GeneralSettings({ settings }: Pick<Data, "settings">) {
  const theme = (settings.theme as ThemePref) || "system";
  return (
    <div className="settings">
      <Setting title="Tes projets" hint={`${USAGES[usageOf(settings)].hint} Changer ne supprime rien : seul l'affichage s'adapte.`}>
        <div className="segmented">
          {(Object.keys(USAGES) as Usage[]).map((u) => (
            <button key={u} className={u === usageOf(settings) ? "seg active" : "seg"} onClick={() => setSetting("usage", u)}>
              {u === usageOf(settings) && <motion.span layoutId="usage-pill" className="seg-pill" />}
              <span className="tab-label">{USAGES[u].label}</span>
            </button>
          ))}
        </div>
      </Setting>
      <AutostartSetting />
      <Setting
        title="Ranger l'encoche en fine barre"
        hint="Pour ne pas cacher tes onglets : « Automatique » la range quand une fenêtre est derrière elle. Passe la souris dessus pour l'ouvrir."
      >
        <Select
          value={settings.notch_mini === "0" ? "never" : settings.notch_mini === "1" ? "always" : (settings.notch_mini ?? "auto")}
          onChange={(v) => setSetting("notch_mini", v)}
          options={[
            { value: "auto", label: "Automatique" },
            { value: "always", label: "Toujours au repos" },
            { value: "never", label: "Jamais" },
          ]}
          ariaLabel="Ranger l'encoche"
        />
      </Setting>
      <Setting title="Thème" hint="« Système » suit le mode clair ou sombre de Windows.">
        <div className="segmented">
          {THEME_OPTIONS.map((o) => (
            <button key={o.value} className={o.value === theme ? "seg active" : "seg"} onClick={() => setSetting("theme", o.value)}>
              {o.value === theme && <motion.span layoutId="theme-pill" className="seg-pill" />}
              <span className="tab-label">{o.label}</span>
            </button>
          ))}
        </div>
      </Setting>
      <Setting title="Pause automatique des minuteurs" hint="Met en pause si tu ne touches plus au PC (le temps d'absence n'est pas compté).">
        <Select
          value={settings.idle_minutes ?? DEFAULT_IDLE_MINUTES}
          onChange={(v) => setSetting("idle_minutes", v)}
          options={IDLE_OPTIONS}
          ariaLabel="Délai de pause automatique"
        />
      </Setting>
      <Setting title="Raccourci de l'assistant" hint="Partout dans Windows : appui court pour écrire, appui long pour parler.">
        <span className="kbd-group">
          <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Espace</kbd>
        </span>
      </Setting>
    </div>
  );
}

export function DataSettings() {
  const [status, setStatus] = useState<Status>(null);
  const [confirmImport, setConfirmImport] = useState(false);

  const run = (fn: () => Promise<string | null>) =>
    holdOpen(fn)
      .then((text) => text && setStatus({ kind: "ok", text }))
      .catch((e) => setStatus({ kind: "error", text: String(e?.message ?? e) }));

  const doExport = () =>
    run(async () => {
      const day = new Date().toISOString().slice(0, 10);
      const path = await save({ defaultPath: `megatron-${day}.json`, filters: FILTERS });
      if (!path) return null;
      const backup = await exportBackup();
      await invoke("write_text_file", { path, contents: JSON.stringify(backup, null, 2) });
      return `Exporté : ${backup.projects.length} projets, ${backup.tasks.length} tâches, ${backup.time_entries.length} sessions.`;
    });

  const doImport = () =>
    run(async () => {
      setConfirmImport(false);
      const path = await open({ multiple: false, filters: FILTERS });
      if (!path) return null;
      const text = await invoke<string>("read_text_file", { path });
      const res = await importBackup(JSON.parse(text));
      return `Importé : ${res.projects} projets, ${res.tasks} tâches, ${res.entries} sessions.`;
    });

  return (
    <div className="settings">
      <Setting
        title="Exporter mes données"
        hint="Projets, tâches, temps, rappels et réglages dans un fichier JSON (sauvegarde, changement de PC…). Les clés API n'y sont pas."
      >
        <button className="btn primary" onClick={doExport}>
          Exporter
        </button>
      </Setting>
      <Setting title="Importer une sauvegarde" hint="Remplace toutes les données actuelles par celles du fichier.">
        {confirmImport ? (
          <div className="row">
            <button className="btn ghost" onClick={() => setConfirmImport(false)}>
              Annuler
            </button>
            <button className="btn danger" onClick={doImport}>
              Remplacer mes données
            </button>
          </div>
        ) : (
          <button className="btn ghost" onClick={() => setConfirmImport(true)}>
            Importer…
          </button>
        )}
      </Setting>
      {status && <div className={`status ${status.kind}`}>{status.text}</div>}
    </div>
  );
}

/** « Hey Mégatron » : l'état (langue utilisée ou erreur) est écrit par l'encoche qui lance l'écoute. */
export function WakeWordSetting({ settings }: Pick<Data, "settings">) {
  const on = settings.wake_word === "1";
  const status = settings.wake_status ?? "";
  const error = status.startsWith("error:") ? status.slice(6) : null;
  const language = status.startsWith("ok:") ? status.slice(3) : null;
  return (
    <div className="setting-block">
      <Setting
        title="« Hey Mégatron »"
        hint="Dis « Mégatron » pour qu'il t'écoute, sans toucher au clavier. L'écoute se fait sur ton PC, sans rien envoyer tant que le mot n'est pas reconnu."
      >
        <Switch label="Activer « Hey Mégatron »" checked={on} onChange={(next) => setSetting("wake_word", next ? "1" : "0")} />
      </Setting>
      {on && error && <div className="status error">{error}</div>}
      {on && language && <div className="muted small setting-note">À l'écoute · reconnaissance {language}</div>}
    </div>
  );
}

function AzureSetup({ settings, onDone }: Pick<Data, "settings"> & { onDone?: () => void }) {
  const [key, setKey] = useState("");
  const [region, setRegion] = useState(azureRegion(settings) ?? "francecentral");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("ai_set_key", { slot: AZURE_SLOT, key });
      await loadAzureVoices(region); // vérifie la clé et la région
      await setSetting("speak_azure_region", region);
      setKey("");
      onDone?.();
    } catch (e) {
      const raw = String((e as Error)?.message ?? e);
      setError(raw);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setting column azure-setup">
      <div className="setting-title">Connecter Azure (gratuit)</div>
      <ol className="azure-steps muted small">
        <li>
          Sur le portail Azure, crée une ressource <b>Speech</b> avec le niveau tarifaire <b>Free F0</b> (500 000 caractères
          gratuits par mois).{" "}
          <button
            type="button"
            className="link"
            onClick={() => invoke("open_url", { url: "https://portal.azure.com/#create/Microsoft.CognitiveServicesSpeechServices" })}
          >
            Ouvrir le portail
          </button>
        </li>
        <li>
          Une fois créée, ouvre <b>Clés et point de terminaison</b> : copie la <b>Clé 1</b> et regarde
          l'<b>Emplacement / Région</b>.
        </li>
      </ol>
      <form
        className="row azure-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim()) connect();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Clé 1"
          aria-label="Clé Azure"
        />
        <Select value={region} options={AZURE_REGIONS} onChange={setRegion} ariaLabel="Région Azure" />
        <button className="btn primary" type="submit" disabled={!key.trim() || busy}>
          {busy ? "…" : "Connecter"}
        </button>
      </form>
      {error && <ErrorNote raw={error} service="azure" />}
      <span className="muted small">La clé reste dans le Gestionnaire d'identification Windows.</span>
    </div>
  );
}

export function SpeechSetting({ settings }: Pick<Data, "settings">) {
  const voices = useVoices();
  const prefs = speechPrefs(settings);
  const online = onlineProvider(settings);
  const region = azureRegion(settings);
  const azureVoices = useAzureVoices(region);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [changingAzure, setChangingAzure] = useState(false);
  const french = voices.filter((v) => v.lang.toLowerCase().startsWith("fr"));
  const list = french.length ? french : voices;
  const current = list.find((v) => v.name === prefs.voice)?.name ?? list[0]?.name ?? "";
  const onlineList = online ? ONLINE_VOICES[online.provider] : [];
  const onlineVoice = onlineList.find((v) => v.value === prefs.onlineVoice)?.value ?? onlineList[0]?.value ?? "";
  const azureVoice =
    azureVoices.find((v) => v.value === prefs.azureVoice)?.value ??
    azureVoices.find((v) => v.value === AZURE_DEFAULT_VOICE)?.value ??
    azureVoices[0]?.value ??
    AZURE_DEFAULT_VOICE;
  const engine: SpeakEngine = prefs.engine === "online" && !online ? "windows" : prefs.engine;
  const azureReady = engine === "azure" && !!region && !changingAzure;
  const blocked = onlineBlockedUntil(settings, engine);
  const onlineName = online?.provider === "openai" ? "OpenAI" : "Gemini";

  const engines: { value: SpeakEngine; label: string; disabled?: boolean }[] = [
    { value: "windows", label: "Windows" },
    { value: "azure", label: "Azure" },
    { value: "online", label: onlineName, disabled: !online },
  ];
  const hints: Record<SpeakEngine, string> = {
    windows: "Gratuite et illimitée, sur ton PC, mais un peu robotique.",
    azure: "Les voix les plus humaines. Gratuit jusqu'à 500 000 caractères par mois, soit des milliers de réponses.",
    online:
      online?.provider === "openai"
        ? "Voix humaines via ta clé OpenAI, environ 1 centime par minute lue."
        : "Voix humaines via ta clé Gemini, mais le quota gratuit est très bas (une dizaine de réponses).",
  };

  const test = async () => {
    setTesting(true);
    setTestError(null);
    const error = await speak(
      "Salut, c'est Mégatron. Je suis prêt à t'aider.",
      { ...prefs, engine, voice: current, onlineVoice, azureVoice },
      true,
    );
    setTestError(error);
    setTesting(false);
  };

  return (
    <div className="setting-block">
      <Setting title="Sa voix" hint="Mégatron peut lire ses réponses à voix haute.">
        <Select value={prefs.mode} options={SPEAK_OPTIONS} onChange={(v) => setSetting("speak_mode", v)} />
      </Setting>
      {prefs.mode !== "off" && (
        <>
          <Setting title="Type de voix" hint={hints[engine]}>
            <div className="segmented">
              {engines.map((e) => (
                <button
                  key={e.value}
                  className={engine === e.value ? "seg active" : "seg"}
                  disabled={e.disabled}
                  title={e.disabled ? "Connecte une clé Gemini ou OpenAI pour la voix (page IA)." : undefined}
                  onClick={() => {
                    setTestError(null);
                    setSetting("speak_engine", e.value);
                  }}
                >
                  {engine === e.value && <motion.span layoutId="engine-pill" className="seg-pill" />}
                  <span className="tab-label">{e.label}</span>
                </button>
              ))}
            </div>
          </Setting>
          {engine === "azure" && !azureReady ? (
            <AzureSetup settings={settings} onDone={() => setChangingAzure(false)} />
          ) : (
            <Setting
              title="Voix"
              hint={
                engine === "azure"
                  ? `Connecté à Azure · ${AZURE_REGIONS.find((r) => r.value === region)?.label ?? region}`
                  : engine === "online"
                    ? "Chaque voix a son caractère. Elles parlent toutes français."
                    : list.length
                      ? "Les voix « Natural » sont les plus naturelles."
                      : "Aucune voix trouvée : ajoute-en dans Paramètres Windows → Heure et langue → Voix."
              }
            >
              <div className="row">
                {engine === "azure" && (
                  <>
                    <Select value={azureVoice} options={azureVoices} onChange={(v) => setSetting("speak_azure_voice", v)} />
                    <button className="btn ghost" onClick={() => setChangingAzure(true)}>
                      Changer de clé
                    </button>
                  </>
                )}
                {engine === "online" && (
                  <Select value={onlineVoice} options={onlineList} onChange={(v) => setSetting("speak_online_voice", v)} />
                )}
                {engine === "windows" && list.length > 0 && (
                  <Select
                    value={current}
                    options={list.map((v) => ({ value: v.name, label: v.name.replace(/^Microsoft /, "").replace(/ - .*$/, "") }))}
                    onChange={(v) => setSetting("speak_voice", v)}
                  />
                )}
                <button className="btn ghost" onClick={test} disabled={testing}>
                  {testing ? "…" : "Écouter"}
                </button>
              </div>
            </Setting>
          )}
          {engine !== "windows" && (testError || blocked) && (
            <div className="status warn">{testError ?? speechError("", blocked)}</div>
          )}
          {engine === "online" && (
            <Setting title="Ton" hint="La façon dont il parle.">
              <Select value={prefs.style} options={STYLE_OPTIONS} onChange={(v) => setSetting("speak_style", v)} />
            </Setting>
          )}
          <Setting title="Vitesse" hint="La vitesse à laquelle il parle.">
            <Select value={String(prefs.rate)} options={RATE_OPTIONS} onChange={(v) => setSetting("speak_rate", v)} />
          </Setting>
          {engine !== "online" && (
            <Setting title="Hauteur" hint="Plus grave pour un robot imposant, plus aigu pour un petit robot.">
              <Select value={String(prefs.pitch)} options={PITCH_OPTIONS} onChange={(v) => setSetting("speak_pitch", v)} />
            </Setting>
          )}
          <Setting title="Volume" hint="Le volume de sa voix, par rapport à celui de Windows.">
            <input
              type="range"
              className="slider"
              min={0.2}
              max={1}
              step={0.1}
              value={prefs.volume}
              style={{ "--fill": `${((prefs.volume - 0.2) / 0.8) * 100}%`, width: 160 } as React.CSSProperties}
              aria-label="Volume de la voix"
              onChange={(e) => setSetting("speak_volume", e.target.value)}
            />
          </Setting>
        </>
      )}
    </div>
  );
}

/** Apprentissage : ce que Mégatron a retenu sur toi, consultable et effaçable. */
export function MemorySetting({ settings, memories }: Pick<Data, "settings" | "memories">) {
  const on = settings.ai_memory !== "0";
  const [confirmClear, setConfirmClear] = useState(false);
  return (
    <div className="setting-block">
      <Setting
        title="Apprentissage"
        hint="Mégatron retient ce que tu lui apprends sur toi (préférences, clients, façon de travailler) pour mieux t'aider. Tout reste sur ton PC ; seules ces notes accompagnent tes demandes à l'IA."
      >
        <Switch label="Activer l'apprentissage" checked={on} onChange={(next) => setSetting("ai_memory", next ? "1" : "0")} />
      </Setting>
      {on && (
        <section className="setting column memory-list">
          <div className="memory-head">
            <span className="setting-title">Ce qu'il sait de toi</span>
            {memories.length > 0 &&
              (confirmClear ? (
                <button
                  className="btn danger"
                  onClick={() => {
                    clearMemories();
                    setConfirmClear(false);
                  }}
                >
                  Tout oublier ?
                </button>
              ) : (
                <button className="btn ghost" onClick={() => setConfirmClear(true)}>
                  Tout oublier
                </button>
              ))}
          </div>
          {memories.length === 0 ? (
            <span className="muted small">
              Rien pour l'instant. Parle-lui de toi (« je facture 450 € la journée », « je préfère les réponses courtes »…) ou dis-lui
              « retiens que… ».
            </span>
          ) : (
            <ul className="memories">
              {memories.map((m) => (
                <li key={m.id} className="memory">
                  <span>{m.text}</span>
                  <button className="icon-btn" onClick={() => deleteMemory(m.id)} aria-label="Oublier">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
