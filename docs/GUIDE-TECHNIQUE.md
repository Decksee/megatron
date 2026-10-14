# Guide technique — reprendre le code de Mégatron

Ce document explique comment le code est organisé, comment les morceaux communiquent et où intervenir pour faire évoluer l'application. Pour la vision produit, voir [CAHIER-DES-CHARGES.md](CAHIER-DES-CHARGES.md).

---

## 1. Vue d'ensemble

Mégatron est une application [Tauri 2](https://tauri.app) : une interface web (React 19 + TypeScript, servie par Vite) affichée dans des fenêtres WebView2, et un cœur en Rust qui parle à Windows.

```
┌──────────────────────────── Rust (src-tauri) ────────────────────────────┐
│ Fenêtres (une encoche par écran + fenêtre Mégatron), zone de notification │
│ Surveillance du curseur (16 ms) → survol, fenêtre derrière, plein écran   │
│ Windows : média (GSMTC), volume, reconnaissance vocale, identifiants,     │
│           fenêtre au premier plan, inactivité, actions (apps, liens…)     │
│ Réseau : appels IA, voix en ligne, Telegram (les clés ne quittent jamais  │
│          le côté Rust)                                                    │
│ SQLite (plugin SQL) + migrations                                          │
└──────────────▲───────────────────────────────────────────▲───────────────┘
               │ invoke("commande")                        │ événements
┌──────────────┴───────────── Interface (src) ─────────────┴───────────────┐
│ App.tsx (encoche)  ·  SettingsApp.tsx (fenêtre Mégatron)                 │
│ useData() : toutes les données, rechargées sur l'événement data-changed  │
│ db.ts : requêtes SQL  ·  ai/ : assistant  ·  telegram.ts : bot           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Principes à garder en tête :**

- **Une fenêtre par écran.** Chaque écran a sa propre encoche (fenêtre `notch-x_y_w_h`), qui exécute son propre JavaScript. Les fenêtres ne partagent pas de mémoire : elles se synchronisent par la base de données et par des événements Tauri.
- **Une seule fenêtre fait le travail de fond.** La « fenêtre première » (`isLeader()`, la première encoche par ordre alphabétique) est la seule à surveiller le focus, les rappels, la pause automatique, le mot d'éveil et Telegram. Les autres affichent.
- **Les clés restent en Rust.** La page n'a jamais accès aux clés API : elle demande à Rust de faire l'appel.

## 2. Démarrer

Prérequis : Windows 10/11, Node.js 20+, Rust stable et les [prérequis Tauri](https://tauri.app/start/prerequisites/).

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\dev.ps1   # mode développement (rechargement à chaud)
npx tsc --noEmit -p .                                # vérification des types
cd src-tauri; cargo check                            # vérification du Rust
npx tauri build                                      # installateur dans src-tauri/target/release/bundle/
```

**Aperçu dans un navigateur.** `npm run dev` puis `http://localhost:1420` affiche l'encoche avec des données d'exemple (`src/dev/sample.ts`), sans base ni Rust. `?window=settings&section=projects` affiche la fenêtre Mégatron sur une page donnée. Pratique pour travailler le design ; tout ce qui dépend de Windows (média, voix, clés) n'y fonctionne pas.

## 3. Arborescence

```
src/
  main.tsx              Point d'entrée : encoche, fenêtre Mégatron (?window=settings) ou galerie de dev
  App.tsx               L'encoche : tailles, pastille, onglets, survol, fine barre, pastille vocale
  SettingsApp.tsx       La fenêtre Mégatron : pages Tâches / Projets / IA / Réglages
  useData.ts            Charge toutes les données et les recharge sur « data-changed »
  db.ts                 Types et requêtes SQLite, sauvegarde / restauration JSON
  projects.ts           Types d'usage, statuts, clients, calculs d'argent (total, payé, reste)
  time.ts               Calculs de durée, périodes, formatage
  focus.ts              Surveillance du focus (fenêtre au premier plan, inactivité, budget)
  reminders.ts          Rappels arrivés à échéance → notifications
  background.ts         Pause automatique, compte à rebours, raccourci global, mot d'éveil
  telegram.ts           Bot Telegram : appairage, notifications, discussion, résumés
  errors.ts             Erreurs de connexion (clés IA, voix, Azure, Telegram) traduites en langage clair
  mood.ts               Humeur de la mascotte, position du curseur, fenêtre derrière l'encoche
  media.ts, theme.ts, notify.ts, leader.ts, hold.ts, options.ts
  ai/
    session.ts          Conversation : état partagé, envoi au modèle, outils, voix, mode conversation
    providers.ts        Formats Gemini / Claude / OpenAI, tri des modèles par coût
    tools.ts            Outils que l'IA peut appeler (tâches, projets, minuteurs, apps…)
    voice.ts            Enregistrement du micro en WAV 16 kHz, détection de fin de phrase
    speech.ts           Voix de l'assistant (Windows, Azure, Gemini, OpenAI), quotas, cache
  views/                Un fichier par onglet ou page (Today, Controls, Tasks, Projects, Time,
                        Focus, Reminders, Assistant, Settings, TelegramSettings, ProjectMoney…)
  components/           Composants réutilisables (Bot, Select, DatePicker, FocusDial, VoiceWave…)
  dev/sample.ts         Données d'exemple pour l'aperçu navigateur
  styles.css            Tout le style (variables de thème en tête de fichier)

src-tauri/src/
  lib.rs                Fenêtres, surveillance du curseur, zone cliquable, zone de notification,
                        raccourci global, migrations, liste des commandes
  ai.rs                 Clés (Gestionnaire d'identification), appels IA, transcription, voix en ligne
  telegram.rs           Appels à l'API Bot (liste blanche de méthodes), téléchargement des vocaux
  actions.rs            Ouvrir une app, un lien, un dossier ; touches média ; verrouillage ; capture
  media.rs              Musique en cours (GSMTC), contrôle, volume, niveau sonore
  wake.rs               « Hey Mégatron » (reconnaissance vocale Windows, liste de phrases fermée)

docs/                   Cahier des charges, ce guide, brief et déclinaisons du logo
```

## 4. Le côté Rust

### 4.1 Fenêtres de l'encoche

`lib.rs` crée une fenêtre transparente, sans bordure et toujours au premier plan, de 900 × 520 px, en haut de chaque écran (`sync_notch_windows`, rappelé régulièrement pour suivre les branchements d'écrans). La fenêtre est beaucoup plus grande que l'encoche visible : c'est la page qui dessine l'encoche à la bonne taille.

Pour que le reste de la fenêtre ne bloque pas les clics, la page déclare sa **zone utile** avec la commande `set_hit_area(width, height, interactive)`. Un fil Rust interroge la position du curseur toutes les 16 ms et :

- émet `notch-hover` quand le curseur entre ou sort de la zone (avec une marge et un délai) ;
- active ou coupe `set_ignore_cursor_events` : hors de la zone, ou quand l'encoche n'est pas interactive, les clics traversent ;
- émet `notch-cursor` (pour que les yeux de la mascotte suivent la souris) ;
- émet `notch-occupied` quand une fenêtre se trouve sous l'encoche (fine barre en mode automatique) ;
- cache l'encoche quand l'application au premier plan est en plein écran.

### 4.2 Commandes exposées à la page

Elles sont toutes listées dans `tauri::generate_handler!` en bas de `lib.rs`.

| Domaine | Commandes |
|---|---|
| Encoche | `set_hit_area`, `open_settings` |
| Système | `idle_seconds`, `foreground_window`, `minimize_window`, `write_text_file`, `read_text_file` |
| IA (`ai.rs`) | `ai_set_key`, `ai_has_key`, `ai_delete_key`, `ai_chat`, `ai_list_models`, `ai_transcribe`, `ai_speak`, `azure_voices` |
| Telegram | `telegram_call` (méthodes autorisées seulement), `telegram_file` |
| Actions | `open_app`, `open_url` (http/https seulement), `open_folder`, `media_key`, `lock_screen`, `screen_snip` |
| Média | `media_state`, `media_control`, `volume_get`, `volume_set`, `audio_peak` |
| Voix | `wake_word_set` |

### 4.3 Clés API

`ai.rs` range les clés dans le **Gestionnaire d'identification Windows** sous les cibles `megatron:<emplacement>` : `main` (IA), `voice` (clé dédiée à la voix), `azure`, `telegram`. La page enregistre une clé avec `ai_set_key` puis ne la revoit jamais : les appels (`ai_chat`, `ai_speak`, `telegram_call`…) lisent la clé côté Rust. Les messages d'erreur de Telegram sont réécrits pour ne pas contenir l'adresse (qui inclut la clé).

### 4.4 Base de données et migrations

La base SQLite `megatron.db` (dossier de données de l'application) est gérée par `tauri-plugin-sql`. Les migrations sont dans `migrations()` (`lib.rs`) et s'appliquent au chargement de la base :

| Version | Contenu |
|---|---|
| 1 | Projets et tâches |
| 2 | Suivi du temps (`time_entries`) et réglages (`settings`, clé / valeur) |
| 3 | Minuteurs multiples avec pause (`timers`) |
| 4 | Sessions de focus |
| 5 | Rappels |
| 6 | Échéance des tâches, date de début et date de paiement des projets, nouveaux statuts |
| 7 | Conversation gardée (`conversation`) et mémoire de l'assistant (`memories`) |
| 8 | Extras (`extras`), paiements (`payments`), rattachement des tâches aux extras |

**Ne jamais modifier une migration existante** : en ajouter une nouvelle à la fin de la liste. Penser aussi à mettre à jour `exportBackup` / `importBackup` (`db.ts`) et le numéro de version de la sauvegarde.

## 5. L'interface

### 5.1 Données : `db.ts` et `useData`

`db.ts` contient les types (`Project`, `Task`, `Extra`, `Payment`…) et les requêtes. Toute écriture passe par `write()`, qui exécute la requête puis émet l'événement **`data-changed`**. Chaque fenêtre utilise `useData()`, qui recharge toutes les tables à la réception de cet événement : c'est ce qui synchronise les encoches de tous les écrans et la fenêtre Mégatron.

Les **réglages** sont une simple table clé / valeur (`setSetting(clé, valeur)`, lus dans `data.settings`). Principales clés :

| Clés | Rôle |
|---|---|
| `theme`, `notch_mini`, `idle_minutes`, `usage` | Apparence, fine barre, pause automatique, type d'usage (`freelance`, `studies`, `personal`) |
| `ai_provider`, `ai_model`, `ai_base_url`, `ai_memory`, `voice_provider`, `voice_model` | Assistant |
| `speak_*` | Voix de l'assistant (mode, moteur, voix, vitesse, hauteur, volume, région Azure) |
| `speak_blocked_until_<fournisseur>` | Quota de voix en ligne épuisé jusqu'à cette date |
| `wake_word`, `wake_status` | Mot d'éveil |
| `focus_*` | Durée, budget, mode et liste des distractions par défaut |
| `tg_*` | Telegram (bot, compte relié, code d'appairage, notifications, résumé) |

### 5.2 L'encoche : `App.tsx`

`App.tsx` calcule à chaque rendu **la taille de l'encoche** selon l'état : ouverte (taille de l'onglet, voir `TABS`), alerte de rappel, pastille vocale, fête de fin de focus, fine barre, pastille avec musique ou avec focus, pastille de base. Il déclare ensuite cette taille à Rust (`set_hit_area`). L'animation entre deux tailles est un ressort `motion`.

Le contenu fermé (la pastille) affiche, par ordre de priorité : la fête de fin de focus, l'activité de l'IA, le focus, les minuteurs, la musique, puis l'heure et les tâches restantes.

`App.tsx` branche aussi les tâches de fond : `useIdleAutoPause`, `useCountdownWatcher`, `useReminderWatcher`, `useTelegram`, `useFocusMonitor`, `useWakeWord`, `useAssistantShortcut`. Chacune vérifie elle-même `isLeader()` avant d'agir.

### 5.3 La fenêtre Mégatron : `SettingsApp.tsx`

Fenêtre classique (étiquette `settings`, ouverte par `open_settings`) avec un dock en bas. Les pages Tâches, Projets et IA réutilisent les mêmes composants que l'encoche (`views/`) ; la page Réglages regroupe Général, IA, Focus, Téléphone, Données et À propos. L'événement `settings-section` permet d'ouvrir la fenêtre directement sur une section.

### 5.4 Projets, types d'usage et argent : `projects.ts`

- **Types d'usage** (`USAGES`) : chaque profil décrit les libellés, les statuts proposés et la présence ou non de l'argent. Les vues lisent `usageProfile(settings)` et masquent ce qui ne s'applique pas. Le statut `done` sert aux profils sans argent ; `unpaid` et `paid` s'affichent comme terminés hors freelance (`displayStatus`, `statusLabel`).
- **Argent** : `projectMoney(projet, { extras, payments })` donne le prix de base, les extras, le total, le payé et le reste. `moneyTotals` agrège par devise (encaissé, à encaisser sur le travail livré, en cours sur le reste). `clientSummaries` regroupe par client.
- **Règles de paiement** : `recordPayment` passe un projet livré en « Payé » quand il est soldé ; `changeStatus` enregistre le solde quand on passe un projet en « Payé ». Toujours passer par ces deux fonctions plutôt que par `addPayment` / `setProjectStatus` directement.

### 5.5 L'assistant : `src/ai/`

**`session.ts`** tient l'état de la conversation dans un petit magasin (`aiStore`, lu par `useAi()`) :

- `messages` : les bulles affichées ; `history` : l'historique au format du fournisseur, **rangé par échange** pour pouvoir n'envoyer que les 12 derniers sans casser l'enchaînement appel d'outil / résultat.
- **Synchronisation** : à chaque modification, l'état partagé est diffusé à toutes les fenêtres (événement `chat-sync`) et sauvegardé en base (table `conversation`). Le compteur `epoch` permet d'abandonner partout une demande en cours quand on réinitialise.
- `ask()` envoie le message, exécute les outils demandés par le modèle (jusqu'à 8 étapes) et renvoie la réponse et la liste des actions (utilisé par Telegram).
- Le **prompt système** est construit à chaque demande : règles générales, profil d'usage, notes de l'apprentissage, consignes du mode conversation.
- **Mode conversation** (`startConversation`) : boucle écoute → transcription → réponse lue → écoute, terminée par une formule de fin (`isEnding`) ou un silence.

**`providers.ts`** traduit les messages et les outils vers les formats Gemini, Claude (API Messages) et OpenAI, et trie les modèles par coût (`sortByCost`) ; `pickDefault` choisit le moins cher.

**`tools.ts`** déclare les outils (`TOOLS`) et les exécute (`executeTool`). Pour **ajouter un outil** : ajouter sa définition (nom, description, paramètres JSON Schema) dans `TOOLS`, puis un `case` dans `executeTool` qui renvoie `{ result, label }` (`result` est lu par le modèle, `label` est affiché à l'utilisateur).

**`voice.ts`** enregistre le micro en WAV 16 kHz et détecte la fin de phrase ; **`speech.ts`** lit les réponses (voix Windows par `speechSynthesis`, voix en ligne par `ai_speak`), mémorise les quotas épuisés et met en cache les extraits du bouton « Écouter ».

**`wake.rs`** reconnaît « Mégatron » avec la reconnaissance vocale de Windows, limitée à une liste de phrases (plusieurs graphies du nom et des mots leurres pour éviter les faux déclenchements). L'événement `wake-word` est envoyé à l'encoche de l'écran où se trouve la souris.

### 5.6 Telegram : `telegram.ts`

La fenêtre première interroge le bot en continu (`getUpdates`, attente de 25 s). Les messages d'un compte non relié sont ignorés ; l'appairage se fait avec `/start CODE`. Les notifications passent par `telegramNotify(type, texte, boutons)`, appelée depuis `reminders.ts`, `focus.ts` et `background.ts`. Une vérification par minute gère le résumé du soir, la relance des paiements du lundi et les minuteurs oubliés. En développement, le module se recharge entièrement quand on le modifie, pour que la boucle d'écoute reparte avec le nouveau code.

## 6. Recettes courantes

**Ajouter un onglet à l'encoche.** Créer la vue dans `src/views/`, l'ajouter à `TABS` dans `App.tsx` (identifiant, libellé, largeur, hauteur) puis au rendu des onglets. La largeur de la fenêtre (900 px) borne la taille maximale.

**Ajouter un réglage.** Choisir une clé, la lire dans `data.settings` (avec une valeur par défaut), l'écrire avec `setSetting`. Ajouter le contrôle dans `views/Settings.tsx` ou dans la section concernée de `SettingsApp.tsx`.

**Ajouter une table.** Nouvelle migration dans `lib.rs`, type et requêtes dans `db.ts`, chargement dans `useData.ts`, sauvegarde et restauration dans `exportBackup` / `importBackup`, données d'exemple dans `src/dev/sample.ts`.

**Ajouter une commande Rust.** Écrire la fonction avec `#[tauri::command]`, l'ajouter à `generate_handler!`, l'appeler avec `invoke("nom", { paramètre })` (les paramètres sont en camelCase côté JavaScript, snake_case côté Rust).

## 7. Conventions

- **Tout est en français** : interface, commentaires, messages de commit.
- **Commentaires** : ils expliquent le *pourquoi* (une contrainte de Windows, un piège déjà rencontré), pas le *quoi*.
- **Style** : variables de couleur dans `:root` en tête de `styles.css` (`--accent`, `--fg-rgb`…), redéfinies pour le thème clair ; ne pas écrire de couleur en dur pour ce qui doit suivre le thème.
- **Animations** : `motion` pour les transitions et les ressorts ; CSS pour les boucles infinies simples (plus fiables) ; `requestAnimationFrame` sans rendu React pour ce qui bouge en continu (ondes de la pastille vocale).
- **Vérifier avant de livrer** : `npx tsc --noEmit -p .` et `cargo check` doivent passer.

## 8. Pièges connus

- **Clics traversants** : si une zone de l'encoche ne réagit pas aux clics, vérifier que `interactive` est vrai dans `App.tsx` pour cet état et que la zone déclarée à `set_hit_area` la couvre.
- **Champ qui garde l'encoche ouverte** : un champ ne retient l'encoche que si la fenêtre a réellement le focus (`document.hasFocus()`), sinon l'onglet IA, qui place le curseur dans son champ, empêcherait l'encoche de se fermer.
- **Fine barre et distractions** : une encoche qui grandit au-dessus d'une fenêtre ne détecte plus cette fenêtre. C'est pour cela qu'une distraction en focus ne fait pas ressortir la fine barre.
- **Boucles de fond et rechargement à chaud** : une boucle lancée dans un effet continue avec l'ancien code après une modification. Prévoir un arrêt (`import.meta.hot.dispose`) ou relancer l'application.
- **Messages d'erreur** : ne jamais afficher une erreur brute de fournisseur à l'utilisateur. Pour une erreur de clé, utiliser `<ErrorNote raw={…} service="…" />` (explication + détail replié) et compléter `explainError` (`src/errors.ts`) si un nouveau cas apparaît ; dans la discussion, passer par `friendlyError` (`ai/session.ts`).
- **Montants** : toujours raisonner par devise (`Record<devise, montant>`) ; un client peut avoir des projets en euros et en dollars.
