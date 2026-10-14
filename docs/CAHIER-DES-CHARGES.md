# Cahier des charges — Mégatron

*Application de bureau Windows de productivité, sous forme d'encoche, pour freelances, étudiants et projets personnels.*

---

## 1. Contexte du projet

Les indépendants, les étudiants et toutes les personnes qui mènent plusieurs projets de front jonglent en permanence entre une liste de tâches, un outil de suivi du temps, un minuteur de concentration, des rappels, un tableur pour savoir ce que les clients leur doivent, et un assistant conversationnel ouvert dans un onglet. Chacun de ces outils vit dans sa propre fenêtre, demande d'être ouvert au bon moment et finit souvent oublié.

Mégatron part d'un constat simple : ces informations doivent être **visibles en permanence sans prendre de place**. Inspirée de l'encoche des téléphones et de l'application Hitodama, l'application se loge sous la forme d'une petite encoche en haut de chaque écran Windows. Au repos, elle affiche l'essentiel (le temps qui tourne, la musique, le focus en cours) ; au survol, elle se déplie avec une animation fluide et donne accès à tout le reste.

Le projet est d'abord un outil personnel, pensé pour pouvoir être partagé ensuite. Toutes les données restent sur l'ordinateur de l'utilisateur.

## 2. Objectifs du projet

- **Centraliser** dans un seul outil les tâches, les projets, le temps de travail, la concentration, les rappels et le suivi des paiements.
- **Rester discret** : une encoche qui ne cache pas le contenu des fenêtres et se range d'elle-même quand elle gêne.
- **Faire gagner du temps** grâce à un assistant IA capable d'agir directement (créer une tâche, lancer un minuteur, ouvrir une application) à l'écrit comme à la voix.
- **Aider à se concentrer** avec un mode focus qui mesure les distractions et peut les bloquer.
- **Savoir où en est l'argent** : prix des projets, extras demandés en cours de route, acomptes reçus et reste dû, par client.
- **Suivre l'utilisateur hors de son bureau** grâce à un bot Telegram pour les notifications et les échanges depuis le téléphone.
- **Protéger la vie privée** : données locales, clés API rangées dans le coffre-fort de Windows, aucun compte à créer.

## 3. Description générale de la solution

Mégatron est une application de bureau Windows composée de trois surfaces.

**L'encoche** est la surface principale. Une encoche est affichée en haut de chaque écran connecté. Fermée, elle prend la forme d'une pastille qui résume l'activité en cours ; quand une fenêtre se trouve derrière elle, elle se réduit à une fine barre. Au survol, elle se déplie en un panneau organisé en onglets : Aujourd'hui, Contrôles, Tâches, Projets, Temps, Focus, Rappels et IA. Chaque onglet a sa propre taille et l'encoche s'élargit ou se resserre en changeant d'onglet.

**La fenêtre Mégatron** est une fenêtre classique, ouverte par un double-clic sur l'icône de la zone de notification. Elle reprend les Tâches, les Projets, la discussion avec l'IA et regroupe tous les réglages. Elle est destinée aux moments où l'on veut travailler plus confortablement qu'à travers l'encoche.

**Le bot Telegram**, optionnel, prolonge l'application sur le téléphone : il envoie les notifications et permet de discuter avec Mégatron à distance tant que l'ordinateur est allumé.

La mascotte de l'application est un petit robot dont les yeux verts changent d'expression selon ce qui se passe : concentré, en pause, à l'écoute, en réflexion, content ou contrarié par une distraction.

## 4. Fonctionnalités détaillées

### 4.1 Encoche multi-écran

L'encoche est présente sur chaque écran et suit les branchements et débranchements de moniteurs. Elle doit rester fluide et ne jamais gêner l'utilisation normale de l'ordinateur.

- **Pastille de repos** : affiche selon le contexte le minuteur en cours, la musique (titre, artiste, courbes animées au rythme du son), la session de focus ou l'activité de l'assistant.
- **Fine barre** : quand une fenêtre se trouve sous l'encoche (mode « Automatique »), elle se réduit à un trait ; ce comportement est réglable (Automatique, Toujours, Jamais).
- **Ouverture au survol** avec un court délai pour éviter les ouvertures accidentelles ; fermeture quand la souris s'en va, sauf si l'utilisateur est en train d'écrire.
- **Clics traversants** : en dehors de la zone visible de l'encoche, les clics atteignent les fenêtres situées dessous.
- **Plein écran** : l'encoche se cache quand une application passe en plein écran.
- **Alertes** : un rappel arrivé à échéance s'affiche dans l'encoche avec ses boutons d'action.

### 4.2 Aujourd'hui

