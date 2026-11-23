import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence, browserPopupRedirectResolver,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, writeBatch, serverTimestamp, Timestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import { parseQuickAdd, toISO, addDays } from './dateparse.js';

/* ---------- Firebase ---------- */
const fbApp = initializeApp(firebaseConfig);
// Démarrage rapide (23/11/2026) : sur téléphone, getAuth() charge au démarrage le module de connexion Google
// (apis.google.com), sans limite de temps. Avec un réseau faible, l'appli restait alors bloquée sur la roue, même déjà connectée.
// Quand une session existe sur l'appareil, on démarre donc sans ce module (il ne sert qu'à se connecter).
// Sans session (écran de connexion), on garde getAuth() : la connexion Google fonctionne exactement comme avant.
const fastStart = localStorage.getItem('signedIn') === '1';
const auth = fastStart
  ? initializeAuth(fbApp, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence] })
  : getAuth(fbApp);
let db;
try {
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch (e) {
  db = initializeFirestore(fbApp, {});
}

/* ---------- État ---------- */
const $ = (s) => document.querySelector(s);
const html = document.documentElement;
let user = null;
let tasks = new Map();
let settings = { sort: {} };

/* ---------- Onglets (configurables : 1 à 5, plus la démo à part) ---------- */
// Chaque tâche porte l'identifiant de son onglet (`space`). Perso et Pro gardent leurs identifiants d'origine ('perso', 'pro') ;
// un nouvel onglet reçoit un identifiant aléatoire. La liste (ordre, nom, couleur) est dans meta/settings.spaces (synchronisée).
const MAX_TABS = 5;
const NAME_MAX = 12;
// Thèmes proposés pour les onglets (palettes clair + sombre en haut de styles.css). Le vert sauge est réservé à la démo.
const THEMES = ['violet', 'corail', 'bleu', 'turquoise', 'ambre', 'framboise', 'ardoise', 'olive'];
const THEME_NAME = { violet: 'Violet', corail: 'Corail', bleu: 'Bleu', turquoise: 'Turquoise', ambre: 'Ambre', framboise: 'Framboise', ardoise: 'Ardoise', olive: 'Olive' };
const DEFAULT_SPACES = [{ id: 'perso', name: 'Perso', theme: 'corail' }, { id: 'pro', name: 'Pro', theme: 'violet' }];
const SPACE_ID = /^[A-Za-z0-9_-]{1,32}$/;
let spaces = DEFAULT_SPACES;
let settingsLoaded = false; // tant que la liste des onglets n'est pas chargée, on ne corrige pas l'onglet courant

// Liste des onglets lue dans la base, vérifiée (elle est insérée dans la page) : au plus 5, identifiants sûrs, noms courts
function cleanSpaces(list) {
  if (!Array.isArray(list)) return DEFAULT_SPACES;
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (out.length >= MAX_TABS) break;
    if (!s || typeof s.id !== 'string' || !SPACE_ID.test(s.id) || s.id === 'demo' || seen.has(s.id)) continue;
    seen.add(s.id);
    const name = String(s.name ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Sans nom';
    out.push({ id: s.id, name, theme: THEMES.includes(s.theme) ? s.theme : 'ardoise' });
  }
  return out.length ? out : DEFAULT_SPACES;
}
const spaceOf = (id) => spaces.find((s) => s.id === id);
const spaceName = (id) => (id === 'demo' ? 'Démo' : spaceOf(id)?.name || 'Onglet');
// Dernier onglet réel utilisé (retrouvé en fermant la démo), sinon le premier
const lastRealSpace = () => (spaceOf(localStorage.getItem('lastSpace')) || spaces[0]).id;

// Onglet courant : un onglet de la liste, ou 'demo' (mode démo, ouvert par l'icône fiole). Vérifié une fois la liste chargée.
let space = SPACE_ID.test(localStorage.getItem('space') || '') ? localStorage.getItem('space') : 'perso';
let labelFilter = {};
let demoSeedPending = space === 'demo'; // remettre les exemples si la démo est vide à son ouverture
let collapsed = new Set(JSON.parse(localStorage.getItem('collapsed') || '[]'));
let pausedCollapsed = localStorage.getItem('pausedCollapsed') === '1';
let doneCollapsed = localStorage.getItem('doneCollapsed') === '1';
let unsubs = [];
let dragging = false;
let pendingRender = false;
let editingId = null;
let firstSnapshot = true;
const params = new URLSearchParams(location.search);
const startNew = params.get('new');

const ICON = {
  grip: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  cal: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  prio: '<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 21V3.5" fill="none"/><path d="M5.5 4h12l-2.8 4.5 2.8 4.5h-12z" fill="currentColor"/></svg>',
  indent: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4v7a3 3 0 0 0 3 3h11M15 10l4 4-4 4"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M9 6v12M15 6v12"/></svg>',
  outdent: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M9 8l-4 4 4 4"/></svg>',
  tag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
  subs: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  up: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
};
const PRIO = { 1: 'Haute', 2: 'Moyenne', 3: 'Basse' };
const STATUS = ['Non démarrée', 'En cours', 'Terminée', 'En pause'];

/* ---------- Outils ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tsOf = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : 0);
const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0);
const cmpDue = (a, b) => { const x = a.due || '9999', y = b.due || '9999'; return x < y ? -1 : x > y ? 1 : 0; };
const cmpPrio = (a, b) => (a.priority ?? 9) - (b.priority ?? 9);
const tasksCol = () => collection(db, 'users', user.uid, 'tasks');
const taskRef = (id) => doc(db, 'users', user.uid, 'tasks', id);
const settingsRef = () => doc(db, 'users', user.uid, 'meta', 'settings');
const childrenOf = (id) => [...tasks.values()].filter((t) => t.parentId === id).sort(byPos);

// Message en bas de l'écran, avec un bouton facultatif (ex. « Annuler » après une suppression)
function toast(msg, ms = 2600, action = null) {
  const el = $('#toast');
  // Une fenêtre ouverte (fiche…) rend le reste de la page inactif : le message s'affiche alors dans la fenêtre (la dernière ouverte)
  const host = [...document.querySelectorAll('dialog[open]')].pop() || document.body;
  if (el.parentElement !== host) host.appendChild(el);
  el.replaceChildren(document.createTextNode(msg));
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-action';
    b.textContent = action.label;
    b.onclick = () => { clearTimeout(toast.t); el.hidden = true; action.fn(); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}
function save(promise) {
  promise.catch((err) => toast('Enregistrement impossible : ' + (err.code || err.message)));
}
function dueLabel(iso) {
  const now = new Date();
  if (iso === toISO(now)) return "Aujourd'hui";
  if (iso === toISO(addDays(now, 1))) return 'Demain';
  const d = new Date(iso + 'T12:00:00');
  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('fr-FR', opts);
}
// « aujourd'hui », « hier » ou « le 3 nov. » (pour « en pause depuis … »)
function sinceLabel(ts) {
  if (!ts || typeof ts.toDate !== 'function') return '';
  const d = ts.toDate();
  const now = new Date();
  if (toISO(d) === toISO(now)) return "aujourd'hui";
  if (toISO(d) === toISO(addDays(now, -1))) return 'hier';
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return 'le ' + d.toLocaleDateString('fr-FR', opts);
}
// Champs à enregistrer quand une tâche passe au statut `next` (0 non démarrée, 1 en cours, 2 terminée, 3 en pause)
function statusFields(t, next) {
  return {
    status: next,
    completedAt: next === 2 ? (t.status === 2 ? t.completedAt ?? serverTimestamp() : serverTimestamp()) : null,
    pausedAt: next === 3 ? (t.status === 3 ? t.pausedAt ?? serverTimestamp() : serverTimestamp()) : null,
    updatedAt: serverTimestamp(),
  };
}

/* ---------- Version (version.js, mise à jour à chaque commit) ---------- */
// Affichage : « Version du jj/mm/aaaa hh:mm » (le numéro APP_BUILD ne sert qu'au nom du cache du service worker)
const VERSION_TXT = self.APP_DATE ? `Version du ${self.APP_DATE}` : 'Version inconnue';
document.querySelectorAll('[data-version]').forEach((el) => { el.textContent = VERSION_TXT; });

/* ---------- Thème ---------- */
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = localStorage.getItem('theme') || 'auto';
  html.classList.toggle('dark', t === 'dark' || (t === 'auto' && mq.matches));
  // Couleur de l'onglet courant (vert sauge pour la démo), mémorisée pour le prochain démarrage (script en tête de index.html)
  const color = space === 'demo' ? 'sauge' : spaceOf(space)?.theme || 'corail';
  html.dataset.color = color;
  localStorage.setItem('color', color);
  const bg = getComputedStyle(html).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
  document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === t));
}
mq.addEventListener('change', applyTheme);
applyTheme();

