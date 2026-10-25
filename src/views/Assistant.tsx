import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { setSetting } from "../db";
import { Select } from "../components/Select";
import { EmptyState } from "../components/EmptyState";
import { Bot } from "../components/Bot";
import { ErrorNote } from "../components/ErrorNote";
import {
  Smartphone,
  FileCode,
  FileText,
  FileUp,
  Image as ImageIcon,
  Paperclip,
  X,
  AudioLines,
  AppWindow,
  Bell,
  ChevronLeft,
  Clock3,
  ExternalLink,
  ListChecks,
  Lock,
  MessageSquareText,
  Music2,
  RotateCcw,
  Server,
  Settings2,
  Sparkles,
  Square,
  Zap,
} from "lucide-react";
import { geminiFreeCandidates, PROVIDERS, sortByCost, type ProviderId } from "../ai/providers";
import {
  aiConfig,
  ask,
  cancelRequest,
  cancelTalking,
  addFiles,
  endConversation,
  removePendingFile,
  MAIN_SLOT,
  startConversation,
  resetConversation,
  startTalking,
  stopTalking,
  useAi,
  voiceConfig,
  VOICE_SLOT,
  type UiMessage,
} from "../ai/session";
import type { Data } from "../useData";
import { formatSize, pickPaths, type Attachment } from "../ai/attachments";
import { holdOpen } from "../hold";
import { isMobileApp } from "../mobile/native";

const PROVIDER_ICON = { gemini: Sparkles, anthropic: MessageSquareText, openai: Zap, compatible: Server } as const;
const PROVIDER_TAGLINE: Record<ProviderId, string> = {
  gemini: "Clé gratuite, sans carte",
  anthropic: "Facturé à l'usage",
  openai: "Facturé à l'usage",
  compatible: "OpenRouter, Groq, Ollama…",
};

const SKILLS = [
  { icon: ListChecks, label: "Tâches et projets", example: "ajoute relancer Paul" },
  { icon: Clock3, label: "Temps et focus", example: "lance 50 min de focus" },
  { icon: Bell, label: "Rappels", example: "rappelle-moi demain à 9 h" },
  { icon: AppWindow, label: "Apps et sites", example: "ouvre Spotify" },
  { icon: Music2, label: "Musique et son", example: "piste suivante" },
  { icon: Sparkles, label: "Tes stats", example: "combien j'ai bossé ?" },
];

/** Sur téléphone, pas d'applis ni de musique à piloter. */
const PHONE_SKILLS = SKILLS.filter((s) => s.icon !== Music2).map((s) =>
  s.icon === AppWindow ? { ...s, label: "Sites et recherches", example: "cherche une pizzeria" } : s,
);

const SUGGESTIONS = [
  "Ajoute « relancer le client » à mes tâches",
  "Combien j'ai bossé cette semaine ?",
  "Lance 50 min de focus",
  "Rappelle-moi d'appeler Paul demain à 10 h",
  "Ouvre Spotify",
  "Cherche un tuto Figma sur YouTube",
];

const errorText = (e: unknown) => String((e as Error)?.message ?? e);

export async function fetchModels(provider: ProviderId, slot: string, baseUrl: string | null) {
  const all = await invoke<string[]>("ai_list_models", { provider, slot, baseUrl });
  // Du moins cher au plus cher : le premier de la liste est aussi celui choisi par défaut.
  return sortByCost(provider, all.filter(PROVIDERS[provider].filter));
}

export function Assistant({ settings }: Data) {
  const config = aiConfig(settings);
  const [editing, setEditing] = useState(false);
  if (!config || editing) return <AiSetup settings={settings} onDone={() => setEditing(false)} canCancel={!!config} />;
  return <Chat settings={settings} onSettings={() => setEditing(true)} />;
}

// ---------- Configuration ----------