Tableau de bord de la journée : horloge et date, temps travaillé, calendrier de la semaine avec les prochaines échéances, lancement rapide d'un focus et liste des tâches du jour.

### 4.3 Contrôles

Ce module donne la main sur le multimédia et quelques actions système sans quitter son travail.

- **Lecteur** : pochette, titre, artiste, application source (Spotify, YouTube, Deezer…), barre de progression cliquable, lecture/pause, piste précédente et suivante, aléatoire et répétition.
- **Volume** du système, avec coupure du son.
- **Raccourcis** : capture d'écran, verrouillage de la session, dossier Téléchargements, calculatrice.

Sans musique en cours, le module se compacte pour garder des proportions équilibrées.

### 4.4 Tâches

Liste des tâches de l'utilisateur, rattachées ou non à un projet.

- Ajout rapide, case à cocher, suppression.
- **Date d'échéance** optionnelle, avec raccourcis « Aujourd'hui » et « Demain » ; mise en évidence des tâches du jour et des tâches en retard ; tri par échéance.
- Filtre par projet, statistiques du jour et graphique des tâches terminées dans la semaine.

### 4.5 Projets

Le module Projets s'adapte au **type d'usage** choisi par l'utilisateur (voir 4.6).

- **Fiche projet** : nom, couleur, client ou matière (facultatif), prix et devise (facultatifs), statut, date de début, deadline, notes, temps passé, tâches.
- **Statuts** : À démarrer, En cours, En pause, puis selon l'usage Attente de paiement et Payé, ou Rendu, ou Terminé.
- **Vue d'ensemble** : montants en cours, montant à encaisser (ou tâches restantes), prochaine échéance, filtres par statut.
- **Clients** (ou **Matières**) : regroupement des projets, temps passé, argent reçu et reste dû ; le client se choisit dans la liste des clients existants ou se crée en tapant un nouveau nom. L'espace n'apparaît que s'il existe au moins un client.
- **Extras** (freelance) : fonctionnalités ou modules ajoutés après coup, chacun avec son prix et, si besoin, ses propres tâches. Leur prix s'ajoute au total du projet.
- **Paiements** (freelance) : enregistrement des acomptes et paiements reçus avec leur date ; affichage du payé et du reste dû. Un projet livré entièrement payé passe automatiquement au statut Payé ; passer manuellement un projet en Payé enregistre le solde.

### 4.6 Types d'usage

L'utilisateur choisit une fois pour toutes à quoi lui servent ses projets ; l'interface n'affiche alors que ce qui a du sens. Changer de type ne supprime aucune donnée.

- **Freelance** : clients, prix, extras, paiements, relances.
- **Études** : le client devient la **matière**, la deadline devient la **date de rendu**, plus aucune notion d'argent, statut final « Rendu ».
- **Perso** : ni client ni prix, statut final « Terminé », échéances.

Le choix est proposé à la création du premier projet et reste modifiable dans les réglages.

### 4.7 Temps

Suivi du temps de travail par projet.

- Plusieurs minuteurs peuvent tourner en parallèle, chacun pouvant être mis en pause ou arrêté.
- Vues jour, semaine et mois avec graphique et répartition par projet.
- **Pause automatique** après une période d'inactivité réglable (le temps d'absence n'est pas compté), avec reprise automatique au retour.

### 4.8 Focus

Le mode focus aide à rester concentré pendant une durée choisie.

- **Réglage** de la durée au cadran (glisser à la souris, molette) ou par boutons, choix du projet, du **budget de repos et de distraction** et du comportement en cas de dépassement.
- **Détection** : la fenêtre au premier plan est comparée chaque seconde à une liste de distractions modifiable (YouTube, Netflix, réseaux sociaux…). L'inactivité prolongée (une minute sans clavier ni souris) est comptée comme du repos.
- **Au dépassement du budget** : notification et encoche en rouge (mode Alerter), ou réduction automatique de la fenêtre qui distrait (mode Bloquer).
- **Pendant la session** : grand minuteur, état de concentration, pourcentage de concentration, consommation du budget et liste des distractions. Dans la pastille, l'étiquette « Focus » et, uniquement pendant une pause ou une distraction, le temps de repos restant.
- **Fin de session réussie** : la mascotte sourit et sautille, avec des confettis, puis un bilan s'affiche.

### 4.9 Rappels

Rappels datés, ponctuels ou répétés (chaque jour, jours ouvrés, chaque semaine, chaque mois), éventuellement liés à un projet. À l'échéance, l'encoche s'ouvre sur le rappel avec les actions « Fait » et « Plus tard », et une notification Windows est envoyée.

### 4.10 Assistant IA