/* ---------- Connexion ---------- */
function show(view) {
  $('#loading').hidden = view !== 'loading';
  $('#login').hidden = view !== 'login';
  $('#app').hidden = view !== 'app';
}
function loginError(err) {
  if (!err || err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return;
  const el = $('#loginError');
  el.textContent = 'Connexion impossible (' + (err.code || err.message) + ').';
  el.hidden = false;
}
// Retour d'une connexion par redirection : seulement possible sans session (donc jamais en démarrage rapide)
if (!fastStart) getRedirectResult(auth, browserPopupRedirectResolver).catch(loginError);

$('#loginBtn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider, browserPopupRedirectResolver);
  } catch (err) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
      await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
    } else loginError(err);
  }
});

onAuthStateChanged(auth, (u) => {
  unsubs.forEach((f) => f());
  unsubs = [];
  user = u;
  if (!u) {
    localStorage.removeItem('signedIn');
    // Session terminée (déconnexion, ici ou sur un autre onglet) pendant un démarrage rapide : on recharge pour retrouver
    // l'écran de connexion habituel, avec le module de connexion Google préchargé (pas de boucle : l'indicateur vient d'être retiré)
    if (fastStart) { location.reload(); return; }
    tasks = new Map(); show('login'); return;
  }
  localStorage.setItem('signedIn', '1');
  $('#sumAccount').textContent = u.email || ''; // adresse connectée : résumé de la section Compte des Réglages
  firstSnapshot = true;
  show('app');
  render();
  unsubs.push(onSnapshot(tasksCol(), (snap) => {
    $('#dbError').hidden = true;
    tasks = new Map();
    // 'estimate' : les dates pas encore confirmées par le serveur (hors ligne) sont estimées au lieu de valoir null
    // Sécurité : on n'accepte que des identifiants « normaux » (ils sont insérés tels quels dans la page)
    snap.forEach((d) => { if (/^[A-Za-z0-9_-]{1,64}$/.test(d.id)) tasks.set(d.id, { id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }); });
    requestRender();
    if (firstSnapshot) { firstSnapshot = false; handleStartNew(); maybeSeedDemo(); }
  }, dbError));
  unsubs.push(onSnapshot(settingsRef(), (d) => {
    if (d.exists()) {
      const data = d.data();
      settings = { ...settings, ...data, sort: { ...settings.sort, ...(data.sort || {}) } };
    }
    spaces = cleanSpaces(settings.spaces);
    settingsLoaded = true;
    requestRender();
    if ($('#settings').open) renderTabsAdmin();
  }, dbError));
});

function dbError(err) {
  const el = $('#dbError');
  if (err.code === 'permission-denied') {
    el.innerHTML = `Ce compte Google (<b>${esc(user?.email)}</b>) n'est pas autorisé à accéder aux tâches. `
      + '<button type="button" id="switchAccount">Changer de compte</button>';
    el.querySelector('#switchAccount').onclick = () => signOut(auth);
  } else {
    el.textContent = 'Erreur de base de données : ' + (err.code || err.message);
  }
  el.hidden = false;
}

// Raccourci de l'icône (appui long) « Nouvelle tâche » : ./?new=1, dans le dernier onglet utilisé (jamais la démo).
// Les anciens raccourcis ?new=perso / ?new=pro restent acceptés tant que le téléphone ne les a pas remplacés.
function handleStartNew() {
  if (spaceOf(startNew)) setSpace(startNew);
  else if (startNew && space === 'demo') setSpace(lastRealSpace());
  if (startNew) {
    history.replaceState(null, '', location.pathname);
    setTimeout(() => $('#quickInput').focus(), 150);
  }
}

/* ---------- Rendu ---------- */
function requestRender() {
  if (dragging) { pendingRender = true; return; }
  render();
}

function checkHTML(t) {
  const s = t.status || 0;
  return `<button type="button" class="check s${s}" data-check="${t.id}" aria-label="Statut : ${STATUS[s]}">${s === 2 ? ICON.check : ''}</button>`;
}

// Drapeau de priorité : rouge (haute), orange (moyenne), neutre (basse ou aucune). Un appui change la priorité.
function prioHTML(t) {
  const p = t.priority === 1 || t.priority === 2 ? t.priority : 0;
  const label = t.priority ? `Priorité ${PRIO[t.priority].toLowerCase()}` : 'Sans priorité';
  return `<button type="button" class="prio p${p}" data-prio="${t.id}" aria-label="${label} (appuyer pour changer)" title="${label}">${ICON.prio}</button>`;
}

function metaHTML(t, kids) {
  const parts = [];
  if (t.status === 3 && t.pausedAt) parts.push(`<span class="chip" title="En pause">${ICON.pause}depuis ${esc(sinceLabel(t.pausedAt))}</span>`);
  if (t.due) {
    const overdue = t.status !== 2 && t.due < toISO(new Date());
    parts.push(`<span class="chip${overdue ? ' overdue' : ''}">${ICON.cal}${esc(dueLabel(t.due))}</span>`);
  }
  if (t.label && !t.parentId) parts.push(`<span class="chip">${ICON.tag}${esc(t.label)}</span>`);
  if (kids && kids.length) parts.push(`<span class="chip">${ICON.subs}${kids.filter((k) => k.status === 2).length}/${kids.length}</span>`);
  return parts.length ? `<div class="meta">${parts.join('')}</div>` : '';
}

function subHTML(k, canDrag) {
  return `<li class="sub${k.status === 2 ? ' is-done' : k.status === 3 ? ' is-paused' : ''}" data-id="${k.id}"><div class="row">
    ${canDrag ? `<span class="shandle handle" aria-hidden="true">${ICON.grip}</span>` : ''}
    ${checkHTML(k)}
    ${prioHTML(k)}
    <div class="body" data-edit="${k.id}"><div class="title">${esc(k.title)}</div>${metaHTML(k)}</div>
  </div></li>`;
}

function taskHTML(t, mode) {
  const kids = childrenOf(t.id);
  const isCollapsed = collapsed.has(t.id);
  const done = t.status === 2;
  const paused = t.status === 3;
  const movable = !done && !paused; // les tâches terminées ou en pause ne se déplacent pas
  return `<li class="task${done ? ' is-done' : paused ? ' is-paused' : ''}" data-id="${t.id}">
    <div class="row">
      ${mode === 'custom' && movable ? `<span class="handle phandle" aria-hidden="true">${ICON.grip}</span>` : ''}
      ${checkHTML(t)}
      ${prioHTML(t)}
      <div class="body" data-edit="${t.id}"><div class="title">${esc(t.title)}</div>${metaHTML(t, kids)}</div>
      ${kids.length ? `<button type="button" class="toggle${isCollapsed ? '' : ' open'}" data-toggle="${t.id}" aria-label="Afficher ou masquer les sous-tâches">${ICON.chevron}</button>` : ''}
    </div>
    ${kids.length && !isCollapsed ? `<ul class="subs" data-parent="${t.id}">${kids.map((k) => subHTML(k, movable)).join('')}</ul>` : ''}
  </li>`;
}

