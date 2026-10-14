<p align="center">
  <img src="docs/logo/megatron-yeux-fond-noir.png" alt="Mégatron" width="120" />
</p>

<h1 align="center">Mégatron</h1>

<p align="center">
  Une encoche de productivité pour Windows : tâches, projets, temps, focus, rappels<br />
  et un assistant IA que l'on pilote au clavier, à la voix ou depuis son téléphone.
</p>

---

Mégatron se loge en haut de chaque écran, à la manière de l'encoche d'un téléphone. Au repos, il affiche l'essentiel (le minuteur qui tourne, la musique, le focus en cours) et se réduit à une fine barre quand une fenêtre se trouve dessous. Au survol, il se déplie en un panneau complet. Il est pensé pour les **freelances**, les **étudiants** et les **projets personnels**.

## Fonctionnalités

**Organisation**
- **Aujourd'hui** : le tableau de bord du jour (tâches, temps travaillé, semaine, prochain rappel).
- **Tâches** avec date d'échéance, rattachées ou non à un projet.
- **Projets** adaptés au type d'usage :
  - *Freelance* : clients, prix, **extras** facturés en plus (découpables en tâches), **paiements** reçus, payé et reste dû ;
  - *Études* : matières et dates de rendu ;
  - *Perso* : sans client ni prix.
- **Rappels** ponctuels ou répétés : l'encoche s'ouvre à l'heure dite.

**Temps et concentration**
- **Minuteurs** multiples avec pause, vues jour / semaine / mois, pause automatique en cas d'inactivité.
- **Focus** avec un budget de repos et de distraction : alerte ou blocage des fenêtres qui distraient, pause comptée quand on ne touche plus à rien, et une petite fête à la fin.

**Assistant**
- **IA** au choix (Gemini gratuit, Claude, OpenAI ou compatible), avec sa propre clé ; le modèle le moins cher est choisi par défaut.
- Il **agit** : tâches, projets, extras, paiements, minuteurs, focus, rappels, applications, sites, dossiers, musique.
- **« Hey Mégatron »** : une conversation continue à la voix, dans une pastille animée façon Siri.
- **Voix** de Windows, Azure (gratuit), Gemini ou OpenAI.
- **Apprentissage** (activable) : il retient ce qu'on lui apprend sur soi.
- **Conversation gardée** et synchronisée entre tous les écrans, la fenêtre Mégatron et Telegram.

**Partout**
- **Contrôles** : musique en cours, volume, capture, verrouillage.
- **Telegram** : notifications sur le téléphone (avec boutons), discussion écrite ou vocale, résumé du soir.
- **Fenêtre Mégatron** (double-clic sur l'icône de la zone de notification) : Tâches, Projets, IA et tous les réglages.
- **Thème** clair, sombre ou selon Windows ; **sauvegarde et restauration** en JSON.

## Confidentialité

- Toutes les données restent sur le PC, dans une base SQLite locale.
- Les clés API sont rangées dans le **Gestionnaire d'identification Windows**, jamais dans les fichiers ni dans les sauvegardes.
- « Hey Mégatron » est reconnu **localement** par Windows. Seules les demandes faites à l'IA, aux voix en ligne et au bot Telegram quittent l'ordinateur, vers les services choisis.

## Démarrer

**Prérequis** : Windows 10 ou 11, [Node.js](https://nodejs.org) 20+, [Rust](https://rustup.rs) stable et les [prérequis Tauri pour Windows](https://tauri.app/start/prerequisites/).

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\dev.ps1
```

`dev.ps1` ajoute `~/.cargo/bin` au PATH puis lance `npx tauri dev`, avec rechargement à chaud de l'interface.

**Construire l'installateur :**

```powershell
npx tauri build
```

L'installateur est généré dans `src-tauri/target/release/bundle/`.

**Aperçu dans un navigateur** : `npm run dev` puis [http://localhost:1420](http://localhost:1420). Des données d'exemple remplacent la base ; ajouter `?window=settings` pour la fenêtre Mégatron.

## Configuration rapide

| Pour… | Où | Ce qu'il faut |
|---|---|---|
| L'assistant IA | Onglet **IA** | Une clé [Google AI Studio](https://aistudio.google.com/apikey) (gratuite), Claude ou OpenAI |
| Une voix plus humaine | Réglages → IA → **Sa voix** | Une ressource Azure Speech en offre gratuite *Free F0* |
| « Hey Mégatron » | Réglages → IA | Rien : reconnaissance vocale de Windows |
| Le téléphone | Réglages → **Téléphone** | Un bot créé avec [@BotFather](https://t.me/BotFather) |
| Études ou perso | Réglages → Général → **Tes projets** | Choisir Études ou Perso |

**Raccourci** : `Ctrl` + `Shift` + `Espace` — appui court pour écrire à l'assistant, appui long pour lui parler.

## Stack

- [Tauri 2](https://tauri.app) (Rust) : fenêtres, accès à Windows (média, volume, reconnaissance vocale, identifiants), appels réseau.
- [React 19](https://react.dev), TypeScript et [Vite](https://vite.dev) pour l'interface ; [Motion](https://motion.dev) pour les animations ; [Lucide](https://lucide.dev) pour les icônes.
- Plugins Tauri : SQL (SQLite), dialog, notification, global-shortcut, autostart.

## Documentation

- [Cahier des charges](docs/CAHIER-DES-CHARGES.md) : le projet, ses objectifs et toutes ses fonctionnalités.
- [Guide technique](docs/GUIDE-TECHNIQUE.md) : l'architecture et le code, pour reprendre le projet.
- [Brief du logo](docs/brief-logo.html) et [déclinaisons](docs/logo/).

## Structure

```
src/                 Interface React
  App.tsx            L'encoche
  SettingsApp.tsx    La fenêtre Mégatron
  views/             Les onglets et pages
  components/        Mascotte, listes déroulantes, calendrier, cadran, ondes…
  ai/                Assistant : fournisseurs, outils, micro, voix, conversation
  db.ts              Base SQLite
  projects.ts        Types d'usage, clients, argent des projets
  telegram.ts        Bot Telegram
src-tauri/src/       Côté Rust
  lib.rs             Fenêtres, survol, zone de notification, migrations
  ai.rs              Clés et appels aux fournisseurs d'IA et de voix
  telegram.rs        API Bot Telegram
  actions.rs         Actions sur le PC
  media.rs           Musique et volume
  wake.rs            « Hey Mégatron »
docs/                Cahier des charges, guide technique, logo
```
