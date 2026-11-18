# Mes tâches

To-do list personnelle Pro / Perso : PWA hébergée sur GitHub Pages, données dans Firebase (Firestore, région Paris).

- Deux espaces cloisonnés, une étiquette par tâche, sous-tâches
- Case à 3 états : non démarrée → en cours → terminée
- Saisie au clavier ou à la dictée, avec reconnaissance des dates (« pour vendredi », « demain », « le 25 »…)
- Tri personnalisé (glisser-déposer), par échéance ou par priorité
- Mode clair / sombre, fonctionnement hors ligne, export CSV

## Fichiers
- `index.html`, `styles.css`, `app.js` : l'application (les couleurs sont en haut de `styles.css`)
- `dateparse.js` : reconnaissance des dates en français
- `config.js` : configuration Firebase (publique, non secrète)
- `firestore.rules` : règles de sécurité à coller dans la console Firebase
- `sw.js`, `manifest.webmanifest`, `icons/` : installation sur téléphone et PC
  (dessins sources des icônes : `icons/icon.svg` pour le PC, `icons/icon-maskable.svg` pour Android)