// Ordre d'affichage des tâches parentes : la liste (selon le tri choisi), « En pause », puis « Terminées » (les plus récentes d'abord)
function groupParents(parents, mode) {
  const sortFn = mode === 'due' ? (a, b) => cmpDue(a, b) || byPos(a, b)
    : mode === 'priority' ? (a, b) => cmpPrio(a, b) || cmpDue(a, b) || byPos(a, b)
      : byPos;
  return {
    active: parents.filter((t) => t.status !== 2 && t.status !== 3).sort(sortFn),
    paused: parents.filter((t) => t.status === 3).sort(sortFn),
    done: parents.filter((t) => t.status === 2).sort((a, b) => tsOf(b.completedAt) - tsOf(a.completedAt)),
  };
}

/* ---------- Onglets de l'en-tête ---------- */
let tabsSig = '';
function renderTabs() {
  const sig = JSON.stringify([spaces, space]);
  if (sig === tabsSig) return;
  tabsSig = sig;
  $('.tabs').innerHTML = spaces.map((s) => `<button type="button" class="tab${s.id === space ? ' active' : ''}" data-space="${s.id}" role="tab"
    aria-selected="${s.id === space}" title="${esc(s.name)}">${esc(s.name)}</button>`).join('');
  layoutHeader();
  requestAnimationFrame(layoutHeader); // nouvelle mesure une fois l'affichage stabilisé (téléphone)
}
// 1. Les onglets restent à côté de la fiole et des Réglages tant qu'ils tiennent (toujours le cas sur PC).
// 2. Sinon ils passent sur leur propre ligne, sous le nom de l'appli ; chaque onglet prend la largeur de son nom.
// 3. Si cette ligne est encore trop courte, ils se répartissent sur 2 lignes équilibrées (ex. 3 + 2) au lieu d'être coupés.
// Les noms ne sont coupés (« … ») que si un nom ne tient pas dans sa case (cas extrême).
function tabsFit(nav) {
  // Largeur naturelle des onglets (sans rétrécissement) : mesurée avec la classe « measuring » (scrollWidth ne suffit pas avec « … »)
  nav.classList.add('measuring');
  const need = [...nav.children].reduce((w, b) => w + b.getBoundingClientRect().width, 0)
    + parseFloat(getComputedStyle(nav).paddingLeft) + parseFloat(getComputedStyle(nav).paddingRight);
  nav.classList.remove('measuring');
  return need <= nav.getBoundingClientRect().width - 0.5; // marge : un dépassement d'une fraction de pixel suffit à afficher « … »
}
function layoutHeader() {
  const top = $('.top');
  const nav = $('.tabs');
  top.classList.remove('two-rows');
  nav.classList.remove('wrapped');
  if (nav.hidden || !nav.clientWidth || tabsFit(nav)) return;
  top.classList.add('two-rows');
  if (tabsFit(nav)) return;
  nav.classList.add('wrapped');
  nav.style.setProperty('--per-row', String(Math.ceil(nav.children.length / 2)));
}
window.addEventListener('resize', layoutHeader);
document.fonts?.ready.then(layoutHeader);

// Une fois la liste des onglets chargée : si l'onglet courant n'existe plus (supprimé, ici ou sur un autre appareil), on ouvre le premier
function ensureValidSpace() {
  if (!settingsLoaded || space === 'demo' || spaceOf(space)) return;
  space = spaces[0].id;
  localStorage.setItem('space', space);
  localStorage.setItem('lastSpace', space);
}

