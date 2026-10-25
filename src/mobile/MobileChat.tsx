import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, RotateCcw, Settings2, Square } from "lucide-react";
import { Bot } from "../components/Bot";
import { PROVIDERS } from "../ai/providers";
import { aiConfig, ask, cancelRequest, resetConversation, startTalking, stopTalking, useAi, voiceConfig } from "../ai/session";
import { AiSetup, Bubble, timeSeparator } from "../views/Assistant";
import type { Data } from "../useData";

const SUGGESTIONS = [
  "Qu'est-ce que j'ai à faire aujourd'hui ?",
  "Ajoute « relancer le client » à mes tâches",
  "Rappelle-moi d'appeler Paul demain à 10 h",
  "Combien j'ai bossé cette semaine ?",
  "Lance 25 min de focus",
];

/**
 * Discussion avec l'assistant, pensée pour le téléphone : messages plein écran,
 * zone de saisie collée en bas (au-dessus du clavier), gros boutons micro et envoyer.
 */
/** Micro du widget « Ajout rapide » : l'écran IA s'ouvre et se met à écouter tout de suite. */
let voicePending = false;
export function requestVoice() {
  voicePending = true;
  window.dispatchEvent(new Event("megatron-voice"));
}

export function MobileChat({ settings }: Data) {
  const config = aiConfig(settings);
  const [editing, setEditing] = useState(false);
  if (!config || editing) {
    return (
      <div className="m-chat-setup">
        {!config && (
          <div className="m-chat-intro">
            <Bot mood="happy" size={64} />
            <b>Ton assistant, dans ta poche</b>
            <span className="muted">Branche une IA (Gemini est gratuit) pour gérer tes tâches, rappels et focus en lui parlant.</span>
          </div>
        )}
        <AiSetup settings={settings} onDone={() => setEditing(false)} canCancel={!!config} />
      </div>
    );
  }
  return <Chat settings={settings} onSettings={() => setEditing(true)} />;
}

function Chat({ settings, onSettings }: Pick<Data, "settings"> & { onSettings: () => void }) {
  const config = aiConfig(settings)!;
  const voice = voiceConfig(settings);
  const ai = useAi();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Toujours collé au dernier message (à l'ouverture sans animation, ensuite en douceur).
  const first = useRef(true);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTo({ top: list.scrollHeight, behavior: first.current ? "auto" : "smooth" });
    first.current = false;
  }, [ai.messages, ai.busy, ai.recording]);

  // La zone de saisie grandit avec le texte (jusqu'à 5 lignes).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [text]);

  const send = (value = text) => {
    if (!value.trim() || ai.busy) return;
    setText("");
    void ask(value.trim(), config);
  };

  const toggleMic = () => {
    if (!voice) return onSettings();
    if (ai.recording) stopTalking(config, voice, { speak: false });
    else startTalking(() => stopTalking(config, voice, { speak: false }));
  };

  // Ouvert depuis le micro du widget : on écoute directement (sans voix configurée, l'écran reste prêt à écrire).
  useEffect(() => {
    const listen = () => {
      if (!voicePending) return;
      voicePending = false;
      if (voice && !ai.recording) startTalking(() => stopTalking(config, voice, { speak: false }));
      else inputRef.current?.focus();
    };
    listen();
    window.addEventListener("megatron-voice", listen);
    return () => window.removeEventListener("megatron-voice", listen);
  }, [voice?.provider]);

  const empty = ai.messages.length === 0 && !ai.busy && !ai.recording;
  const typing = !!text.trim();

  return (
    <div className="m-chat">
      <div className="m-chat-bar">
        <button className="m-chat-model" onClick={onSettings}>
          <span className="m-chat-dot" />
          {PROVIDERS[config.provider].label}
          <Settings2 size={14} />
        </button>
        {ai.messages.length > 0 && (
          <button className="m-chat-new" onClick={resetConversation} disabled={ai.busy}>
            <RotateCcw size={14} /> Nouvelle
          </button>
        )}
      </div>

      <div className="m-chat-list" ref={listRef}>
        {empty ? (
          <div className="m-chat-empty">
            <Bot mood="happy" size={72} />
            <b>Salut, je t'écoute</b>
            <span className="muted">Écris-moi ou touche le micro. Par exemple :</span>
            <div className="m-chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <motion.button key={s} className="m-suggestion" whileTap={{ scale: 0.97 }} onClick={() => send(s)}>
                  {s}
                </motion.button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="messages">
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
              {(ai.busy || ai.transcribing) && (
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
        )}
      </div>

      <form
        className="m-composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ai.recording ? "Je t'écoute… touche ■ pour envoyer" : "Message"}
          disabled={ai.recording}
          enterKeyHint="send"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <AnimatePresence mode="popLayout" initial={false}>
          {ai.busy || ai.transcribing ? (
            <motion.button key="stop" type="button" className="m-send stop" onClick={cancelRequest} aria-label="Arrêter" {...pop}>
              <Square size={16} fill="currentColor" />
            </motion.button>
          ) : typing ? (
            <motion.button key="send" type="submit" className="m-send" aria-label="Envoyer" {...pop}>
              <ArrowUp size={22} strokeWidth={2.6} />
            </motion.button>
          ) : (
            <motion.button
              key="mic"
              type="button"
              className={ai.recording ? "m-send mic recording" : "m-send mic"}
              onClick={toggleMic}
              aria-label={ai.recording ? "Envoyer le message vocal" : "Parler"}
              {...pop}
            >
              {ai.recording && (
                <motion.span className="m-mic-ring" animate={{ scale: [1, 1.6], opacity: [0.5, 0] }} transition={{ duration: 1.1, repeat: Infinity }} />
              )}
              {ai.recording ? (
                <Square size={16} fill="currentColor" />
              ) : (
                <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
                  <rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor" />
                  <path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              )}
            </motion.button>
          )}
        </AnimatePresence>
      </form>
      {!voice && !typing && ai.messages.length === 0 && (
        <span className="m-chat-hint muted small">Pour parler au micro, ajoute une clé « voix » dans les réglages de l'IA.</span>
      )}
    </div>
  );
}

const pop = {
  initial: { scale: 0.6, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.6, opacity: 0 },
  transition: { type: "spring" as const, stiffness: 500, damping: 30 },
  whileTap: { scale: 0.9 },
};
