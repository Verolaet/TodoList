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
  Corrigé le 23/11/2026 (roue sans fin à l'ouverture, en mode avion comme avec un réseau faible) — 2 causes :
  - Les bibliothèques externes (3 modules Firebase, SortableJS) n'entraient dans le cache qu'au passage et disparaissaient
    à chaque nouvelle version : sans elles, `app.js` ne s'exécute pas. Elles sont maintenant enregistrées à l'installation
    (liste `LIBS` de `sw.js`, À TENIR À JOUR si la version de Firebase ou de SortableJS change) et servies depuis le cache sans revérification.
  - Sur téléphone, `getAuth()` charge au démarrage le module de connexion Google (apis.google.com), sans limite de temps :
    avec un réseau faible, `onAuthStateChanged` n'arrivait jamais. « Démarrage rapide » : si l'indicateur localStorage `signedIn` est présent
    (session ouverte sur l'appareil), `initializeAuth` sans ce module ; la connexion lui passe `browserPopupRedirectResolver` explicitement.
    Sans session, `getAuth()` comme avant. Déconnexion pendant un démarrage rapide : rechargement (écran de connexion habituel).
    Il reste l'attente de Firebase Auth (vérification du compte) : 30 s au plus quand le réseau ne répond pas, puis l'appli s'ouvre hors ligne.
  - Écran de chargement (script sous `#loading` dans `index.html`) : message + « Réessayer » si `app.js` ne se charge pas ;
    message d'attente au bout de 10 s.
  Mesuré le 23/11/2026 (Chrome simulant un Pixel 7) : hors ligne, tâches affichées en 0,3 s ; réseau qui ne répond pas, 30 s.
  Version : `version.js` (`APP_BUILD`, `APP_DATE`). Affichée « Version du jj/mm/aaaa hh:mm » (sans numéro, demande de Laetitia)
  en pied de page, dans les Réglages et sur l'écran de connexion ;
  `sw.js` l'importe et nomme son cache `todo-v<APP_BUILD>`. Le hook `.githooks/pre-commit` augmente le numéro et met la date/heure
  à chaque commit (activer après un clone : `git config core.hooksPath .githooks`). Un dépôt via l'upload web de GitHub ne passe pas par le hook :
  augmenter alors `APP_BUILD` à la main, sinon les appareils ne se mettent pas à jour.
  Session Claude dans le cloud : l'horloge y est en UTC, le hook note donc l’heure avec 1 h de retard en hiver (2 h en été) :
  corriger `APP_DATE` à l'heure de Paris (`TZ=Europe/Paris date`) puis `git commit --amend --no-verify` (sinon le numéro augmente encore).
  GitHub Pages envoie `Cache-Control: max-age=600` : le SW installe avec `cache: 'reload'` et revérifie nos fichiers en `no-cache`.
  `app.js` recharge la page au `controllerchange` (sauf saisie en cours) et cherche une mise à jour à chaque retour au premier plan.
- Dépendances CDN : Firebase JS SDK 11.0.2 (gstatic, modules ES), SortableJS 1.15.2 (cdnjs).
- La config Firebase (`config.js`) est publique par conception ; la sécurité repose sur les règles Firestore.

## Modèle de données
- `users/{uid}/tasks/{id}` : `space` (identifiant de l'onglet : 'perso', 'pro', un identifiant aléatoire 't…' pour un onglet créé, ou 'demo'),
  `title`, `status` (0 non démarrée, 1 en cours, 2 terminée, 3 en pause),
  `pausedAt` (date de mise en pause, null sinon), `due` ('YYYY-MM-DD'|null),
  `priority` (1 haute, 2 moyenne, 3 basse | null), `label` (string|null, tâches parentes seulement), `parentId` (null | id de la tâche parente),
  `position` (number, ordre personnalisé), `createdAt`, `updatedAt`, `completedAt`.
- `users/{uid}/meta/settings` : `sort` { <id d'onglet> } ∈ 'custom'|'due'|'priority' ;
  `spaces` : liste ordonnée des onglets [{ id, name, theme }] (absente tant qu'aucun onglet n'a été modifié : Perso/corail puis Pro/violet).
  Relue avec vérification (`cleanSpaces` : 5 au plus, identifiants sûrs, nom ≤ 12 caractères, thème connu).
  Les règles Firestore ne regardent pas `space` : aucune modification côté Firebase pour les onglets.
- Thème (auto/clair/sombre), onglet courant (`space`, y compris 'demo'), dernier onglet réel (`lastSpace`, retrouvé en fermant la démo),
  couleur de l'onglet courant (`color`, lue par le script en tête de `index.html` pour éviter un éclair d'une autre couleur),
  sous-tâches repliées, sections « En pause » et « Terminées » repliées, indicateur de session `signedIn` (démarrage rapide) : localStorage (par appareil).
- Les instantanés Firestore sont lus avec `serverTimestamps: 'estimate'` (dates estimées tant que le serveur n'a pas confirmé).

## Spécification fonctionnelle (validée)
- Onglets configurables (validé le 21/11/2026) : de 1 à 5 onglets cloisonnés, plus la démo à part. Au départ Perso (corail) puis Pro (violet),
  qui sont des onglets comme les autres (renommables, supprimables). Une seule liste par onglet, filtrable par étiquette
  (1 étiquette max par tâche, propre à l'onglet). Tri, filtre et export : par onglet.
  - Réglages → Onglets : liste dans l'ordre (pastille, nom ✎, ↑, ↓, 🗑) et « + Ajouter un onglet » (masqué à 5).
    Fenêtre Nouvel onglet / Modifier l'onglet : nom obligatoire, 12 caractères au plus, sans doublon ; couleur parmi 8 thèmes,
    une couleur par onglet (celles déjà prises sont grisées). Liste synchronisée entre appareils (meta/settings.spaces).
  - En-tête : chaque onglet prend la largeur de son nom. Les onglets restent à côté de la fiole et des Réglages tant qu'ils tiennent
    (toujours sur PC) ; sinon ils passent sur leur propre ligne, sous « Laeti’s todo » (en 15 px, plus compacts).
    Mesuré le 21/11/2026 : sur 360 px de large, environ 33 lettres en tout tiennent sur cette ligne (le conseil affiché dit 30).
    Au-delà, ils se répartissent sur 2 lignes équilibrées (ex. 3 + 2, classe `wrapped`) au lieu d'être coupés (demande de Laetitia
    après essai sur son téléphone, 21/11/2026) ; « … » seulement si un nom ne tient pas dans sa case.
  - Fiche d'une tâche parente : champ « Onglet » pour la déplacer (masqué en démo et s'il n'y a qu'un onglet). Elle arrive en haut
    de la liste de l'onglet choisi, garde son étiquette ; ses sous-tâches la suivent.
  - Suppression d'un onglet : refusée s'il reste des tâches parentes non terminées (non démarrées, en cours ou en pause), avec un message ;
    s'il ne reste que des terminées, confirmation (« … seront supprimées avec l’onglet. Pense à exporter avant. ») puis suppression
    de l'onglet et de toutes ses tâches (sous-tâches comprises, même non terminées), sans « Annuler » ; onglet vide : simple confirmation.
    Le dernier onglet ne peut pas être supprimé. Si l'onglet ouvert disparaît (ici ou sur un autre appareil), le premier s'ouvre.
  - Au démarrage : le dernier onglet ouvert sur l'appareil.
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
- Tris : personnalisé (glisser-déposer, uniquement dans ce mode), par échéance, par priorité ; mémorisé par onglet.
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
- Mode démo (validé le 19/11/2026) : icône fiole dans l'en-tête, à gauche des Réglages ; ouvre/ferme un espace `demo` à part, vert sauge
  (mêmes données Firebase, cloisonné comme un onglet, hors des 5 onglets). En démo, les onglets sont remplacés par « Démo » (pour montrer l'appli).
  Si la démo est vide à son ouverture, elle est remplie d'exemples (échéances dont une en retard, priorités, étiquettes, sous-tâches, en pause, terminées).
  Un appui sur la fiole suffit à sortir de la démo (choix assumé : pas de verrou) ; on retrouve le dernier onglet réel.
- Réglages (validé le 21/11/2026) : plein écran sur téléphone avec barre fixe ✕ (comme la fiche), fenêtre centrée sur PC.
  Sections en blocs séparés et pliables (titre, résumé à droite, chevron) : Onglets (« 5 onglets »), Affichage (« Sombre »…),
  Export Excel, Sauvegarde, Compte (adresse en résumé seulement, pas répétée dedans ; « Se déconnecter », version). Toutes pliées à chaque ouverture, une seule dépliée à la fois.
  En démo : pas de sections Onglets ni Sauvegarde (vraies tâches) ; l'export ne propose que « Démo » ;
  section Démo avec « Réinitialiser la démo » (avec confirmation).
- Raccourci d'icône (appui long, validé le 21/11/2026) : un seul « Nouvelle tâche » (`?new=1`), dans le dernier onglet réel utilisé
  (jamais la démo). Les anciens `?new=pro|perso` restent acceptés (le téléphone peut garder les anciens raccourcis un moment).
- Export CSV (séparateur `;`, BOM UTF-8 pour Excel), dans Réglages (validé le 20/11/2026) :
  - Section « Export Excel » (lisible, ex. pour un point avec sa cheffe ; mise en page validée le 21/11/2026) : liste « Onglet à exporter »
    (sur l'onglet affiché par défaut), puis sur une ligne la case « Avec sous-tâches » et le bouton « Exporter ».
    Toutes étiquettes (le filtre à l'écran est ignoré), dans l'ordre de l'écran de cet onglet (liste selon son tri, puis en pause,
    puis terminées). Colonnes : N°, Titre, Priorité, État, Échéance, Étiquette, Créée le, En pause depuis, Terminée le ; dates jj/mm/aaaa.
    Case décochée à chaque ouverture des Réglages ; les sous-tâches suivent leur parente (« ↳ titre ») et reprennent son étiquette.
    Idée non retenue pour l'instant : « Tous les onglets » dans la liste (avec une colonne Onglet).
    N° = numéro de ligne, pour retrouver l'ordre après un tri dans Excel. Un texte commençant par = + - @ est préfixé d'un espace
    (sinon Excel le prend pour une formule ; une apostrophe resterait visible dans Excel, testé le 21/11/2026).
    Fichier `taches-<nom de l'onglet sans accents>-AAAA-MM-JJ.csv`.
  - Section « Sauvegarde », bouton « Télécharger la sauvegarde » (fichier `sauvegarde-taches-AAAA-MM-JJ.csv`), avec une phrase qui explique
    que c'est une copie de secours technique et pas un tableau à lire : toutes les données (espace, nom de l'onglet, id, parente, position, dates ISO),
    onglets dans leur ordre, sans la démo ; les tâches d'un onglet absent de la liste sont ajoutées à la fin. Base de l'import CSV prévu en V2.
- Hors périmètre : rappels, notifications, multi-étiquettes.

## Couleurs (variables en haut de `styles.css`, attribut `data-color` sur la page)
- Validées : violet (Pro d'origine) clair fond #CECBF6, accent #534AB7 ; sombre fond #3B2659, carte #2A1B40, accent #C4A8F0.
  Corail (Perso d'origine) clair fond #F5C4B3, accent #993C1D ; sombre (corail rosé) fond #5E2A3A, carte #421D29, accent #FF9E9A.
  Démo (vert sauge, réservé à la démo) clair fond #C8E3D2, accent #2E6B50 ; sombre fond #23493B, carte #183429, accent #98D8B6.
- Ajoutées le 21/11/2026, à valider à l'écran : bleu, turquoise, ambre, framboise (tirant sur le magenta, pour rester distincte
  du corail rosé en sombre), ardoise, olive. Chaque thème a 11 couleurs en clair et en sombre (fond, carte, texte, accent…).
- Un élément `data-color` reprend les couleurs de son thème : c'est ce qui colore les pastilles et le choix de couleur des Réglages.
- Le rendu diffère entre téléphone et PC : ajuster en conditions réelles si Laetitia le demande.

## Icône (validée le 18/11/2026)
- Modèle « Bonbon » : dégradé rose #FF8FB1 → pêche #FFC3A0, case blanche inclinée avec coche rose #FF6F9C, étoiles dorées #FFE27A.
- Version ronde à coins transparents pour le PC (`icons/icon.svg` → `icon-192.png`, `icon-512.png`) ;
  version pleine pour Android (`icons/icon-maskable.svg` → `icon-maskable-512.png`, dessin réduit à 78 % pour rester dans la zone sûre).
- PNG générées avec Chrome en mode headless (`--screenshot`, `--default-background-color=00000000`). Raccourci « Nouvelle tâche » : `sc-perso.png` (coche sur fond corail).

## État au 18/11/2026
- En ligne sur https://verolaet.github.io/TodoList/ (GitHub Pages, branche main, racine). Connexion et création de tâches validées sur PC.
- Domaine `verolaet.github.io` autorisé dans Firebase Auth. Règles Firestore : accès réservé à l'UID du compte Google principal
  (copie dans `firestore.rules`). Ne jamais écrire d'adresse e-mail réelle dans le dépôt (il est public).
- Les fichiers ont été déposés via l'upload web de GitHub (pas de `.nojekyll`, non bloquant).

## Reste à faire
0. Valider les corrections hors ligne (23/11/2026) : sur `main` et en ligne depuis le 25/11/2026 (version du 23/11/2026 23:18).
   - PC, vraie connexion Google : validé par Laetitia le 25/11/2026 (« Tout marche »).
   - Android : ouvrir une fois avec du réseau (installe la nouvelle version), puis mode avion → l'appli s'ouvre ;
     réseau faible → elle s'ouvre (30 s au plus, avec un message au bout de 10 s) ; se déconnecter puis se reconnecter sur le téléphone.
   - Si la connexion Google pose problème : annuler seulement le commit « démarrage rapide » (app.js) ; celui du service worker suffit pour le mode avion.
1. Valider un vrai export de l'appli dans Excel. Le format a été vérifié le 21/11/2026 dans Excel (fr-FR) sur un fichier type :
   dates reconnues, accents, « ↳ », tri par échéance, retour à l'ordre par N°. Selon le retour de Laetitia : priorités numérotées
   (« 1 - Haute »), colonne « Tâche parente ».
2. Valider les onglets configurables (21/11/2026) sur Android et PC : en-tête (onglets sur leur ligne, puis sur 2 lignes si les noms sont longs),
   les 6 nouvelles couleurs en clair et en sombre, Réglages en plein écran, déplacement d'une tâche, raccourci « Nouvelle tâche »
   (il peut falloir quelques jours pour que le téléphone remplace les 2 anciens raccourcis).
   Testé le 21/11/2026 avec la fausse base (PC 887 px, téléphone 360 et 375 px, clair et sombre).
3. Valider sur Android (version du 19/11/2026) : fiche avec le clavier ouvert, poubelle + « Annuler », mode démo.
4. Valider sur Android : dictée, appui long (mise en pause), glisser à gauche au doigt (seuil 48 px).
5. Ajuster les couleurs en conditions réelles si besoin (rendu différent téléphone / PC).
6. V2 : import CSV.
7. Optionnel (sécurité) : CSP en `<meta>` et restriction de la clé API Google Cloud (référents HTTP) — chacune doit être
   validée par une vraie connexion Google, car une erreur bloque la connexion.

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
- Réglages faits par Laetitia le 18/11/2026 (déclarés « tout est réglé ») : GitHub — double authentification, adresse e-mail privée
  + blocage des push qui l'exposent, ruleset sur `main` (pas de suppression ni de force push), réglages du dépôt ;
  Firebase — test avec un autre compte (« non autorisé »), Google seul fournisseur de connexion, domaines autorisés,
  Realtime Database verrouillée ou supprimée, adresse principale propriétaire du projet.
- Pas de scan OWASP ZAP effectué (un scan actif viserait les serveurs de GitHub ; l'essentiel du risque est côté règles Firebase).

## Tester sans toucher aux vraies données
- Une page de test peut remplacer Firebase par une fausse base en mémoire : carte d'import (`importmap`) qui redirige les 3 modules
  gstatic vers des faux modules, service worker neutralisé, servie en local (ex. serveur PowerShell `HttpListener` sur localhost).
- Test hors ligne (23/11/2026) : Playwright (Pixel 7) sur une copie servie en local, vrais modules Firebase 11.0.2 (paquet npm `firebase`)
  servis à la place de gstatic, utilisateur factice écrit dans IndexedDB (`firebaseLocalStorageDb`, clé `firebase:authUser:<apiKey>:[DEFAULT]`),
  API Google bloquées ; réseau coupé (`setOffline`) ou réseau qui ne répond pas (requêtes laissées sans réponse).

## Préférences de Laetitia
- Poser des questions de clarification avant de se lancer si nécessaire ; réponses structurées en puces.
- Signaler les risques plutôt que de décider en silence.