L'assistant permet de piloter Mégatron en langage naturel. L'utilisateur fournit sa propre clé d'accès auprès du fournisseur de son choix ; aucun abonnement n'est imposé.

- **Fournisseurs** : Gemini (offre gratuite), Claude, OpenAI, ou tout service compatible OpenAI. Le modèle le moins coûteux est sélectionné par défaut et la liste des modèles est triée du moins cher au plus cher.
- **Actions** : créer, cocher et supprimer des tâches, créer un projet, changer son statut, le supprimer (après confirmation), ajouter un extra, enregistrer un paiement, démarrer ou arrêter un minuteur, lancer un focus, créer un rappel, consulter le temps travaillé, ouvrir une application, un site ou un dossier, chercher sur le web, contrôler la musique et le volume.
- **Fichiers joints** : l'utilisateur peut glisser un fichier sur la discussion ou le choisir avec un trombone (images, PDF, Word, Excel, texte et code, 20 Mo au maximum, dix à la fois). L'assistant s'en sert pour agir : créer un projet à partir d'un brief, des tâches à partir d'une liste, résumer un document. L'historique ne garde que le nom des fichiers.
- **Conversation conservée** entre deux lancements tant que l'utilisateur ne la réinitialise pas, et **synchronisée en direct** entre les encoches, la fenêtre Mégatron et Telegram.
- **Apprentissage** (activable) : l'assistant retient les informations durables que l'utilisateur lui donne (tarifs, clients habituels, préférences) et s'en sert ensuite. Ces notes sont consultables et effaçables. Les informations sensibles (mots de passe, clés, données bancaires) ne sont jamais retenues.

### 4.11 Voix

- **Dictée** : un appui long sur le raccourci ou un clic sur le micro pour parler à l'assistant.
- **« Salut Mégatron »** (ou « Hey », « Hé », « Dis », « OK », « Bonjour »… Mégatron) : mot d'éveil reconnu localement par Windows. Il déclenche une **conversation continue** affichée dans une pastille vocale animée, sans texte : l'assistant répond à voix haute puis réécoute. La conversation se termine quand l'utilisateur prend congé, quelle que soit sa formule (l'assistant le comprend lui-même), ou après quelques secondes de silence. Un clic sur la pastille ouvre la discussion complète.
- **Couper la parole** : pendant que l'assistant parle, il écoute déjà ; si l'utilisateur parle par-dessus, il se tait et prend en compte la nouvelle demande.
- **Fichier à la voix** : quand l'utilisateur annonce un fichier, la pastille se transforme en zone de dépôt ; le fichier glissé dessus part aussitôt à l'assistant.
- **Fiabilité du mot d'éveil** : l'écoute est surveillée et relancée automatiquement si Windows l'interrompt. Une **sensibilité** réglable et un **mode test** (qui affiche ce que Windows entend, sans rien déclencher) permettent de l'ajuster.
- **Voix de l'assistant** : voix de Windows (gratuites et hors ligne), voix Azure (offre gratuite de 500 000 caractères par mois), ou voix Gemini et OpenAI. Vitesse, hauteur, ton et volume sont réglables. En cas de quota atteint, l'assistant passe automatiquement sur la voix de Windows.

### 4.12 Téléphone (Telegram)

Le bot Telegram de l'utilisateur relie Mégatron à son téléphone.

- **Mise en place** : création du bot auprès de @BotFather, saisie de sa clé, puis liaison par un lien ou un code d'appairage. Le bot n'obéit qu'au compte relié.
- **Notifications** activables une à une : rappels avec boutons « Fait » et « +10 min », fin de focus et dépassement du repos, minuteur oublié depuis plus de quatre heures, projets en attente de paiement chaque lundi.
- **Discussion** avec l'assistant par écrit, par message vocal ou en lui envoyant une photo ou un document, avec les mêmes outils et la même mémoire.
- **Résumé du soir** optionnel : temps de travail, tâches faites et en retard, programme du lendemain, montant à encaisser.
- **Commandes rapides** : /taches, /temps, /focus, /rappels, /aide.

### 4.13 Fenêtre Mégatron et réglages

La fenêtre Mégatron s'ouvre par un double-clic sur l'icône de la zone de notification (clic droit : Ouvrir, Réglages, Quitter). Elle propose les pages Tâches, Projets, IA et Réglages. Les réglages sont organisés en Général (type d'usage, démarrage avec Windows, fine barre, thème clair, sombre ou système, pause automatique), IA (fournisseur, voix, mot d'éveil, apprentissage), Focus, Téléphone, Données et À propos.

### 4.14 Données