function render() {
  if (!user) return;
  ensureValidSpace();
  applyTheme();
  const demo = space === 'demo';
  $('.tabs').hidden = demo; // en démo, les onglets ne sont pas affichés
  renderTabs();
  if (demo) $('.top').classList.remove('two-rows');
  $('#demoPill').hidden = !demo;
  $('#demoBtn').classList.toggle('active', demo);
  $('#demoBtn').setAttribute('aria-pressed', String(demo));
  $('#demoBtn').setAttribute('aria-label', demo ? 'Fermer la démo' : 'Ouvrir la démo');
  const mode = settings.sort?.[space] || 'custom';
  $('#sortSelect').value = mode;

  const inSpace = [...tasks.values()].filter((t) => t.space === space);
  const labels = [...new Set(inSpace.filter((t) => !t.parentId).map((t) => t.label).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
  let filter = labelFilter[space];
  if (filter && !labels.includes(filter)) filter = labelFilter[space] = null;

  $('#labelChips').innerHTML = labels.length
    ? [`<button type="button" class="chip-btn${filter ? '' : ' active'}" data-label="">Toutes</button>`]
      .concat(labels.map((l) => `<button type="button" class="chip-btn${l === filter ? ' active' : ''}" data-label="${esc(l)}">${esc(l)}</button>`)).join('')
    : '';
  $('#labelsList').innerHTML = labels.map((l) => `<option value="${esc(l)}">`).join('');

  let parents = inSpace.filter((t) => !t.parentId);
  if (filter) parents = parents.filter((t) => t.label === filter);
  const { active, paused, done } = groupParents(parents, mode);

  $('#activeList').innerHTML = active.map((t) => taskHTML(t, mode)).join('');
  $('#emptyState').hidden = active.length > 0;
  // Section « En pause » (repliable, état mémorisé sur l'appareil)
  $('#pausedSection').hidden = paused.length === 0;
  $('#pausedTitle').textContent = `En pause (${paused.length})`;
  $('#pausedToggle').classList.toggle('open', !pausedCollapsed);
  $('#pausedToggle').setAttribute('aria-expanded', String(!pausedCollapsed));
  $('#pausedCard').hidden = pausedCollapsed;
  $('#pausedList').innerHTML = pausedCollapsed ? '' : paused.map((t) => taskHTML(t, mode)).join('');
  $('#doneSection').hidden = done.length === 0;
  $('#doneTitle').textContent = `Terminées (${done.length})`;
  $('#doneToggle').classList.toggle('open', !doneCollapsed);
  $('#doneToggle').setAttribute('aria-expanded', String(!doneCollapsed));
  $('#doneCard').hidden = doneCollapsed;
  $('#doneList').innerHTML = doneCollapsed ? '' : done.map((t) => taskHTML(t, mode)).join('');

  setupSortables(mode);
  if ($('#editor').open) renderSubsEditor();
}

/* ---------- Glisser-déposer ---------- */
let sortables = [];
function setupSortables(mode) {
  sortables.forEach((s) => s.destroy());
  sortables = [];
  if (!window.Sortable) return;
  const common = {
    animation: 150,
    delay: 0,
    onStart: () => { dragging = true; },
    onEnd: (e) => {
      dragging = false;
      persistOrder(e.from);
      if (pendingRender) { pendingRender = false; render(); }
    },
  };
  if (mode === 'custom') sortables.push(Sortable.create($('#activeList'), { ...common, handle: '.phandle' }));
  document.querySelectorAll('#activeList .subs').forEach((ul) => sortables.push(Sortable.create(ul, { ...common, handle: '.shandle' })));
}

function persistOrder(ul) {
  const ids = [...ul.children].map((li) => li.dataset.id).filter((id) => tasks.has(id));
  if (ids.length < 2) return;
  // On réutilise les positions existantes de ces tâches (préserve l'ordre des tâches masquées par un filtre)
  let positions = ids.map((id) => tasks.get(id).position ?? 0).sort((a, b) => a - b);
  if (new Set(positions).size !== positions.length) positions = ids.map((_, i) => (i + 1) * 1000);
  const batch = writeBatch(db);
  let changed = false;
  ids.forEach((id, i) => {
    if (tasks.get(id).position !== positions[i]) {
      batch.update(taskRef(id), { position: positions[i] });
      tasks.get(id).position = positions[i];
      changed = true;
    }
  });
  if (changed) save(batch.commit());
}

/* ---------- Glisser à droite : devient sous-tâche de la tâche du dessus ; à gauche : redevient une tâche ---------- */
const SWIPE_START = 12; // px avant de reconnaître un glissement horizontal
const SWIPE_DONE = 48; // px à atteindre pour valider (assez court pour glisser à gauche sur un petit écran)
let swipe = null;
let swallowClickUntil = 0;

$('#activeList').addEventListener('pointerdown', (e) => {
  if (swipe || dragging || (e.pointerType === 'mouse' && e.button !== 0)) return;
  if (e.target.closest('.handle')) return; // la poignée sert au glisser-déposer vertical
  const row = e.target.closest('.row');
  const li = row && row.parentElement;
  if (!li || !tasks.has(li.dataset.id)) return;
  let dir = 0;
  let targetId = null;
  if (li.classList.contains('sub')) dir = -1;
  else if (li.previousElementSibling?.classList.contains('task')) { dir = 1; targetId = li.previousElementSibling.dataset.id; }
  if (!dir) return;
  swipe = { id: li.dataset.id, li, row, dir, targetId, x: e.clientX, y: e.clientY, dx: 0, active: false, pointerId: e.pointerId };
});

window.addEventListener('pointermove', (e) => {
  const s = swipe;
  if (!s || e.pointerId !== s.pointerId) return;
  if (e.pointerType === 'mouse' && e.buttons === 0) { endSwipe({ type: 'pointercancel', pointerId: e.pointerId }); return; }
  const dx = e.clientX - s.x;
  const dy = e.clientY - s.y;
  if (!s.active) {
    if (Math.abs(dx) < SWIPE_START && Math.abs(dy) < SWIPE_START) return;
    // Geste vertical (défilement) ou dans le mauvais sens : on laisse faire
    if (Math.abs(dy) >= Math.abs(dx) || Math.sign(dx) !== s.dir || !s.row.isConnected) { swipe = null; return; }
    s.active = true;
    dragging = true; // suspend les rafraîchissements pendant le geste
    window.getSelection()?.removeAllRanges();
    document.body.classList.add('swiping');
    s.hint = document.createElement('div');
    s.hint.className = 'swipe-hint ' + (s.dir > 0 ? 'in' : 'out');
    s.hint.innerHTML = s.dir > 0 ? ICON.indent : ICON.outdent;
    s.hint.style.height = (s.row.offsetHeight - 4) + 'px';
    s.li.classList.add('swipe-li');
    s.li.prepend(s.hint);
    s.row.classList.add('swiping');
    try { s.row.setPointerCapture(e.pointerId); } catch (err) { /* sans importance */ }
  }
  let d = s.dir > 0 ? Math.max(0, dx) : Math.min(0, dx);
  if (Math.abs(d) > SWIPE_DONE) d = Math.sign(d) * (SWIPE_DONE + (Math.abs(d) - SWIPE_DONE) * 0.35); // résistance
  s.dx = d;
  s.row.style.transform = `translateX(${d}px)`;
  s.li.classList.toggle('swipe-ready', Math.abs(d) >= SWIPE_DONE);
});

function endSwipe(e) {
  const s = swipe;
  if (!s || e.pointerId !== s.pointerId) return;
  swipe = null;
  if (!s.active) return;
  swallowClickUntil = Date.now() + 400; // évite d'ouvrir la fiche en relâchant
  document.body.classList.remove('swiping');
  dragging = false;
  const validated = e.type === 'pointerup' && Math.abs(s.dx) >= SWIPE_DONE;
  const applied = validated && (s.dir > 0 ? makeSubtask(s.id, s.targetId) : makeTopLevel(s.id));
  if (applied) { pendingRender = false; render(); return; }
  s.row.classList.add('snap'); // retour en place
  s.row.style.transform = 'translateX(0)';
  setTimeout(() => {
    s.hint?.remove();
    s.row.classList.remove('swiping', 'snap');
    s.row.style.transform = '';
    s.li.classList.remove('swipe-li', 'swipe-ready');
    if (pendingRender) { pendingRender = false; render(); }
  }, 180);
}
window.addEventListener('pointerup', endSwipe);
window.addEventListener('pointercancel', endSwipe);
document.addEventListener('click', (e) => {
  if (Date.now() < swallowClickUntil) { e.stopPropagation(); e.preventDefault(); swallowClickUntil = 0; }
}, true);

function makeSubtask(id, parentId) {
  const t = tasks.get(id);
  const p = tasks.get(parentId);
  if (!t || !p || t.parentId || p.parentId || id === parentId) return false;
  if (childrenOf(id).length) {
    toast(`« ${t.title} » a déjà des sous-tâches : elle ne peut pas devenir une sous-tâche.`, 3500);
    return false;
  }
  const position = Math.max(0, ...childrenOf(parentId).map((k) => k.position ?? 0)) + 1000;
  // Une sous-tâche n'a pas d'étiquette (elle suit celle de sa tâche parente)
  const changes = { parentId, label: null, position, updatedAt: serverTimestamp() };
  Object.assign(t, changes, { updatedAt: t.updatedAt }); // affichage immédiat, sans attendre la base
  save(writeBatch(db).update(taskRef(id), changes).commit());
  if (collapsed.delete(parentId)) localStorage.setItem('collapsed', JSON.stringify([...collapsed]));
  return true;
}

function makeTopLevel(id) {
  const t = tasks.get(id);
  if (!t || !t.parentId) return false;
  const p = tasks.get(t.parentId);
  // Se place juste après son ancienne tâche parente et reprend son étiquette (reste visible si un filtre est actif)
  const pPos = p?.position ?? 0;
  const after = [...tasks.values()].filter((x) => x.space === t.space && !x.parentId && (x.position ?? 0) > pPos).map((x) => x.position);
  const position = after.length ? (pPos + Math.min(...after)) / 2 : pPos + 1000;
  const changes = { parentId: null, label: p?.label ?? null, position, updatedAt: serverTimestamp() };
  Object.assign(t, changes, { updatedAt: t.updatedAt });
  save(writeBatch(db).update(taskRef(id), changes).commit());
  return true;
}

/* ---------- Actions ---------- */
function setSpace(s) {
  space = s;
  localStorage.setItem('space', s);
  if (s !== 'demo') localStorage.setItem('lastSpace', s); // onglet retrouvé en fermant la démo
  render();
  window.scrollTo({ top: 0 });
}

function cycleStatus(id) {
  const t = tasks.get(id);
  if (!t) return;
  const cur = t.status || 0;
  const next = cur === 3 ? 1 : (cur + 1) % 3; // une tâche en pause reprend « en cours »
  const batch = writeBatch(db);
  batch.update(taskRef(id), statusFields(t, next));
  if (!t.parentId && next === 2) {
    childrenOf(id).forEach((k) => { if (k.status !== 2) batch.update(taskRef(k.id), statusFields(k, 2)); });
  }
  save(batch.commit());
}

// Appui long sur la case (clic droit sur PC) : met en pause, ou reprend (« en cours ») une tâche en pause
function togglePause(id) {
  const t = tasks.get(id);
  if (!t) return;
  const next = t.status === 3 ? 1 : 3;
  save(writeBatch(db).update(taskRef(id), statusFields(t, next)).commit());
  navigator.vibrate?.(15);
  toast(next === 3 ? `« ${t.title} » est en pause` : `« ${t.title} » reprend`);
}

// Appui sur le drapeau : neutre → haute → moyenne → neutre (« basse » reste réglable dans la fiche)
function cyclePriority(id) {
  const t = tasks.get(id);
  if (!t) return;
  const next = t.priority === 1 ? 2 : t.priority === 2 ? null : 1;
  save(writeBatch(db).update(taskRef(id), { priority: next, updatedAt: serverTimestamp() }).commit());
}

function addTask(text) {
  const { title, due } = parseQuickAdd(text, new Date());
  if (!title) return false;
  const siblings = [...tasks.values()].filter((t) => t.space === space && !t.parentId);
  const minPos = Math.min(0, ...siblings.map((t) => t.position ?? 0));
  const ref = doc(tasksCol());
  save(setDoc(ref, {
    space, title, status: 0, due: due || null, priority: null, label: labelFilter[space] || null,
    parentId: null, position: minPos - 1000, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), completedAt: null,
  }));
  if (due) toast(`Ajoutée — échéance : ${dueLabel(due).toLowerCase()}`);
  return true;
}

function addSubtask(parentId, text) {
  const parent = tasks.get(parentId);
  const { title, due } = parseQuickAdd(text, new Date());
  if (!parent || !title) return;
  const kids = childrenOf(parentId);
  const maxPos = Math.max(0, ...kids.map((k) => k.position ?? 0));
  const ref = doc(tasksCol());
  save(setDoc(ref, {
    space: parent.space, title, status: 0, due: due || null, priority: null, label: null,
    parentId, position: maxPos + 1000, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), completedAt: null,
  }));
}