export function AiSetup({ settings, onDone, canCancel }: Pick<Data, "settings"> & { onDone: () => void; canCancel: boolean }) {
  const [provider, setProvider] = useState<ProviderId>((settings.ai_provider as ProviderId) || "gemini");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(settings.ai_base_url ?? "");
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error" | "busy"; text: string } | null>(null);
  const info = PROVIDERS[provider];

  useEffect(() => {
    invoke<boolean>("ai_has_key", { slot: MAIN_SLOT }).then(setHasKey).catch(() => setHasKey(false));
  }, []);

  const connect = async () => {
    setStatus({ kind: "busy", text: "Connexion…" });
    try {
      if (key.trim()) await invoke("ai_set_key", { slot: MAIN_SLOT, key });
      const url = provider === "compatible" ? baseUrl.trim() || null : null;
      if (provider === "compatible" && !url) throw new Error("Indique l'adresse du serveur (ex. https://openrouter.ai/api/v1).");
      const models = await fetchModels(provider, MAIN_SLOT, url);
      const model = info.pickDefault(models);
      if (!model) throw new Error("Aucun modèle disponible avec cette clé.");
      await Promise.all([
        setSetting("ai_provider", provider),
        setSetting("ai_model", model),
        setSetting("ai_base_url", url ?? ""),
      ]);
      resetConversation();
      setKey("");
      setHasKey(true);
      onDone();
    } catch (e) {
      setStatus({ kind: "error", text: errorText(e) });
    }
  };

  return (
    <div className="view ai-setup">
      {/* Téléphone : le retour à la conversation est tout en haut, à portée de vue. */}
      {canCancel && isMobileApp() && (
        <button type="button" className="m-setup-back" onClick={onDone}>
          <ChevronLeft size={18} /> Retour à la conversation
        </button>
      )}
      <div className="provider-cards" role="radiogroup" aria-label="Fournisseur d'IA">
        {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => {
          const Icon = PROVIDER_ICON[id];
          return (
            <button
              key={id}
              role="radio"
              aria-checked={id === provider}
              className={id === provider ? "provider-card active" : "provider-card"}
              onClick={() => {
                setProvider(id);
                setStatus(null);
              }}
            >
              <span className="provider-icon">
                <Icon size={16} />
              </span>
              <span className="provider-name">
                {PROVIDERS[id].label}
                {id === "gemini" && <span className="free">gratuit</span>}
              </span>
              <span className="tile-caption">{PROVIDER_TAGLINE[id]}</span>
            </button>
          );
        })}
      </div>

      <div className="setup-steps">
        <div className="tile setup-step">
          <span className="step-num">1</span>
          <span className="step-title">{provider === "compatible" ? "Ton serveur" : "Obtiens ta clé"}</span>
          {provider === "compatible" ? (
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://openrouter.ai/api/v1"
              aria-label="Adresse du serveur"
            />
          ) : (
            <>
              <span className="tile-caption">{info.hint}</span>
              {info.keyUrl && (
                <button className="btn ghost" onClick={() => invoke("open_url", { url: info.keyUrl })}>
                  Ouvrir le site <ExternalLink size={12} />
                </button>
              )}
            </>
          )}
        </div>
        <form
          className="tile setup-step"
          onSubmit={(e) => {
            e.preventDefault();
            connect();
          }}
        >
          <span className="step-num">2</span>
          <span className="step-title">Colle-la ici</span>
          <input
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={hasKey ? "•••••••• (déjà enregistrée)" : info.keyPlaceholder}
            aria-label="Clé API"
          />
          <button className="btn primary" type="submit" disabled={status?.kind === "busy"}>
            {status?.kind === "busy" ? "Connexion…" : "Connecter"}
          </button>
        </form>
        <div className="tile setup-step">
          <span className="step-num">3</span>
          <span className="step-title">Parle-lui</span>
          {isMobileApp() ? (
            <span className="tile-caption">Écris-lui dans l'onglet IA, ou touche le micro pour lui parler.</span>
          ) : (
            <>
              <span className="tile-caption">Écris dans cet onglet, ou maintiens</span>
              <span className="kbd-group">
                <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Espace</kbd>
              </span>
              <span className="tile-caption">pour lui parler de n'importe où.</span>
            </>
          )}
        </div>
      </div>

      {status?.kind === "error" && <ErrorNote raw={status.text} service={provider} />}
      {status?.kind === "ok" && <div className="status ok">{status.text}</div>}

      <div className="tile skills">
        <span className="tile-title">Ce que je sais faire</span>
        <div className="skills-grid">
          {(isMobileApp() ? PHONE_SKILLS : SKILLS).map(({ icon: Icon, label, example }) => (
            <div key={label} className="skill">
              <Icon size={15} />
              <div>
                <div className="skill-label">{label}</div>
                <div className="tile-caption">{`« ${example} »`}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {!info.voice && <VoiceSetup settings={settings} />}

      <div className="setup-foot">
        <span className="muted small with-icon">
          <Lock size={11} />{" "}
          {isMobileApp() ? "Clé gardée sur ce téléphone, jamais exportée." : "Clé gardée dans le Gestionnaire d'identification Windows, jamais exportée."}
        </span>
        {canCancel && !isMobileApp() && (
          <button className="btn ghost" onClick={onDone}>
            <ChevronLeft size={14} /> Retour à la conversation
          </button>
        )}
      </div>
    </div>
  );
}

/** Claude et les serveurs compatibles ne transcrivent pas la voix : clé Gemini ou OpenAI optionnelle. */
function VoiceSetup({ settings }: Pick<Data, "settings">) {
  const [provider, setProvider] = useState<"gemini" | "openai">((settings.voice_provider as "gemini" | "openai") || "gemini");
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const enabled = !!settings.voice_provider;

  const save = async () => {
    try {
      await invoke("ai_set_key", { slot: VOICE_SLOT, key });
      if (provider === "gemini") {
        const models = await fetchModels("gemini", VOICE_SLOT, null);
        const model = PROVIDERS.gemini.pickDefault(models);
        if (!model) throw new Error("Aucun modèle Gemini disponible avec cette clé.");
        await setSetting("voice_model", model);
      }
      await setSetting("voice_provider", provider);
      setKey("");
      setStatus({ kind: "ok", text: "Voix activée." });
    } catch (e) {
      setStatus({ kind: "error", text: errorText(e) });
    }
  };

  return (
    <div className="field voice-setup">
      <span className="field-label">Voix (optionnel) {enabled && <span className="free">activée</span>}</span>
      <span className="muted small">Pour parler à l'assistant, il faut une clé Gemini (gratuite) ou OpenAI pour la transcription.</span>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Select<"gemini" | "openai">
          small
          value={provider}
          onChange={setProvider}
          options={[
            { value: "gemini", label: "Gemini" },
            { value: "openai", label: "OpenAI" },
          ]}
        />
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Clé pour la voix" />
        <button className="btn ghost" type="submit" disabled={!key.trim()}>
          Activer
        </button>
      </form>
      {/* Où obtenir la clé du fournisseur choisi pour la voix. */}
      <div className="voice-key-help">
        <span className="muted small">{PROVIDERS[provider].hint}</span>
        {PROVIDERS[provider].keyUrl && (
          <button type="button" className="btn ghost" onClick={() => invoke("open_url", { url: PROVIDERS[provider].keyUrl })}>
            Obtenir une clé {PROVIDERS[provider].label} <ExternalLink size={12} />
          </button>
        )}
      </div>
      {status?.kind === "error" && <ErrorNote raw={status.text} service={provider} />}
      {status?.kind === "ok" && <div className="status ok">{status.text}</div>}
    </div>
  );
}

// ---------- Conversation ----------

function Chat({ settings, onSettings }: Pick<Data, "settings"> & { onSettings: () => void }) {
  const config = aiConfig(settings)!;
  const voice = voiceConfig(settings);
  const ai = useAi();
  const [text, setText] = useState("");
  const [models, setModels] = useState<string[]>([config.model]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    fetchModels(config.provider, MAIN_SLOT, config.baseUrl)
      .then((m) => {
        setModels(m.includes(config.model) ? m : [config.model, ...m]);
        // Gemini : un modèle « spécial » (omni, live, preview…) souvent sans quota gratuit → Flash classique.
        if (config.provider === "gemini") {
          const free = geminiFreeCandidates(m);
          if (free.length && !free.includes(config.model)) setSetting("ai_model", free[0]);
        }
      })
      .catch(() => {});
  }, [config.provider, config.baseUrl]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [ai.focusRequest]);

  // À l'ouverture, on arrive directement en bas (sans défilement visible) ; ensuite, chaque nouveau
  // message défile en douceur (y compris quand une bulle se remplit).
  // Dans la fenêtre, la conversation arrive de la base juste après l'affichage : tout ce qui change
  // pendant l'ouverture (ou le passage d'une liste vide à pleine) est un saut direct, pas un défilement.
  const mountedAt = useRef(performance.now());
  const shown = useRef(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const opening = performance.now() - mountedAt.current < 800 || (shown.current === 0 && ai.messages.length > 1);
    shown.current = ai.messages.length;
    if (opening) {
      list.scrollTop = list.scrollHeight;
      // Les bulles finissent de se placer juste après l'affichage : on recolle en bas.
      requestAnimationFrame(() => (list.scrollTop = list.scrollHeight));
      return;
    }
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [ai.messages, ai.busy, ai.recording, ai.transcribing]);

  // Pendant l'ouverture, les bulles qui grandissent (animation d'entrée, images) gardent la liste collée en bas.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const stick = new ResizeObserver(() => {
      if (performance.now() - mountedAt.current < 1200) list.scrollTop = list.scrollHeight;
    });
    for (const child of Array.from(list.children)) stick.observe(child);
    stick.observe(list);
    const stop = window.setTimeout(() => stick.disconnect(), 1300);
    return () => {
      window.clearTimeout(stop);
      stick.disconnect();
    };
  }, [ai.messages.length]);

  const send = (value = text) => {
    if (!value.trim() && !ai.pendingFiles.length) return;
    setText("");
    ask(value.trim() || "Regarde ce fichier.", config);
  };

  const attach = async () => {
    try {
      await addFiles(await holdOpen(pickPaths));
    } catch (e) {
      console.error(e);
    }
  };

  const toggleMic = () => {
    if (!voice) return;
    if (ai.conversing) {
      endConversation();
      return;
    }
    // Bouton micro = dictée : la réponse s'affiche sans être lue (la conversation vocale, elle, parle).
    if (ai.recording) stopTalking(config, voice, { speak: false });
    else startTalking(() => stopTalking(config, voice, { speak: false }));
  };

  return (
    <div className="view chat">
      <AnimatePresence>
        {ai.dragging && (
          <motion.div className="chat-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <FileUp size={26} />
            <b>Dépose tes fichiers ici</b>
            <span className="muted small">Images, PDF, Word, Excel, texte ou code · 20 Mo max</span>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="view-head">
        <div className="row">
          <span className="muted small">{PROVIDERS[config.provider].label}</span>
          <Select
            small
            value={config.model}
            onChange={(m) => setSetting("ai_model", m)}
            options={models.map((m) => ({ value: m, label: m }))}
            ariaLabel="Modèle"
          />
        </div>
        <div className="row">
          {ai.messages.length > 0 && (
            <button className="btn ghost icon" onClick={resetConversation} disabled={ai.busy}>
              <RotateCcw size={12} /> Nouvelle conversation
            </button>
          )}
          <button className="btn ghost icon" onClick={onSettings} title="Réglages de l'IA">
            <Settings2 size={14} />
          </button>
        </div>
      </div>

      <ul className="messages" ref={listRef}>
        {ai.messages.length === 0 && (
          <li className="chat-empty">
            <EmptyState
              mood="happy"
              title="Salut, moi c'est Mégatron"
              hint="Écris-moi ou maintiens Ctrl Shift Espace pour me parler. Par exemple :"
            >
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </EmptyState>
          </li>
        )}
        <AnimatePresence initial={false}>
          {ai.messages.map((m, i) => {
            const prev = ai.messages[i - 1];
            const stamp = timeSeparator(m, prev);
            const groupStart = !prev || prev.role === "user" || !!stamp;
            return [
              stamp && (
                <li key={`t-${m.id}`} className="msg-time">
                  {stamp}
                </li>
              ),
              <Bubble key={m.id} message={m} avatar={m.role !== "user" && groupStart} />,
            ];
          })}
          {ai.recording && (
            <motion.li key="listening" className="msg user listening" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <motion.span className="listening-dot" animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }} />
              Je t'écoute…
            </motion.li>
          )}
          {ai.busy && (
            <motion.li key="typing" className="msg assistant typing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="typing-dot"
                  animate={{ y: [0, -3, 0], opacity: [0.4, 1, 0.4] }}
                  transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15 }}
                />
              ))}
            </motion.li>
          )}
        </AnimatePresence>
      </ul>

      <AnimatePresence>
        {ai.conversing && (
          <motion.div
            className="conversing-bar"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
          >
            <motion.span className="listening-dot" animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 1, repeat: Infinity }} />
            <span>
              <b>En conversation</b> · dis « merci, c'est bon » pour terminer
            </span>
            <button type="button" className="btn ghost" onClick={endConversation}>
              Terminer
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {ai.pendingFiles.length > 0 && (
        <div className="pending-files">
          {ai.pendingFiles.map((f, i) => (
            <span key={`${f.name}-${i}`} className="file-chip">
              <FileIcon kind={f.kind} />
              <span className="file-chip-name">{f.name}</span>
              <span className="muted">{formatSize(f.size)}</span>
              <button type="button" onClick={() => removePendingFile(i)} aria-label={`Retirer ${f.name}`}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      <form
        className="tile chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            ai.recording
              ? "Je t'écoute… (clique sur le micro pour envoyer)"
              : ai.pendingFiles.length
                ? "Que dois-je faire de ce fichier ?"
                : "Demande-moi quelque chose…"
          }
          disabled={ai.recording}
        />
        <button type="button" className="mic" onClick={attach} title="Joindre un fichier (ou glisse-le ici)" aria-label="Joindre un fichier">
          <Paperclip size={15} />
        </button>
        <button
          type="button"
          className={ai.recording ? "mic recording" : "mic"}
          onClick={toggleMic}
          disabled={!voice || ai.busy || ai.transcribing}
          title={voice ? (ai.recording ? "Envoyer" : "Parler") : "Ajoute une clé pour la voix dans les réglages de l'IA"}
          onContextMenu={(e) => {
            e.preventDefault();
            cancelTalking();
          }}
        >
          {ai.recording && <motion.span className="mic-ring" animate={{ scale: [1, 1.5], opacity: [0.6, 0] }} transition={{ duration: 1, repeat: Infinity }} />}
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" />
            <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="button"
          className={ai.conversing ? "mic recording" : "mic"}
          onClick={() => (ai.conversing ? endConversation() : voice && startConversation(config, voice))}
          disabled={!voice || (!ai.conversing && (ai.busy || ai.transcribing || ai.recording))}
          title={
            voice
              ? ai.conversing
                ? "Terminer la conversation"
                : "Discuter à voix haute (il réécoute après chaque réponse)"
              : "Ajoute une clé pour la voix dans les réglages de l'IA"
          }
          aria-label="Conversation à voix haute"
        >
          <AudioLines size={15} />
        </button>
        {ai.busy || ai.transcribing ? (
          <button type="button" className="btn ghost" onClick={cancelRequest}>
            <Square size={11} fill="currentColor" /> Arrêter
          </button>
        ) : (
          <button type="submit" className="btn primary" disabled={!text.trim() && !ai.pendingFiles.length}>
            Envoyer
          </button>
        )}
      </form>
    </div>
  );
}

function FileIcon({ kind }: { kind: Attachment["kind"] }) {
  const Icon = kind === "image" ? ImageIcon : kind === "pdf" ? FileText : FileCode;
  return <Icon size={13} className="file-chip-icon" />;
}

/** Heure d'un message, déduite de son identifiant (horodaté) ; null pour les anciens messages. */
const messageTime = (m: UiMessage) => (m.id > 1e15 ? new Date(Math.floor(m.id / 1000)) : null);

/** Séparateur « Aujourd'hui 14:05 » au début de la conversation et après une pause de plus de 20 min. */
export function timeSeparator(m: UiMessage, prev?: UiMessage) {
  const t = messageTime(m);
  if (!t) return null;
  const p = prev && messageTime(prev);
  if (p && t.getTime() - p.getTime() < 20 * 60_000) return null;
  const time = t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const day = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return `Aujourd'hui · ${time}`;
  if (diff === 1) return `Hier · ${time}`;
  return `${t.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} · ${time}`;
}

const PHONE_BADGE = "📱 ";

export function Bubble({ message: m, avatar = false }: { message: UiMessage; avatar?: boolean }) {
  // Message envoyé depuis Telegram : petite étiquette plutôt que l'émoji dans le texte.
  const fromPhone = m.role === "user" && m.text.startsWith(PHONE_BADGE);
  const text = fromPhone ? m.text.slice(PHONE_BADGE.length) : m.text;
  return (
    <motion.li
      layout
      className={`msg ${m.role}${avatar ? " with-avatar" : ""}`}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 32 }}
    >
      {avatar && (
        <span className="msg-avatar" aria-hidden="true">
          <Bot bare mood={m.role === "error" ? "suspicious" : "happy"} size={12} />
        </span>
      )}
      {fromPhone && (
        <span className="msg-origin">
          <Smartphone size={11} /> Telegram
        </span>
      )}
      {m.role === "action" && <span className="msg-icon">✓</span>}
      {m.role === "error" && <span className="msg-icon">!</span>}
      {m.files?.length ? (
        <span className="msg-with-files">
          <span className="msg-files">
            {m.files.map((name) => (
              <span key={name} className="msg-file">
                <Paperclip size={11} /> {name}
              </span>
            ))}
          </span>
          {text}
        </span>
      ) : (
        text
      )}
    </motion.li>
  );
}