- Sauvegarde complète en un fichier JSON et restauration à partir de ce fichier.
- Les clés API ne font jamais partie des sauvegardes.

## 5. Parcours utilisateur

### Une journée de freelance

Le matin, l'utilisateur allume son ordinateur ; Mégatron démarre avec Windows et son encoche apparaît en haut de chaque écran. En la survolant, il ouvre l'onglet Aujourd'hui et voit ses tâches du jour et sa prochaine deadline. Il lance le minuteur du projet « Site Atelier Lune » ; la pastille affiche désormais le temps qui tourne.

Il lance ensuite un focus de cinquante minutes avec cinq minutes de repos autorisées. Pendant la session, il s'égare sur YouTube : l'encoche, rangée en fine barre au-dessus de son navigateur, passe à l'orange puis au rouge quand le budget est épuisé. À la fin, Mégatron sourit et fait pleuvoir des confettis.

En fin de matinée, le client demande une page blog en plus. L'utilisateur dit « Salut Mégatron » ; la pastille vocale apparaît et l'assistant lui répond « Oui, qu'est-ce que tu veux ? ». Il demande d'ajouter un extra « Page blog » à 300 € sur le projet, découpé en maquette et intégration, puis conclut par « à tout à l'heure » : l'assistant lui dit au revoir et la pastille se range. Un peu plus tard, il glisse le brief envoyé par le client dans la discussion et demande d'en tirer les tâches. L'après-midi, le client verse un acompte ; l'utilisateur l'enregistre dans l'onglet Paiements et voit immédiatement le reste dû.

Le soir, loin de son bureau, il reçoit sur Telegram son résumé de la journée et répond par un message vocal pour ajouter une tâche au lendemain.

### Un étudiant

À la première ouverture de l'onglet Projets, l'étudiant choisit le type « Études ». Il crée un projet « Exposé de marketing » dans la matière « Marketing », avec sa date de rendu. Mégatron n'affiche ni prix ni paiements ; l'espace « Matières » montre le temps passé sur chaque cours. Quand l'exposé est rendu, il passe le projet au statut « Rendu ».

## 6. Rôles et permissions

L'application est mono-utilisateur : toutes les fonctions sont accessibles à la personne qui l'utilise sur son ordinateur. Le bot Telegram n'accepte que le compte relié lors de l'appairage ; les messages de tout autre compte sont ignorés.

## 7. Contraintes techniques

- **Plateforme** : Windows 10 et 11. L'application s'appuie sur des fonctions propres à Windows (contrôle multimédia, volume, reconnaissance vocale, Gestionnaire d'identification, fenêtres).
- **Fluidité** : animations à 60 images par seconde, ouverture de l'encoche sans saccade, consommation discrète en arrière-plan.
- **Confidentialité** : base de données locale, clés API dans le Gestionnaire d'identification Windows, mot d'éveil reconnu localement. Seules les demandes adressées à l'IA, aux voix en ligne et au bot Telegram quittent l'ordinateur, vers les services choisis par l'utilisateur.
- **Coûts** : l'application doit rester utilisable gratuitement (Gemini gratuit, voix Windows ou Azure gratuites) et privilégier par défaut les options les moins chères.
- **Dépendance au PC** : les notifications et la discussion Telegram ne fonctionnent que lorsque l'ordinateur est allumé et Mégatron lancé.
- **Langue** : interface entièrement en français.

## 8. Livrables attendus

- Une application Windows installable comprenant l'encoche multi-écran, la fenêtre Mégatron et l'icône de la zone de notification.
- L'ensemble des modules décrits : Aujourd'hui, Contrôles, Tâches, Projets (avec clients, extras et paiements), Temps, Focus, Rappels, Assistant IA, voix, Telegram, réglages et sauvegarde.
- Le code source versionné, accompagné d'un README et d'un guide technique pour la reprise du projet.
- L'identité visuelle : logo, déclinaison « yeux seuls » et mascotte animée.

## 9. Évolutions envisagées

- Installateur Windows et mises à jour automatiques.
- Saisie et correction manuelles des sessions de temps.
- Code QR pour relier le téléphone en un geste.
- Facturation : génération de devis et de factures à partir des projets et des extras.

## 10. Conclusion

Mégatron réunit dans une encoche discrète tout ce qu'un indépendant, un étudiant ou un porteur de projets personnels consulte vingt fois par jour : ses tâches, son temps, sa concentration, ses rappels et l'argent qu'on lui doit. Son assistant, à l'écrit, à la voix ou depuis le téléphone, transforme ces outils en un compagnon de travail qui agit plutôt que de simplement afficher. Le tout reste sur l'ordinateur de l'utilisateur, sous son contrôle.