function deleteTasks(ids) {
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(taskRef(id)));
  save(batch.commit());
}

// Suppression immédiate, avec « Annuler » pendant quelques secondes (les tâches sont recréées à l'identique)
function deleteWithUndo(ids, msg) {
  const copies = ids.map((id) => tasks.get(id)).filter(Boolean).map((t) => ({ ...t }));
  if (!copies.length) return;
  deleteTasks(copies.map((t) => t.id));
  toast(msg, 6000, {
    label: 'Annuler',
    fn: () => {
      const batch = writeBatch(db);
      copies.forEach(({ id, ...data }) => batch.set(taskRef(id), data));
      save(batch.commit());
    },
  });
}

// withCancel = false : simple message d'information (un seul bouton, non rouge)
function askConfirm(msg, yesLabel = 'Supprimer', withCancel = true) {
  return new Promise((resolve) => {
    const dlg = $('#confirmDlg');
    $('#confirmMsg').textContent = msg;
    $('#confirmYes').textContent = yesLabel;
    $('#confirmYes').className = withCancel ? 'danger-fill' : 'primary';
    $('#confirmNo').hidden = !withCancel;
    const done = (v) => { dlg.close(); resolve(v); };
    $('#confirmYes').onclick = () => done(true);
    $('#confirmNo').onclick = () => done(false);
    dlg.oncancel = () => resolve(false);
    dlg.showModal();
  });
}

/* ---------- Éditeur ---------- */
function openEditor(id) {
  const t = tasks.get(id);
  if (!t) return;
  editingId = id;
  const f = $('#editForm');
  f.title.value = t.title || '';
  f.status.value = String(t.status || 0);
  f.due.value = t.due || '';
  f.priority.value = t.priority ? String(t.priority) : '';
  f.label.value = t.label || '';
  $('#labelField').hidden = !!t.parentId;
  // Changer d'onglet : tâches parentes seulement (les sous-tâches suivent), pas en démo, et s'il y a au moins 2 onglets
  const canMove = !t.parentId && t.space !== 'demo' && spaces.length > 1;
  $('#spaceField').hidden = !canMove;
  f.space.innerHTML = canMove ? spaces.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') : '';
  if (canMove) f.space.value = spaceOf(t.space) ? t.space : spaces[0].id;
  $('#subsEditor').hidden = !!t.parentId;
  $('#editorTitle').textContent = t.parentId ? 'Sous-tâche' : 'Tâche';
  $('#deleteTaskBtn').setAttribute('aria-label', t.parentId ? 'Supprimer la sous-tâche' : 'Supprimer la tâche');
  $('#newSubInput').value = '';
  renderSubsEditor();
  $('#editor').showModal();
  // Sur téléphone, pas de curseur dans un champ à l'ouverture : le clavier ne s'ouvre que si on touche un champ.
  // Sur PC (souris), le curseur va dans le titre, prêt à être modifié.
  if (matchMedia('(pointer: coarse)').matches) $('#editorTitle').focus({ preventScroll: true });
  else { f.title.focus(); f.title.setSelectionRange(f.title.value.length, f.title.value.length); }
}

function renderSubsEditor() {
  const list = $('#subsEditList');
  // On ne redessine pas pendant la modification d'un titre de sous-tâche (le texte en cours serait perdu)
  if (!editingId || (list.contains(document.activeElement) && document.activeElement.matches('input'))) return;
  const kids = childrenOf(editingId);
  list.innerHTML = kids.map((k) => `<li class="${k.status === 2 ? 'is-done' : k.status === 3 ? 'is-paused' : ''}" data-id="${k.id}">
      ${checkHTML(k)}
      <input type="text" value="${esc(k.title)}" data-subtitle="${k.id}" aria-label="Sous-tâche">
      <button type="button" class="icon-btn" data-subdel="${k.id}" aria-label="Supprimer la sous-tâche">${ICON.trash}</button>
    </li>`).join('');
}

$('#editForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = tasks.get(editingId);
  if (!t) { $('#editor').close(); return; }
  const f = e.target;
  const title = f.title.value.replace(/\s+/g, ' ').trim();
  if (!title) { f.title.focus(); return; }
  const status = +f.status.value;
  const label = t.parentId ? null : (f.label.value.trim() || null);
  // Déplacement vers un autre onglet : la tâche arrive en haut de sa liste, garde son étiquette ; ses sous-tâches la suivent
  const dest = !$('#spaceField').hidden && spaceOf(f.space.value) && f.space.value !== t.space ? f.space.value : null;
  const moved = dest ? {
    space: dest,
    position: Math.min(0, ...[...tasks.values()].filter((x) => x.space === dest && !x.parentId).map((x) => x.position ?? 0)) - 1000,
  } : {};
  const batch = writeBatch(db);
  batch.update(taskRef(t.id), {
    title, due: f.due.value || null, priority: f.priority.value ? +f.priority.value : null, label, ...statusFields(t, status), ...moved,
  });
  const kids = t.parentId ? [] : childrenOf(t.id);
  kids.forEach((k) => {
    const upd = { ...(dest ? { space: dest } : {}), ...(status === 2 && t.status !== 2 && k.status !== 2 ? statusFields(k, 2) : {}) };
    if (Object.keys(upd).length) batch.update(taskRef(k.id), upd);
  });
  save(batch.commit());
  if (label && labelFilter[space] && label !== labelFilter[space]) labelFilter[space] = null;
  $('#editor').close();
  if (dest) toast(`Déplacée vers « ${spaceName(dest)} »`);
});
$('#cancelEditBtn').addEventListener('click', () => $('#editor').close());
$('#editor').addEventListener('close', () => { editingId = null; });
// Un message affiché dans une fenêtre (ex. « Annuler ») reste visible après sa fermeture : il passe dans la fenêtre encore ouverte, ou la page
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('close', () => {
  const t = $('#toast');
  if (t.parentElement === d) ([...document.querySelectorAll('dialog[open]')].pop() || document.body).appendChild(t);
}));
// Entrée dans le titre = Enregistrer (le titre tient sur une ligne : les retours à la ligne sont de toute façon retirés)
const editTitle = $('#editForm').elements.namedItem('title');
editTitle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#editForm').requestSubmit(); }
});
editTitle.addEventListener('beforeinput', (e) => { // claviers de téléphone qui n'envoient pas la touche Entrée
  if (e.inputType === 'insertLineBreak' || e.inputType === 'insertParagraph') { e.preventDefault(); $('#editForm').requestSubmit(); }
});

$('#deleteTaskBtn').addEventListener('click', () => {
  const t = tasks.get(editingId);
  if (!t) return;
  const kids = childrenOf(t.id);
  $('#editor').close();
  const msg = kids.length ? `Tâche et ${kids.length} sous-tâche${kids.length > 1 ? 's' : ''} supprimées`
    : t.parentId ? 'Sous-tâche supprimée' : 'Tâche supprimée';
  deleteWithUndo([t.id, ...kids.map((k) => k.id)], msg);
});

