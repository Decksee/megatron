# Mégatron

Une encoche de productivité pour Windows, pensée pour les freelances. Elle se loge en haut de chaque écran, s'ouvre au survol avec des animations fluides et réunit tâches, projets clients, suivi du temps, focus, rappels et un assistant IA qu'on peut piloter à la voix.

## Fonctionnalités

- **Encoche multi-écran** : une encoche par moniteur, qui se range en fine barre quand une fenêtre est derrière elle et se cache en plein écran.
- **Aujourd'hui** : tableau de bord du jour (tâches, temps, focus, prochain rappel, calendrier).
- **Tâches** : listes avec dates d'échéance, rattachées ou non à un projet.
- **Projets et clients** : prix, client, dates de début et deadline, statuts (à démarrer, en cours, en pause, attente de paiement, payé), tâches par projet. Vue clients avec ce que chacun a rapporté et ce qui reste à encaisser.
- **Temps** : minuteurs multiples avec pause, vues jour / semaine / mois, pause automatique en cas d'inactivité.
- **Focus** : sessions avec un budget de distraction autorisé, alerte ou blocage des fenêtres qui distraient.
- **Rappels** : ponctuels ou répétés, l'encoche s'ouvre à l'heure dite.
- **Contrôles** : musique en cours (titre, pochette, lecture, progression), volume et raccourcis du PC.
- **Assistant IA** : Gemini, Claude, OpenAI ou un fournisseur compatible OpenAI, avec sa propre clé. Il gère les tâches, projets, minuteurs et rappels, ouvre des applications, des sites et des dossiers.
- **Voix** : « Hey Mégatron » pour l'appeler sans clavier, dictée, et réponses lues à voix haute (voix Windows, Azure, Gemini ou OpenAI).
- **Fenêtre Mégatron** : tâches, projets, IA et réglages dans une fenêtre classique (double-clic sur l'icône de la barre des tâches).
- **Thème** clair, sombre ou selon Windows. **Import / export** de toutes les données en JSON.

## Confidentialité

- Les données restent sur le PC, dans une base SQLite locale.
- Les clés API sont stockées dans le Gestionnaire d'identification Windows, jamais dans les fichiers ni dans les exports.
- Le mot d'éveil est reconnu localement par Windows ; seules les demandes faites à l'IA partent vers le fournisseur choisi.

## Stack

- [Tauri 2](https://tauri.app) (Rust) pour l'application de bureau et les accès Windows (fenêtres, média, audio, reconnaissance vocale, identifiants).
- React 19, TypeScript et Vite pour l'interface, [Motion](https://motion.dev) pour les animations, [Lucide](https://lucide.dev) pour les icônes.
- Plugins Tauri : SQL (SQLite), dialog, notification, global-shortcut, autostart.

## Prérequis

- Windows 10 ou 11
- [Node.js](https://nodejs.org) 20 ou plus
- [Rust](https://rustup.rs) (toolchain stable) et les [prérequis Tauri pour Windows](https://tauri.app/start/prerequisites/) (WebView2, outils de build C++)

## Lancer en développement

```powershell
npm install
powershell -ExecutionPolicy Bypass -File .\dev.ps1
```

`dev.ps1` ajoute `~/.cargo/bin` au PATH puis lance `npx tauri dev` (rechargement à chaud de l'interface).

Pour travailler l'interface dans un navigateur, `npm run dev` puis ouvrir `http://localhost:1420` : des données d'exemple remplacent la base. `?window=settings` affiche la fenêtre Mégatron.

## Construire l'application

```powershell
npx tauri build
```

L'installateur est généré dans `src-tauri/target/release/bundle/`.

## Structure

```
src/                 Interface React
  views/             Onglets (Aujourd'hui, Tâches, Projets, Temps, Focus, Rappels, IA, Réglages)
  components/        Composants (mascotte, listes déroulantes, calendrier, cadran…)
  ai/                Assistant : fournisseurs, outils, voix, synthèse vocale
  db.ts              Accès à la base SQLite
  App.tsx            L'encoche
  SettingsApp.tsx    La fenêtre Mégatron
src-tauri/src/       Côté Rust
  lib.rs             Fenêtres, survol, barre des tâches, migrations
  ai.rs              Appels aux fournisseurs d'IA et clés
  actions.rs         Actions sur le PC (applications, liens, dossiers, média)
  media.rs           Musique en cours et volume
  wake.rs            Mot d'éveil « Hey Mégatron »
docs/                Brief du logo
```

## Raccourcis

- `Ctrl` + `Shift` + `Espace` : appui court pour écrire à l'assistant, appui long pour lui parler.
