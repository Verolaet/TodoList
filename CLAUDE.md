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
- Hors ligne : cache Firestore persistant (IndexedDB) + service worker (`sw.js`, stale-while-revalidate).
  Version : `version.js` (`APP_BUILD`, `APP_DATE`). Affichée « Version du jj/mm/aaaa hh:mm » (sans numéro, demande de Laetitia)
  en pied de page, dans les Réglages et sur l'écran de connexion ;
  `sw.js` l'importe et nomme son cache `todo-v<APP_BUILD>`. Le hook `.githooks/pre-commit` augmente le numéro et met la date/heure
  à chaque commit (activer après un clone : `git config core.hooksPath .githooks`). Un dépôt via l'upload web de GitHub ne passe pas par le hook :
  augmenter alors `APP_BUILD` à la main, sinon les appareils ne se mettent pas à jour.
  GitHub Pages envoie `Cache-Control: max-age=600` : le SW installe avec `cache: 'reload'` et revérifie nos fichiers en `no-cache`.
  `app.js` recharge la page au `controllerchange` (sauf saisie en cours) et cherche une mise à jour à chaque retour au premier plan.
- Dépendances CDN : Firebase JS SDK 11.0.2 (gstatic, modules ES), SortableJS 1.15.2 (cdnjs).
- La config Firebase (`config.js`) est publique par conception ; la sécurité repose sur les règles Firestore.

## Modèle de données
- `users/{uid}/tasks/{id}` : `space` ('pro'|'perso'|'demo'), `title`, `status` (0 non démarrée, 1 en cours, 2 terminée, 3 en pause),
  `pausedAt` (date de mise en pause, null sinon), `due` ('YYYY-MM-DD'|null),
  `priority` (1 haute, 2 moyenne, 3 basse | null), `label` (string|null, tâches parentes seulement), `parentId` (null | id de la tâche parente),
  `position` (number, ordre personnalisé), `createdAt`, `updatedAt`, `completedAt`.