const subsList = $('#subsEditList');
subsList.addEventListener('click', async (e) => {
  const chk = e.target.closest('[data-check]');
  if (chk) { cycleStatus(chk.dataset.check); return; }
  const del = e.target.closest('[data-subdel]');
  if (del) deleteWithUndo([del.dataset.subdel], 'Sous-tâche supprimée');
});
subsList.addEventListener('change', (e) => {
  const id = e.target.dataset.subtitle;
  const title = e.target.value.replace(/\s+/g, ' ').trim();
  if (id && title && tasks.get(id)?.title !== title) save(writeBatch(db).update(taskRef(id), { title, updatedAt: serverTimestamp() }).commit());
});
subsList.addEventListener('focusout', () => setTimeout(renderSubsEditor, 0));
function addSubFromInput() {
  const input = $('#newSubInput');
  if (input.value.trim() && editingId) { addSubtask(editingId, input.value); input.value = ''; }
  input.focus();
}
$('#addSubBtn').addEventListener('click', addSubFromInput);
$('#newSubInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSubFromInput(); } });

/* ---------- Événements de la liste ---------- */
function onListClick(e) {
  const chk = e.target.closest('[data-check]');
  if (chk) { cycleStatus(chk.dataset.check); return; }
  const prio = e.target.closest('[data-prio]');
  if (prio) { cyclePriority(prio.dataset.prio); return; }
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    const id = tog.dataset.toggle;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    localStorage.setItem('collapsed', JSON.stringify([...collapsed]));
    render();
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) openEditor(ed.dataset.edit);
}
$('#activeList').addEventListener('click', onListClick);
$('#pausedList').addEventListener('click', onListClick);
$('#doneList').addEventListener('click', onListClick);
$('#pausedToggle').addEventListener('click', () => {
  pausedCollapsed = !pausedCollapsed;
  localStorage.setItem('pausedCollapsed', pausedCollapsed ? '1' : '0');
  render();
});
$('#doneToggle').addEventListener('click', () => {
  doneCollapsed = !doneCollapsed;
  localStorage.setItem('doneCollapsed', doneCollapsed ? '1' : '0');
  render();
});

/* ---------- Appui long sur une case (clic droit sur PC) : mettre en pause / reprendre ---------- */
const LONG_PRESS = 550; // ms
let press = null;
let lastLongPress = 0;
let releasePending = false;
function longPress(id) {
  if (Date.now() - lastLongPress < 800) return; // déjà traité (appui long + menu contextuel)
  lastLongPress = Date.now();
  releasePending = true;
  swallowClickUntil = Date.now() + 5000; // ignore le « clic » du relâchement (jusqu'au relâchement, 5 s au plus)
  togglePause(id);
}
document.addEventListener('pointerdown', (e) => {
  const chk = e.target.closest('[data-check]');
  if (!chk || e.pointerType === 'mouse') return;
  clearTimeout(press?.timer);
  const id = chk.dataset.check;
  press = { x: e.clientX, y: e.clientY, timer: setTimeout(() => { press = null; longPress(id); }, LONG_PRESS) };
});
document.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
});
['pointerup', 'pointercancel'].forEach((type) => document.addEventListener(type, () => {
  if (press) { clearTimeout(press.timer); press = null; }
  if (releasePending) { releasePending = false; swallowClickUntil = Date.now() + 400; }
}));
document.addEventListener('contextmenu', (e) => {
  const chk = e.target.closest('[data-check]');
  if (!chk) return;
  e.preventDefault();
  if (press) { clearTimeout(press.timer); press = null; }
  longPress(chk.dataset.check);
  if (e.pointerType === 'mouse' || !e.pointerType) { releasePending = false; swallowClickUntil = 0; } // clic droit : pas de clic à ignorer
});

$('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-space]');
  if (b && spaceOf(b.dataset.space)) setSpace(b.dataset.space);
});

/* ---------- Mode démo (icône fiole) : un espace à part, pour tester et montrer sans toucher aux vraies tâches ---------- */
$('#demoBtn').addEventListener('click', () => {
  if (space === 'demo') { setSpace(lastRealSpace()); return; }
  setSpace('demo');
  demoSeedPending = true;
  maybeSeedDemo();
});

// Si la démo est vide à son ouverture, on la remplit d'exemples (une fois les tâches chargées)
function maybeSeedDemo() {
  if (!demoSeedPending || space !== 'demo' || firstSnapshot || !user) return;
  demoSeedPending = false;
  if (![...tasks.values()].some((t) => t.space === 'demo')) writeDemoExamples(writeBatch(db));
}

// Exemples qui montrent toutes les fonctions : échéances (dont une en retard), priorités, étiquettes,
// sous-tâches, tâche en pause, tâches terminées
function writeDemoExamples(batch) {
  const day = (n) => toISO(addDays(new Date(), n));
  const ago = (days, hours = 0) => Timestamp.fromDate(new Date(Date.now() - (days * 24 + hours) * 3600e3));
  const examples = [
    { title: 'Préparer la réunion d’équipe', status: 1, due: day(0), priority: 1, label: 'Travail', subs: [
      { title: 'Rassembler les chiffres', status: 2 },
      { title: 'Faire le support', status: 1, priority: 1 },
      { title: 'Envoyer l’ordre du jour' },
    ] },
    { title: 'Appeler le plombier', due: day(1), priority: 2, label: 'Maison' },
    { title: 'Renvoyer le colis', due: day(-2), label: 'Maison' },
    { title: 'Réserver les billets de train', due: day(6), label: 'Vacances', subs: [
      { title: 'Comparer les horaires', status: 2 },
      { title: 'Choisir les places', status: 3 },
      { title: 'Payer' },
    ] },
    { title: 'Lire le roman du club de lecture', priority: 3, label: 'Loisirs' },
    { title: 'Ranger le garage', status: 3, label: 'Maison' },
    { title: 'Acheter du pain', status: 2 },
    { title: 'Envoyer le compte rendu', status: 2, label: 'Travail' },
  ];
  const write = (ex, parentId, position, label) => {
    const ref = doc(tasksCol());
    const status = ex.status || 0;
    batch.set(ref, {
      space: 'demo', title: ex.title, status, due: ex.due || null, priority: ex.priority || null, label,
      parentId, position, createdAt: ago(7), updatedAt: ago(0, 1),
      completedAt: status === 2 ? ago(position % 3, 2) : null, pausedAt: status === 3 ? ago(4) : null,
    });
    return ref.id;
  };
  examples.forEach((ex, i) => {
    const id = write(ex, null, (i + 1) * 1000, ex.label || null);
    (ex.subs || []).forEach((k, j) => write(k, id, (j + 1) * 1000, null));
  });
  save(batch.commit());
}

$('#resetDemoBtn').addEventListener('click', async () => {
  $('#settings').close();
  if (!await askConfirm('Réinitialiser la démo ? Ses tâches seront remplacées par les exemples de départ. Les tâches de tes onglets ne sont pas touchées.', 'Réinitialiser')) return;
  const batch = writeBatch(db);
  [...tasks.values()].filter((t) => t.space === 'demo').forEach((t) => batch.delete(taskRef(t.id)));
  writeDemoExamples(batch);
  labelFilter.demo = null;
  toast('Démo réinitialisée');
});
$('#labelChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-label]');
  if (!b) return;
  labelFilter[space] = b.dataset.label || null;
  render();
});
$('#sortSelect').addEventListener('change', (e) => {
  settings.sort = { ...settings.sort, [space]: e.target.value };
  render();
  save(setDoc(settingsRef(), { sort: settings.sort }, { merge: true }));
});

$('#clearDoneBtn').addEventListener('click', async () => {
  const done = [...tasks.values()].filter((t) => t.space === space && !t.parentId && t.status === 2
    && (!labelFilter[space] || t.label === labelFilter[space]));
  if (!done.length) return;
  const ids = done.flatMap((t) => [t.id, ...childrenOf(t.id).map((k) => k.id)]);
  if (await askConfirm(`Supprimer définitivement ${done.length} tâche(s) terminée(s)${ids.length > done.length ? ' et leurs sous-tâches' : ''} ?`)) deleteTasks(ids);
});

/* ---------- Saisie rapide et dictée ---------- */
$('#quickAdd').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#quickInput');
  if (addTask(input.value)) input.value = '';
  $('#quickHint').hidden = true;
});
$('#quickInput').addEventListener('input', (e) => {
  const { due } = parseQuickAdd(e.target.value, new Date());
  const hint = $('#quickHint');
  hint.hidden = !due;
  if (due) hint.textContent = `Échéance détectée : ${dueLabel(due).toLowerCase()}`;
});

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
if (!SR) $('#micBtn').hidden = true;
$('#micBtn').addEventListener('click', () => {
  if (recognition) { recognition.stop(); return; }
  const input = $('#quickInput');
  const rec = new SR();
  recognition = rec;
  rec.lang = 'fr-FR';
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = '';
  $('#micBtn').classList.add('listening');
  rec.onresult = (ev) => {
    let interim = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) finalText += ev.results[i][0].transcript;
      else interim += ev.results[i][0].transcript;
    }
    input.value = (finalText + interim).trim();
    input.dispatchEvent(new Event('input'));
  };
  rec.onerror = (ev) => {
    if (ev.error === 'not-allowed') toast("Micro refusé : autorise-le dans les réglages du navigateur.");
    else if (ev.error !== 'no-speech' && ev.error !== 'aborted') toast('Dictée impossible (' + ev.error + ').');
  };
  rec.onend = () => {
    $('#micBtn').classList.remove('listening');
    recognition = null;
    if (finalText.trim() && addTask(finalText)) { input.value = ''; $('#quickHint').hidden = true; }
  };
  rec.start();
});

