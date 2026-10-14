import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ExternalLink, Send, Smartphone, Unlink } from "lucide-react";
import { setSetting } from "../db";
import type { Data } from "../useData";
import { Switch } from "../components/Switch";
import { Select } from "../components/Select";
import {
  newPairCode,
  sendTelegram,
  SUMMARY_TIMES,
  telegramLinked,
  tg,
  tgKindsFor,
  TG_SLOT,
  tgChatOn,
  tgKindOn,
} from "../telegram";

const open = (url: string) => invoke("open_url", { url }).catch(console.error);

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
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

/** Étape 1 : la clé du bot, créée avec @BotFather. */
function BotSetup() {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke("ai_set_key", { slot: TG_SLOT, key: token });
      const me = await tg<{ username: string }>("getMe");
      await setSetting("tg_pair_code", newPairCode());
      await setSetting("tg_chat_id", "");
      await setSetting("tg_offset", "0");
      await setSetting("tg_bot", me.username);
      setToken("");
    } catch (e) {
      const raw = String((e as Error)?.message ?? e);
      setError(/401|404|Unauthorized|Not Found/i.test(raw) ? "Clé refusée par Telegram : vérifie-la (format 123456:ABC…)." : raw);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="setting column tg-step">
      <div className="setting-title">1. Crée ton bot</div>
      <ol className="azure-steps muted small">
        <li>
          Dans Telegram, ouvre <b>@BotFather</b>{" "}
          <button type="button" className="link" onClick={() => open("https://t.me/BotFather")}>
            (ouvrir)
          </button>
          , envoie <b>/newbot</b>, puis choisis un nom (ex. « Mégatron ») et un identifiant qui finit par « bot ».
        </li>
        <li>
          Il te répond avec une <b>clé</b> (du genre <code>123456789:AAH…</code>) : colle-la ici.
        </li>
      </ol>
      <form
        className="row azure-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (token.trim()) connect();
        }}
      >
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Clé du bot"
          aria-label="Clé du bot Telegram"
        />
        <button className="btn primary" type="submit" disabled={!token.trim() || busy}>
          {busy ? "…" : "Connecter"}
        </button>
      </form>
      {error && <div className="status error">{error}</div>}
      <span className="muted small">La clé reste dans le Gestionnaire d'identification Windows.</span>
    </section>
  );
}

/** Étape 2 : relier son compte Telegram en ouvrant le lien (ou en envoyant le code). */
function Pairing({ settings }: Pick<Data, "settings">) {
  const code = settings.tg_pair_code;
  useEffect(() => {
    if (!code) void setSetting("tg_pair_code", newPairCode());
  }, [code]);
  const link = `https://t.me/${settings.tg_bot}?start=${code}`;
  return (
    <section className="setting column tg-step">
      <div className="setting-title">2. Relie ton téléphone</div>
      <span className="muted small">
        Ouvre le lien ci-dessous et appuie sur <b>Démarrer</b> dans Telegram : Mégatron saura que c'est toi. Le bot
        n'obéira qu'à ce compte.
      </span>
      <div className="row">
        <button className="btn primary" onClick={() => open(link)}>
          <ExternalLink size={13} /> Ouvrir @{settings.tg_bot}
        </button>
        <span className="muted small">
          ou, depuis le téléphone, envoie <code>/start {code}</code> à @{settings.tg_bot}
        </span>
      </div>
      <div className="tg-waiting muted small">
        <span className="listening-dot" /> En attente de ton « Démarrer »… (Mégatron doit être lancé)
      </div>
      <button className="link muted" onClick={() => setSetting("tg_bot", "")}>
        Utiliser un autre bot
      </button>
    </section>
  );
}

export function TelegramSettings({ settings }: Pick<Data, "settings">) {
  const [test, setTest] = useState<"idle" | "sent" | string>("idle");
  const linked = telegramLinked(settings);

  const unlink = async () => {
    await setSetting("tg_chat_id", "");
    await setSetting("tg_pair_code", newPairCode());
  };

  const sendTest = async () => {
    setTest("idle");
    try {
      await sendTelegram("👋 Test réussi : Mégatron peut t'envoyer des notifications ici.", undefined, settings);
      setTest("sent");
    } catch (e) {
      setTest(String((e as Error)?.message ?? e));
    }
  };

  return (
    <div className="settings">
      {!settings.tg_bot ? (
        <BotSetup />
      ) : !linked ? (
        <Pairing settings={settings} />
      ) : (
        <>
          <section className="setting tg-linked">
            <span className="tg-icon">
              <Smartphone size={18} />
            </span>
            <div className="grow">
              <div className="setting-title">
                Relié à {settings.tg_user || "ton compte"} · @{settings.tg_bot}
              </div>
              <div className="muted small">Notifications et discussion tant que Mégatron tourne sur ce PC.</div>
            </div>
            <div className="row">
              <button className="btn ghost" onClick={sendTest}>
                {test === "sent" ? <Check size={13} /> : <Send size={13} />} {test === "sent" ? "Envoyé" : "Tester"}
              </button>
              <button className="btn ghost" onClick={unlink} title="Délier ce compte Telegram">
                <Unlink size={13} />
              </button>
            </div>
          </section>
          {test !== "idle" && test !== "sent" && <div className="status error">{test}</div>}

          <div className="setting-block">
            <Row title="Discuter avec Mégatron" hint="Écris-lui ou envoie un vocal depuis Telegram : même IA, mêmes outils, même conversation.">
              <Switch label="Discuter depuis Telegram" checked={tgChatOn(settings)} onChange={(v) => setSetting("tg_chat", v ? "1" : "0")} />
            </Row>
          </div>

          <div className="setting-block">
            {tgKindsFor(settings).map((k) => (
              <Row key={k.kind} title={k.label} hint={k.hint}>
                <Switch
                  label={k.label}
                  checked={tgKindOn(settings, k.kind)}
                  onChange={(v) => setSetting(`tg_n_${k.kind}`, v ? "1" : "0")}
                />
              </Row>
            ))}
          </div>

          <div className="setting-block">
            <Row title="Résumé du soir" hint="Ton temps de travail, tes tâches faites et ce qui t'attend demain.">
              <div className="row">
                {settings.tg_summary === "1" && (
                  <Select
                    value={settings.tg_summary_time || "19:00"}
                    options={SUMMARY_TIMES.map((t) => ({ value: t, label: t.replace(":", " h ") }))}
                    onChange={(v) => setSetting("tg_summary_time", v)}
                    ariaLabel="Heure du résumé"
                  />
                )}
                <Switch label="Résumé du soir" checked={settings.tg_summary === "1"} onChange={(v) => setSetting("tg_summary", v ? "1" : "0")} />
              </div>
            </Row>
          </div>

          <section className="setting column">
            <div className="setting-title">Commandes rapides</div>
            <span className="muted small">
              <code>/taches</code> tes tâches · <code>/temps</code> ton temps de travail · <code>/focus</code> ta session ·{" "}
              <code>/rappels</code> tes prochains rappels · <code>/aide</code>
            </span>
          </section>

          <button className="link muted tg-forget" onClick={() => setSetting("tg_bot", "")}>
            Changer de bot
          </button>
        </>
      )}
    </div>
  );
}
