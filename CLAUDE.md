# Contexte projet — « Laeti’s todo » (to-do list Pro / Perso, dépôt TodoList)

Appli personnelle de Laetitia (ancienne développeuse), pour remplacer Todoist et Google Keep.
Usage : Android (Chrome) + PC, tous deux en mode sombre. Répondre en français.

## Architecture (décidée)
- PWA statique en JS vanilla, sans étape de build. Hébergement : GitHub Pages (dépôt public `Verolaet/TodoList`, branche `main`, racine).
  URL cible : https://verolaet.github.io/TodoList/
- Données : Firebase, projet `db-noteslag`, forfait Spark (gratuit, sans carte bancaire). Firestore en région europe-west9 (Paris).
  Le projet contient aussi une Realtime Database inutilisée : ne pas l'utiliser.
- Auth : connexion Google (Firebase Auth), session persistante. Un seul compte autorisé via `firestore.rules` (adresse e-mail à renseigner).
- Le compte qui administre Firebase (adresse secondaire) est distinct du compte de connexion à l'appli (adresse principale).
- Hors ligne : cache Firestore persistant (IndexedDB) + service worker (`sw.js`, stale-while-revalidate). Penser à incrémenter `CACHE` dans `sw.js` à chaque livraison.
  GitHub Pages envoie `Cache-Control: max-age=600` : le SW installe avec `cache: 'reload'` et revérifie nos fichiers en `no-cache`.
  `app.js` recharge la page au `controllerchange` (sauf saisie en cours) et cherche une mise à jour à chaque retour au premier plan.
- Dépendances CDN : Firebase JS SDK 11.0.2 (gstatic, modules ES), SortableJS 1.15.2 (cdnjs).
- La config Firebase (`config.js`) est publique par conception ; la sécurité repose sur les règles Firestore.

## Modèle de données
- `users/{uid}/tasks/{id}` : `space` ('pro'|'perso'), `title`, `status` (0 non démarrée, 1 en cours, 2 terminée), `due` ('YYYY-MM-DD'|null),
  `priority` (1 haute, 2 moyenne, 3 basse | null), `label` (string|null, tâches parentes seulement), `parentId` (null | id de la tâche parente),
  `position` (number, ordre personnalisé), `createdAt`, `updatedAt`, `completedAt`.
- `users/{uid}/meta/settings` : `sort` { pro, perso } ∈ 'custom'|'due'|'priority'.
- Thème (auto/clair/sombre), espace courant et sous-tâches repliées : localStorage (par appareil).

## Spécification fonctionnelle (validée)
- 2 espaces cloisonnés Pro / Perso (onglets). Une seule liste par espace, filtrable par étiquette (1 étiquette max par tâche, propre à l'espace).
- Nom de l'appli : « Laeti’s todo » (apostrophe typographique ; manifest `name` et `short_name`, titre de la page, écran de connexion).
  Écran de démarrage Android : `background_color` et `theme_color` = #FFA9A8 (rose de l'icône).
- Tâche : case à 3 états (vide → trait → coché, au clic), titre obligatoire, échéance, priorité, étiquette, sous-tâches (même case à 3 états).
- Priorité : drapeau à droite de la case (tâches et sous-tâches) — rouge haute, orange moyenne, neutre basse ou aucune.
  Un appui sur le drapeau fait neutre → haute → moyenne → neutre (« basse » se règle dans la fiche).
- Glisser une tâche vers la droite (ailleurs que sur la poignée) : elle devient la dernière sous-tâche de la tâche du dessus et perd son étiquette.
  Refusé (message) si elle a déjà des sous-tâches : un seul niveau de sous-tâches. Glisser une sous-tâche vers la gauche : elle redevient
  une tâche, placée juste après son ancienne parente, et reprend l'étiquette de celle-ci. Seuil 64 px ; fonctionne au doigt et à la souris.
- Cocher une tâche termine toutes ses sous-tâches. L'inverse n'est pas automatique.
- Terminées : barrées et en italique, regroupées en bas ; bouton « Supprimer les terminées » (avec confirmation) qui supprime les tâches parentes terminées et leurs sous-tâches.
- Tris : personnalisé (glisser-déposer, uniquement dans ce mode), par échéance, par priorité ; mémorisé par espace.
- Saisie rapide (validée par la touche Entrée, pas de bouton « + ») au clavier ou à la dictée (Web Speech API, fr-FR) ; reconnaissance des dates en français (`dateparse.js` : « demain », « pour vendredi », « le 25 », « 3 décembre », « dans 3 jours »…). Les nouvelles tâches sont ajoutées en haut.
- Édition complète d'une tâche au clic (titre, statut, échéance, priorité, étiquette, sous-tâches).
- Raccourcis d'icône (appui long) : « Nouvelle tâche Pro / Perso » (`?new=pro|perso`).
- Export CSV (séparateur `;`, BOM UTF-8 pour Excel). Import CSV prévu en V2.
- Hors périmètre : rappels, notifications, multi-étiquettes.

## Couleurs (validées, variables en haut de `styles.css`)
- Pro clair : fond #CECBF6, accent #534AB7. Pro sombre : fond #3B2659, carte #2A1B40, accent #C4A8F0.
- Perso clair : fond #F5C4B3, accent #993C1D. Perso sombre (corail rosé) : fond #5E2A3A, carte #421D29, accent #FF9E9A.
- Le rendu diffère entre téléphone et PC : ajuster en conditions réelles si Laetitia le demande.

## Icône (validée le 18/11/2026)
- Modèle « Bonbon » : dégradé rose #FF8FB1 → pêche #FFC3A0, case blanche inclinée avec coche rose #FF6F9C, étoiles dorées #FFE27A.
- Version ronde à coins transparents pour le PC (`icons/icon.svg` → `icon-192.png`, `icon-512.png`) ;
  version pleine pour Android (`icons/icon-maskable.svg` → `icon-maskable-512.png`, dessin réduit à 78 % pour rester dans la zone sûre).
- PNG générées avec Chrome en mode headless (`--screenshot`, `--default-background-color=00000000`). Raccourcis `sc-pro.png` / `sc-perso.png` inchangés.

## État au 18/11/2026
- En ligne sur https://verolaet.github.io/TodoList/ (GitHub Pages, branche main, racine). Connexion et création de tâches validées sur PC.
- Domaine `verolaet.github.io` autorisé dans Firebase Auth. Règles Firestore publiées pour laetih01@gmail.com (copie dans `firestore.rules`).
- Les fichiers ont été déposés via l'upload web de GitHub (pas de `.nojekyll`, non bloquant).

## Reste à faire
1. Valider sur Android : connexion, synchro avec le PC, installation de la PWA, dictée.
2. Test de sécurité : un autre compte Google doit voir « non autorisé ».
3. Conseillé : ajouter l'adresse principale comme Propriétaire du projet Firebase (pérennité).
4. Ajuster les couleurs en conditions réelles si besoin (rendu différent téléphone / PC).
5. V2 : import CSV.

## Tester sans toucher aux vraies données
- Une page de test peut remplacer Firebase par une fausse base en mémoire : carte d'import (`importmap`) qui redirige les 3 modules
  gstatic vers des faux modules, service worker neutralisé, servie en local (ex. serveur PowerShell `HttpListener` sur localhost).

## Préférences de Laetitia
- Poser des questions de clarification avant de se lancer si nécessaire ; réponses structurées en puces.
- Signaler les risques plutôt que de décider en silence.