/* ---------- Réglages ---------- */
// Sections pliables : Onglets, Affichage, Export Excel, Sauvegarde, (Démo), Compte. Toutes pliées à chaque ouverture,
// une seule dépliée à la fois. En démo : pas de gestion des onglets ni de sauvegarde (vraies tâches : on peut montrer l'appli
// sans risque) ; l'export ne propose que la démo ; section Démo pour la remettre à zéro.
$('#settingsBtn').addEventListener('click', () => {
  applyTheme();
  const demo = space === 'demo';
  $('#tabsSection').hidden = demo;
  $('#backupSection').hidden = demo;
  $('#demoSection').hidden = !demo;
  $('#exportSubs').checked = false; // sous-tâches non incluses par défaut, à chaque ouverture
  document.querySelectorAll('#settingsBody .set-section').forEach((sec) => setSectionOpen(sec, false));
  renderTabsAdmin();
  fillExportSpaces(space);
  updateThemeSummary();
  $('#settings').showModal();
});
$('#closeSettingsBtn').addEventListener('click', () => $('#settings').close());
function setSectionOpen(sec, open) {
  sec.classList.toggle('open', open);
  sec.querySelector('.set-head').setAttribute('aria-expanded', String(open));
  sec.querySelector('.set-body').hidden = !open;
}
$('#settingsBody').addEventListener('click', (e) => {
  const head = e.target.closest('.set-head');
  if (!head) return;
  const sec = head.parentElement;
  const open = !sec.classList.contains('open');
  document.querySelectorAll('#settingsBody .set-section').forEach((s) => setSectionOpen(s, s === sec && open));
  if (open) setTimeout(() => sec.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
});
// Liste « Onglet à exporter » : les onglets (sur l'onglet affiché par défaut) ; en démo, seulement la démo
function fillExportSpaces(selected) {
  const sel = $('#exportSpace');
  const list = space === 'demo' ? [{ id: 'demo', name: 'Démo' }] : spaces;
  const keep = list.some((s) => s.id === selected) ? selected : list.some((s) => s.id === sel.value) ? sel.value : list[0].id;
  sel.innerHTML = list.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  sel.value = keep;
}
const THEME_SUM = { auto: 'Auto', light: 'Clair', dark: 'Sombre' };
function updateThemeSummary() { $('#sumTheme').textContent = THEME_SUM[localStorage.getItem('theme') || 'auto']; }

/* ---------- Gestion des onglets (Réglages) ---------- */
function saveSpaces(list) {
  spaces = cleanSpaces(list);
  settings.spaces = spaces;
  render();
  renderTabsAdmin();
  save(setDoc(settingsRef(), { spaces }, { merge: true }));
}

function renderTabsAdmin() {
  const n = spaces.length;
  $('#tabsAdmin').innerHTML = spaces.map((s, i) => `<li>
      <button type="button" class="tab-edit" data-tab-edit="${s.id}" aria-label="Modifier l’onglet ${esc(s.name)}">
        <span class="swatch" data-color="${s.theme}"></span><span class="tab-name">${esc(s.name)}</span>${ICON.pencil}
      </button>
      <button type="button" class="icon-btn" data-tab-move="-1" data-id="${s.id}" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${ICON.up}</button>
      <button type="button" class="icon-btn" data-tab-move="1" data-id="${s.id}" aria-label="Descendre" ${i === n - 1 ? 'disabled' : ''}>${ICON.down}</button>
      <button type="button" class="icon-btn danger" data-tab-del="${s.id}" aria-label="Supprimer l’onglet ${esc(s.name)}"
        ${n === 1 ? 'disabled title="Il faut garder au moins un onglet"' : ''}>${ICON.trash}</button>
    </li>`).join('');
  $('#addTabBtn').hidden = n >= MAX_TABS;
  $('#tabsFull').hidden = n < MAX_TABS;
  $('#sumTabs').textContent = `${n} onglet${n > 1 ? 's' : ''}`;
  if (space !== 'demo') fillExportSpaces($('#exportSpace').value); // noms ou liste modifiés pendant que les Réglages sont ouverts
}

$('#tabsAdmin').addEventListener('click', (e) => {
  const ed = e.target.closest('[data-tab-edit]');
  if (ed) { openTabDialog(ed.dataset.tabEdit); return; }
  const mv = e.target.closest('[data-tab-move]');
  if (mv) {
    const list = [...spaces];
    const i = list.findIndex((s) => s.id === mv.dataset.id);
    const j = i + Number(mv.dataset.tabMove);
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    saveSpaces(list);
    return;
  }
  const del = e.target.closest('[data-tab-del]');
  if (del) deleteSpace(del.dataset.tabDel);
});
$('#addTabBtn').addEventListener('click', () => openTabDialog(null));

// Fenêtre « Nouvel onglet » / « Modifier l'onglet » : nom (12 caractères au plus, sans doublon) et couleur (une par onglet)
let tabEditing = null; // id de l'onglet modifié, null pour un nouvel onglet
let tabColor = null;
function openTabDialog(id) {
  const s = id ? spaceOf(id) : null;
  if (id && !s) return;
  if (!id && spaces.length >= MAX_TABS) return;
  tabEditing = id;
  const used = new Set(spaces.filter((x) => x.id !== id).map((x) => x.theme));
  tabColor = s ? s.theme : THEMES.find((t) => !used.has(t)) || THEMES[0];
  $('#tabDlgTitle').textContent = s ? 'Modifier l’onglet' : 'Nouvel onglet';
  const f = $('#tabForm');
  f.tabname.value = s ? s.name : '';
  $('#tabError').hidden = true;
  $('#colorGrid').innerHTML = THEMES.map((t) => `<button type="button" class="color-opt${t === tabColor ? ' active' : ''}" data-color="${t}"
      data-pick="${t}" aria-pressed="${t === tabColor}" ${used.has(t) ? 'disabled title="Déjà utilisée par un autre onglet"' : ''}>
      <span class="swatch"></span>${THEME_NAME[t]}</button>`).join('');
  $('#tabDlg').showModal();
  if (!s || !matchMedia('(pointer: coarse)').matches) f.tabname.focus();
}
$('#colorGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b || b.disabled) return;
  tabColor = b.dataset.pick;
  $('#colorGrid').querySelectorAll('[data-pick]').forEach((x) => {
    x.classList.toggle('active', x === b);
    x.setAttribute('aria-pressed', String(x === b));
  });
});
$('#tabCancel').addEventListener('click', () => $('#tabDlg').close());
$('#tabForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  const name = f.tabname.value.replace(/\s+/g, ' ').trim();
  const err = (msg) => { $('#tabError').textContent = msg; $('#tabError').hidden = false; f.tabname.focus(); };
  if (!name) return err('Donne un nom à l’onglet.');
  if (name.length > NAME_MAX) return err(`${NAME_MAX} caractères au plus.`);
  if (spaces.some((s) => s.id !== tabEditing && s.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'))) return err('Un autre onglet porte déjà ce nom.');
  if (tabEditing) {
    saveSpaces(spaces.map((s) => (s.id === tabEditing ? { ...s, name, theme: tabColor } : s)));
  } else {
    if (spaces.length >= MAX_TABS) { $('#tabDlg').close(); return; }
    let id;
    do { id = 't' + Math.random().toString(36).slice(2, 10); } while (spaceOf(id) || [...tasks.values()].some((t) => t.space === id));
    saveSpaces([...spaces, { id, name, theme: tabColor }]);
    toast(`Onglet « ${name} » ajouté`);
  }
  $('#tabDlg').close();
});

// Suppression d'un onglet : refusée s'il reste des tâches non terminées (non démarrées, en cours ou en pause) ;
// s'il ne reste que des tâches terminées, elles sont supprimées avec l'onglet, après confirmation (sans « Annuler »).
// Les sous-tâches suivent leur tâche parente.
async function deleteSpace(id) {
  const s = spaceOf(id);
  if (!s) return;
  if (spaces.length === 1) { toast('Il faut garder au moins un onglet.'); return; }
  const inTab = [...tasks.values()].filter((t) => t.space === id);
  const parents = inTab.filter((t) => !t.parentId);
  const open = parents.filter((t) => t.status !== 2).length;
  if (open) {
    const pr = open > 1 ? 'les' : 'la';
    await askConfirm(`Il reste ${open} tâche${open > 1 ? 's' : ''} non terminée${open > 1 ? 's' : ''} dans « ${s.name} » : `
      + `termine-${pr}, déplace-${pr} ou supprime-${pr} d’abord.`, 'OK', false);
    return;
  }
  const done = parents.length;
  const msg = done
    ? `« ${s.name} » contient ${done} tâche${done > 1 ? 's' : ''} terminée${done > 1 ? 's' : ''}, qui ${done > 1 ? 'seront supprimées' : 'sera supprimée'} avec l’onglet. Pense à exporter avant.`
    : `Supprimer l’onglet « ${s.name} » ?`;
  if (!await askConfirm(msg)) return;
  const rest = spaces.filter((x) => x.id !== id);
  // Par lots (une écriture groupée Firestore accepte 500 opérations au plus) ; la liste des onglets est mise à jour en dernier
  const ids = inTab.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 450) {
    const batch = writeBatch(db);
    ids.slice(i, i + 450).forEach((x) => batch.delete(taskRef(x)));
    save(batch.commit());
  }
  delete labelFilter[id];
  saveSpaces(rest);
  toast(`Onglet « ${s.name} » supprimé`);
}
$('#themeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  localStorage.setItem('theme', b.dataset.theme);
  applyTheme();
  updateThemeSummary();
});
$('#logoutBtn').addEventListener('click', async () => {
  $('#settings').close();
  if (await askConfirm('Se déconnecter de cet appareil ?', 'Se déconnecter')) signOut(auth);
});
$('#exportBtn').addEventListener('click', exportReadable);
$('#backupBtn').addEventListener('click', exportBackup);