- `users/{uid}/meta/settings` : `sort` { pro, perso, demo } ∈ 'custom'|'due'|'priority'.
- Thème (auto/clair/sombre), espace courant (`space`, y compris 'demo'), dernier espace réel (`lastSpace`, retrouvé en fermant la démo), sous-tâches repliées, sections « En pause » et « Terminées » repliées : localStorage (par appareil).
- Les instantanés Firestore sont lus avec `serverTimestamps: 'estimate'` (dates estimées tant que le serveur n'a pas confirmé).

## Spécification fonctionnelle (validée)
- 2 espaces cloisonnés Perso / Pro (onglets, Perso en premier et par défaut ; même ordre pour les raccourcis d'icône). Une seule liste par espace, filtrable par étiquette (1 étiquette max par tâche, propre à l'espace).
- Nom de l'appli : « Laeti’s todo » (apostrophe typographique ; manifest `name` et `short_name`, titre de la page, écran de connexion).
  Écran de démarrage Android : `background_color` et `theme_color` = #FFA9A8 (rose de l'icône).
- Tâche : case à 3 états (vide → trait → coché, au clic), titre obligatoire, échéance, priorité, étiquette, sous-tâches (même case à 3 états).
- Priorité : drapeau à droite de la case (tâches et sous-tâches) — rouge haute, orange moyenne, neutre basse ou aucune.
  Un appui sur le drapeau fait neutre → haute → moyenne → neutre (« basse » se règle dans la fiche).
- Glisser une tâche vers la droite (ailleurs que sur la poignée) : elle devient la dernière sous-tâche de la tâche du dessus et perd son étiquette.
  Refusé (message) si elle a déjà des sous-tâches : un seul niveau de sous-tâches. Glisser une sous-tâche vers la gauche : elle redevient
  une tâche, placée juste après son ancienne parente, et reprend l'étiquette de celle-ci. Seuil 48 px (64 était trop long vers la gauche sur téléphone) ; fonctionne au doigt et à la souris.
- Les poignées ⠿ des tâches n'apparaissent qu'en tri « Personnalisé » (celles des sous-tâches, toujours).
- En pause (statut 3, validé le 18/11/2026, présentation « section à part ») : case en pointillés avec ‖, titre grisé non barré,
  puce courte « ‖ depuis … » (aujourd'hui / hier / le 3 nov.). Appui long sur la case (550 ms ; clic droit sur PC) : met en pause / reprend (→ en cours) ;
  aussi via Statut dans la fiche. Appui simple sur une case en pause : reprend (→ en cours). Le cycle normal reste 0 → 1 → 2.
  Les tâches parentes en pause vont dans la section repliable « En pause (n) » entre la liste et les terminées
  (repli mémorisé par appareil : localStorage `pausedCollapsed`), sans poignée ni glisser. Les sous-tâches gardent leur propre statut.
- Cocher une tâche termine toutes ses sous-tâches (y compris en pause). L'inverse n'est pas automatique.
- Terminées : barrées et en italique, regroupées en bas dans une section repliable « Terminées (n) » (repli mémorisé par appareil : `doneCollapsed`) ; bouton « Supprimer les terminées » (avec confirmation) qui supprime les tâches parentes terminées et leurs sous-tâches.
- Tris : personnalisé (glisser-déposer, uniquement dans ce mode), par échéance, par priorité ; mémorisé par espace.
- Saisie rapide (validée par la touche Entrée, pas de bouton « + ») au clavier ou à la dictée (Web Speech API, fr-FR) ; reconnaissance des dates en français (`dateparse.js` : « demain », « pour vendredi », « le 25 », « 3 décembre », « dans 3 jours »…). Les nouvelles tâches sont ajoutées en haut.
- Édition complète d'une tâche au clic (titre, statut, échéance, priorité, étiquette, sous-tâches).
  Fiche (validée le 19/11/2026) : barre fixe en haut ✕ (fermer sans enregistrer) · titre « Tâche »/« Sous-tâche » · 🗑 · ✓ Enregistrer,
  pour rester visible quand le clavier du téléphone est ouvert. Plein écran sur téléphone (≤ 640 px), fenêtre centrée sur PC.
  À l'ouverture sur écran tactile (`pointer: coarse`), le focus va sur le titre de la barre (pas de clavier) ; sur PC, dans le champ Titre.
  Entrée dans le titre = Enregistrer. Viewport `interactive-widget=resizes-content` : la page se réduit au-dessus du clavier.
  Les sous-tâches de la fiche restent enregistrées immédiatement (ajout, titre, suppression).
- Suppression (validée le 19/11/2026) : 🗑 dans la fiche (et pour chaque sous-tâche) = suppression immédiate, sans confirmation,
  avec « Annuler » dans le message en bas pendant 6 s (les documents sont recréés à l'identique, mêmes id).
  Le message s'affiche dans la fenêtre ouverte s'il y en a une (le reste de la page est alors inactif).
  « Supprimer les terminées » garde sa confirmation. Idée gardée pour plus tard : titre modifiable dans la liste avec ✕ (à la Keep).
- Mode démo (validé le 19/11/2026) : icône fiole dans l'en-tête, à gauche des Réglages ; ouvre/ferme un 3e espace `demo`
  (mêmes données Firebase, cloisonné comme Pro/Perso). En démo, les onglets Perso/Pro sont remplacés par « Démo » (pour montrer l'appli),
  l'export CSV est masqué et Réglages propose « Réinitialiser la démo » (avec confirmation). Si la démo est vide à son ouverture,
  elle est remplie d'exemples (échéances dont une en retard, priorités, étiquettes, sous-tâches, en pause, terminées).
  La démo n'est jamais exportée. Un appui sur la fiole suffit à sortir de la démo (choix assumé : pas de verrou).
- Raccourcis d'icône (appui long) : « Nouvelle tâche Pro / Perso » (`?new=pro|perso`).
- Export CSV (séparateur `;`, BOM UTF-8 pour Excel), dans Réglages (validé le 20/11/2026) :
  - « Exporter l’espace Pro/Perso » (lisible, ex. pour un point avec sa cheffe) : l'espace affiché, toutes étiquettes (le filtre
    à l'écran est ignoré), dans l'ordre de l'écran (liste selon le tri, puis en pause, puis terminées). Colonnes : N°, Titre, Priorité,
    État, Échéance, Étiquette, Créée le, En pause depuis, Terminée le ; dates jj/mm/aaaa. Case « Inclure les sous-tâches »
    décochée à chaque ouverture des Réglages ; les sous-tâches suivent leur parente (« ↳ titre ») et reprennent son étiquette.
    N° = numéro de ligne, pour retrouver l'ordre après un tri dans Excel. Un texte commençant par = + - @ est préfixé d'une apostrophe
    (sinon Excel le prend pour une formule).
  - « Sauvegarde complète Pro + Perso » : toutes les données techniques (id, parente, position, dates ISO). Base de l'import CSV prévu en V2.
- Hors périmètre : rappels, notifications, multi-étiquettes.

## Couleurs (validées, variables en haut de `styles.css`)
- Pro clair : fond #CECBF6, accent #534AB7. Pro sombre : fond #3B2659, carte #2A1B40, accent #C4A8F0.
- Perso clair : fond #F5C4B3, accent #993C1D. Perso sombre (corail rosé) : fond #5E2A3A, carte #421D29, accent #FF9E9A.
- Démo (vert sauge) clair : fond #C8E3D2, accent #2E6B50. Démo sombre : fond #23493B, carte #183429, accent #98D8B6.
- Le rendu diffère entre téléphone et PC : ajuster en conditions réelles si Laetitia le demande.

## Icône (validée le 18/11/2026)
- Modèle « Bonbon » : dégradé rose #FF8FB1 → pêche #FFC3A0, case blanche inclinée avec coche rose #FF6F9C, étoiles dorées #FFE27A.
- Version ronde à coins transparents pour le PC (`icons/icon.svg` → `icon-192.png`, `icon-512.png`) ;
  version pleine pour Android (`icons/icon-maskable.svg` → `icon-maskable-512.png`, dessin réduit à 78 % pour rester dans la zone sûre).
- PNG générées avec Chrome en mode headless (`--screenshot`, `--default-background-color=00000000`). Raccourcis `sc-pro.png` / `sc-perso.png` inchangés.

## État au 18/11/2026
- En ligne sur https://verolaet.github.io/TodoList/ (GitHub Pages, branche main, racine). Connexion et création de tâches validées sur PC.
- Domaine `verolaet.github.io` autorisé dans Firebase Auth. Règles Firestore : accès réservé à l'UID du compte Google principal
  (copie dans `firestore.rules`). Ne jamais écrire d'adresse e-mail réelle dans le dépôt (il est public).
- Les fichiers ont été déposés via l'upload web de GitHub (pas de `.nojekyll`, non bloquant).

## Reste à faire
0. Valider l'export lisible dans Excel (dates reconnues, tri, retour à l'ordre par N°).
0. Valider sur Android (version du 19/11/2026) : fiche avec le clavier ouvert, poubelle + « Annuler », mode démo.
1. Valider sur Android : connexion, synchro avec le PC, installation de la PWA, dictée.
2. Test de sécurité : un autre compte Google doit voir « non autorisé ».
3. Conseillé : ajouter l'adresse principale comme Propriétaire du projet Firebase (pérennité).
4. Ajuster les couleurs en conditions réelles si besoin (rendu différent téléphone / PC).
5. V2 : import CSV.

## Sécurité (vérifiée le 18/11/2026)
- Constaté : HTTPS forcé + HSTS (GitHub) ; Firestore refuse toute lecture sans connexion (403 sur `users` et sur une requête
  globale `tasks`) ; Storage non activé ; Realtime Database introuvable aux adresses par défaut.
- En place : `noindex` (meta robots, pas de robots.txt possible pour un site de projet GitHub Pages), refus d'affichage dans un cadre
  (anti-clickjacking, en JS car GitHub Pages ne permet pas d'en-têtes), SRI sur SortableJS, identifiants Firestore filtrés,
  textes échappés (`esc`) avant tout `innerHTML`.
- Non faisable sur GitHub Pages : en-têtes CSP / X-Frame-Options / X-Content-Type-Options. Une CSP en `<meta>` est possible mais
  doit être validée par une vraie connexion Google (risque de casser la connexion).
- Le dépôt est public : les adresses e-mail réelles ont été retirées des fichiers le 18/11/2026 (règles basées sur l'UID),
  mais restent dans l'historique Git (choix de Laetitia : pas de réécriture de l'historique). Commits signés avec l'adresse noreply.
- Pas de scan OWASP ZAP effectué (un scan actif viserait les serveurs de GitHub ; l'essentiel du risque est côté règles Firebase).

## Tester sans toucher aux vraies données
- Une page de test peut remplacer Firebase par une fausse base en mémoire : carte d'import (`importmap`) qui redirige les 3 modules
  gstatic vers des faux modules, service worker neutralisé, servie en local (ex. serveur PowerShell `HttpListener` sur localhost).

## Préférences de Laetitia
- Poser des questions de clarification avant de se lancer si nécessaire ; réponses structurées en puces.
- Signaler les risques plutôt que de décider en silence.
