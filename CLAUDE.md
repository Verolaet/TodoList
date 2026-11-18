# Contexte projet — « Mes tâches » (to-do list Pro / Perso)

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
- Tâche : case à 3 états (vide → trait → coché, au clic), titre obligatoire, échéance, priorité, étiquette, sous-tâches (même case à 3 états).
- Cocher une tâche termine toutes ses sous-tâches. L'inverse n'est pas automatique.
- Terminées : barrées, regroupées en bas ; bouton « Supprimer les terminées » (avec confirmation) qui supprime les tâches parentes terminées et leurs sous-tâches.
- Tris : personnalisé (glisser-déposer, uniquement dans ce mode), par échéance, par priorité ; mémorisé par espace.
- Saisie rapide au clavier ou à la dictée (Web Speech API, fr-FR) ; reconnaissance des dates en français (`dateparse.js` : « demain », « pour vendredi », « le 25 », « 3 décembre », « dans 3 jours »…). Les nouvelles tâches sont ajoutées en haut.
- Édition complète d'une tâche au clic (titre, statut, échéance, priorité, étiquette, sous-tâches).
- Raccourcis d'icône (appui long) : « Nouvelle tâche Pro / Perso » (`?new=pro|perso`).
- Export CSV (séparateur `;`, BOM UTF-8 pour Excel). Import CSV prévu en V2.
- Hors périmètre : rappels, notifications, multi-étiquettes.

## Couleurs (validées, variables en haut de `styles.css`)
- Pro clair : fond #CECBF6, accent #534AB7. Pro sombre : fond #3B2659, carte #2A1B40, accent #C4A8F0.
- Perso clair : fond #F5C4B3, accent #993C1D. Perso sombre (corail rosé) : fond #5E2A3A, carte #421D29, accent #FF9E9A.
- Le rendu diffère entre téléphone et PC : ajuster en conditions réelles si Laetitia le demande.

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

## Préférences de Laetitia
- Poser des questions de clarification avant de se lancer si nécessaire ; réponses structurées en puces.
- Signaler les risques plutôt que de décider en silence.