// 'AAAA-MM-JJ' → 'jj/mm/aaaa' (reconnu comme une date par Excel en français)
const frDay = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
const frTs = (t) => (t && typeof t.toDate === 'function' ? frDay(toISO(t.toDate())) : '');

// Export lisible (ex. pour un point avec sa cheffe) : l'onglet choisi dans la liste (l'onglet affiché par défaut ; la démo en démo),
// toutes étiquettes, dans l'ordre de son écran (son tri). La colonne N° permet de retrouver cet ordre après un tri dans Excel.
function exportReadable() {
  const sid = $('#exportSpace').value;
  if (sid !== 'demo' ? !spaceOf(sid) : space !== 'demo') return;
  const withSubs = $('#exportSubs').checked;
  const parents = [...tasks.values()].filter((t) => t.space === sid && !t.parentId);
  const { active, paused, done } = groupParents(parents, settings.sort?.[sid] || 'custom');
  const rows = [['N°', 'Titre', 'Priorité', 'État', 'Échéance', 'Étiquette', 'Créée le', 'En pause depuis', 'Terminée le']];
  // Une sous-tâche reprend l'étiquette de sa parente : un filtre par étiquette dans Excel la garde avec elle
  const line = (t, parent) => [rows.length, (parent ? '↳ ' : '') + t.title, PRIO[t.priority] || '', STATUS[t.status || 0],
    frDay(t.due), (parent || t).label || '', frTs(t.createdAt), t.status === 3 ? frTs(t.pausedAt) : '', t.status === 2 ? frTs(t.completedAt) : ''];
  let count = 0;
  for (const p of [...active, ...paused, ...done]) {
    rows.push(line(p, null));
    count++;
    if (withSubs) childrenOf(p.id).forEach((k) => rows.push(line(k, p)));
  }
  // Nom de fichier d'après le nom de l'onglet, sans accents ni caractères spéciaux (ex. « Démo » → taches-demo-…)
  const slug = spaceName(sid).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'onglet';
  downloadCSV(rows, `taches-${slug}-${toISO(new Date())}.csv`, true);
  const subs = rows.length - 1 - count;
  toast(`${count} tâche(s) ${spaceName(sid)} exportée(s)` + (subs ? ` + ${subs} sous-tâche(s)` : ''));
}

// Sauvegarde complète (tous les onglets sauf la démo, avec les champs techniques) : copie de secours, base de l'import prévu en V2
function exportBackup() {
  const fmtTs = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : '');
  const header = ['espace', 'onglet', 'id', 'tache_parente', 'titre', 'statut', 'echeance', 'priorite', 'etiquette', 'position', 'creee_le', 'terminee_le', 'en_pause_le'];
  const rows = [header];
  const line = (t) => [t.space, spaceOf(t.space)?.name || '', t.id, t.parentId || '', t.title, STATUS[t.status || 0], t.due || '', t.priority ? PRIO[t.priority] : '',
    t.label || '', t.position ?? '', fmtTs(t.createdAt), fmtTs(t.completedAt), t.status === 3 ? fmtTs(t.pausedAt) : ''];
  // Onglets dans leur ordre, puis d'éventuelles tâches d'un onglet qui n'est plus dans la liste (par sécurité, rien n'est perdu)
  const ids = [...spaces.map((s) => s.id), ...new Set([...tasks.values()].map((t) => t.space).filter((x) => x !== 'demo' && !spaceOf(x)))];
  for (const s of ids) {
    const parents = [...tasks.values()].filter((t) => t.space === s && !t.parentId)
      .sort((a, b) => ((a.status === 2) - (b.status === 2)) || ((a.status === 3) - (b.status === 3)) || byPos(a, b));
    for (const p of parents) {
      rows.push(line(p));
      childrenOf(p.id).forEach((k) => rows.push(line(k)));
    }
  }
  // Sous-tâches orphelines éventuelles (la démo n'est pas exportée)
  [...tasks.values()].filter((t) => t.space !== 'demo' && t.parentId && !tasks.has(t.parentId)).forEach((t) => rows.push(line(t)));
  downloadCSV(rows, `sauvegarde-taches-${toISO(new Date())}.csv`, false);
  toast(`${rows.length - 1} ligne(s) exportée(s)`);
}

// CSV pour Excel : séparateur « ; », BOM UTF-8. forExcel : un texte commençant par = + - @ serait pris
// pour une formule par Excel (ex. « -relancer » → #NOM?) ; on le préfixe alors d'un espace (testé dans Excel le 21/11/2026 :
// l'espace se voit à peine, alors qu'une apostrophe resterait affichée).
function downloadCSV(rows, filename, forExcel) {
  const csv = rows.map((r) => r.map((v) => {
    let s = v == null ? '' : String(v);
    if (forExcel && typeof v === 'string' && /^[=+\-@]/.test(s)) s = ' ' + s;
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) {
  // Quand une nouvelle version vient de s'installer, on recharge pour l'afficher tout de suite,
  // sauf si une saisie est en cours (elle s'affichera alors à la prochaine ouverture).
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    if (document.querySelector('dialog[open]') || $('#quickInput').value.trim() || recognition || dragging) {
      toast('Nouvelle version prête : elle s’affichera à la prochaine ouverture.', 4000);
      return;
    }
    reloading = true;
    location.reload();
  });
  // L'appli reste souvent ouverte en arrière-plan sur le téléphone : on cherche une mise à jour à chaque retour
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
  });
  // updateViaCache 'none' : version.js (importé par sw.js) est toujours vérifié auprès du serveur
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {}));
}
