import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, setDoc, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';
import { parseQuickAdd, toISO, addDays } from './dateparse.js';

/* ---------- Firebase ---------- */
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
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
let settings = { sort: { pro: 'custom', perso: 'custom' } };
let space = localStorage.getItem('space') === 'perso' ? 'perso' : 'pro';
let labelFilter = { pro: null, perso: null };
let collapsed = new Set(JSON.parse(localStorage.getItem('collapsed') || '[]'));
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
  outdent: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M9 8l-4 4 4 4"/></svg>',
  tag: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.2"/></svg>',
  subs: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
const PRIO = { 1: 'Haute', 2: 'Moyenne', 3: 'Basse' };
const STATUS = ['Non démarrée', 'En cours', 'Terminée'];

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

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
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

/* ---------- Thème ---------- */
const mq = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = localStorage.getItem('theme') || 'auto';
  html.classList.toggle('dark', t === 'dark' || (t === 'auto' && mq.matches));
  html.dataset.space = space;
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
getRedirectResult(auth).catch(loginError);

$('#loginBtn').addEventListener('click', async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(err.code)) {
      await signInWithRedirect(auth, provider);
    } else loginError(err);
  }
});

onAuthStateChanged(auth, (u) => {
  unsubs.forEach((f) => f());
  unsubs = [];
  user = u;
  if (!u) { tasks = new Map(); show('login'); return; }
  $('#userEmail').textContent = u.email || '';
  firstSnapshot = true;
  show('app');
  render();
  unsubs.push(onSnapshot(tasksCol(), (snap) => {
    $('#dbError').hidden = true;
    tasks = new Map();
    snap.forEach((d) => tasks.set(d.id, { id: d.id, ...d.data() }));
    requestRender();
    if (firstSnapshot) { firstSnapshot = false; handleStartNew(); }
  }, dbError));
  unsubs.push(onSnapshot(settingsRef(), (d) => {
    if (d.exists()) {
      const data = d.data();
      settings = { ...settings, ...data, sort: { ...settings.sort, ...(data.sort || {}) } };
    }
    requestRender();
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

function handleStartNew() {
  if (startNew === 'pro' || startNew === 'perso') setSpace(startNew);
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
  if (t.due) {
    const overdue = t.status !== 2 && t.due < toISO(new Date());
    parts.push(`<span class="chip${overdue ? ' overdue' : ''}">${ICON.cal}${esc(dueLabel(t.due))}</span>`);
  }
  if (t.label && !t.parentId) parts.push(`<span class="chip">${ICON.tag}${esc(t.label)}</span>`);
  if (kids && kids.length) parts.push(`<span class="chip">${ICON.subs}${kids.filter((k) => k.status === 2).length}/${kids.length}</span>`);
  return parts.length ? `<div class="meta">${parts.join('')}</div>` : '';
}

function subHTML(k, canDrag) {
  return `<li class="sub${k.status === 2 ? ' is-done' : ''}" data-id="${k.id}"><div class="row">
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
  return `<li class="task${done ? ' is-done' : ''}" data-id="${t.id}">
    <div class="row">
      ${mode === 'custom' && !done ? `<span class="handle phandle" aria-hidden="true">${ICON.grip}</span>` : ''}
      ${checkHTML(t)}
      ${prioHTML(t)}
      <div class="body" data-edit="${t.id}"><div class="title">${esc(t.title)}</div>${metaHTML(t, kids)}</div>
      ${kids.length ? `<button type="button" class="toggle${isCollapsed ? '' : ' open'}" data-toggle="${t.id}" aria-label="Afficher ou masquer les sous-tâches">${ICON.chevron}</button>` : ''}
    </div>
    ${kids.length && !isCollapsed ? `<ul class="subs" data-parent="${t.id}">${kids.map((k) => subHTML(k, !done)).join('')}</ul>` : ''}
  </li>`;
}

function render() {
  if (!user) return;
  applyTheme();
  document.querySelectorAll('.tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.space === space);
    b.setAttribute('aria-selected', b.dataset.space === space);
  });
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
  const active = parents.filter((t) => t.status !== 2);
  const done = parents.filter((t) => t.status === 2);
  if (mode === 'due') active.sort((a, b) => cmpDue(a, b) || byPos(a, b));
  else if (mode === 'priority') active.sort((a, b) => cmpPrio(a, b) || cmpDue(a, b) || byPos(a, b));
  else active.sort(byPos);
  done.sort((a, b) => tsOf(b.completedAt) - tsOf(a.completedAt));

  $('#activeList').innerHTML = active.map((t) => taskHTML(t, mode)).join('');
  $('#emptyState').hidden = active.length > 0;
  $('#doneSection').hidden = done.length === 0;
  $('#doneTitle').textContent = `Terminées (${done.length})`;
  $('#doneList').innerHTML = done.map((t) => taskHTML(t, mode)).join('');

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
const SWIPE_DONE = 64; // px à atteindre pour valider
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
  render();
  window.scrollTo({ top: 0 });
}

function cycleStatus(id) {
  const t = tasks.get(id);
  if (!t) return;
  const next = ((t.status || 0) + 1) % 3;
  const batch = writeBatch(db);
  batch.update(taskRef(id), { status: next, completedAt: next === 2 ? serverTimestamp() : null, updatedAt: serverTimestamp() });
  if (!t.parentId && next === 2) {
    childrenOf(id).forEach((k) => {
      if (k.status !== 2) batch.update(taskRef(k.id), { status: 2, completedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    });
  }
  save(batch.commit());
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

function askConfirm(msg, yesLabel = 'Supprimer') {
  return new Promise((resolve) => {
    const dlg = $('#confirmDlg');
    $('#confirmMsg').textContent = msg;
    $('#confirmYes').textContent = yesLabel;
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
  $('#subsEditor').hidden = !!t.parentId;
  $('#newSubInput').value = '';
  renderSubsEditor();
  $('#editor').showModal();
}

function renderSubsEditor() {
  const list = $('#subsEditList');
  if (!editingId || list.contains(document.activeElement)) return;
  const kids = childrenOf(editingId);
  list.innerHTML = kids.map((k) => `<li class="${k.status === 2 ? 'is-done' : ''}" data-id="${k.id}">
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
  const batch = writeBatch(db);
  batch.update(taskRef(t.id), {
    title, status, due: f.due.value || null, priority: f.priority.value ? +f.priority.value : null, label,
    completedAt: status === 2 ? (t.status === 2 ? t.completedAt ?? serverTimestamp() : serverTimestamp()) : null,
    updatedAt: serverTimestamp(),
  });
  if (!t.parentId && status === 2 && t.status !== 2) {
    childrenOf(t.id).forEach((k) => { if (k.status !== 2) batch.update(taskRef(k.id), { status: 2, completedAt: serverTimestamp() }); });
  }
  save(batch.commit());
  if (label && labelFilter[space] && label !== labelFilter[space]) labelFilter[space] = null;
  $('#editor').close();
});
$('#cancelEditBtn').addEventListener('click', () => $('#editor').close());
$('#editor').addEventListener('close', () => { editingId = null; });

$('#deleteTaskBtn').addEventListener('click', async () => {
  const t = tasks.get(editingId);
  if (!t) return;
  const kids = childrenOf(t.id);
  const msg = kids.length ? `Supprimer « ${t.title} » et ses ${kids.length} sous-tâche(s) ?` : `Supprimer « ${t.title} » ?`;
  $('#editor').close();
  if (await askConfirm(msg)) deleteTasks([t.id, ...kids.map((k) => k.id)]);
});

const subsList = $('#subsEditList');
subsList.addEventListener('click', async (e) => {
  const chk = e.target.closest('[data-check]');
  if (chk) { cycleStatus(chk.dataset.check); return; }
  const del = e.target.closest('[data-subdel]');
  if (del) deleteTasks([del.dataset.subdel]);
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
$('#doneList').addEventListener('click', onListClick);

document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setSpace(b.dataset.space)));
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
$('#settingsBtn').addEventListener('click', () => { applyTheme(); $('#settings').showModal(); });
$('#closeSettingsBtn').addEventListener('click', () => $('#settings').close());
$('#themeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('[data-theme]');
  if (!b) return;
  localStorage.setItem('theme', b.dataset.theme);
  applyTheme();
});
$('#logoutBtn').addEventListener('click', async () => {
  $('#settings').close();
  if (await askConfirm('Se déconnecter de cet appareil ?', 'Se déconnecter')) signOut(auth);
});
$('#exportBtn').addEventListener('click', exportCSV);

function exportCSV() {
  const fmtTs = (t) => (t && typeof t.toDate === 'function' ? t.toDate().toISOString() : '');
  const header = ['espace', 'id', 'tache_parente', 'titre', 'statut', 'echeance', 'priorite', 'etiquette', 'position', 'creee_le', 'terminee_le'];
  const rows = [header];
  const line = (t) => [t.space, t.id, t.parentId || '', t.title, STATUS[t.status || 0], t.due || '', t.priority ? PRIO[t.priority] : '',
    t.label || '', t.position ?? '', fmtTs(t.createdAt), fmtTs(t.completedAt)];
  for (const s of ['pro', 'perso']) {
    const parents = [...tasks.values()].filter((t) => t.space === s && !t.parentId)
      .sort((a, b) => ((a.status === 2) - (b.status === 2)) || byPos(a, b));
    for (const p of parents) {
      rows.push(line(p));
      childrenOf(p.id).forEach((k) => rows.push(line(k)));
    }
  }
  // Sous-tâches orphelines éventuelles
  [...tasks.values()].filter((t) => t.parentId && !tasks.has(t.parentId)).forEach((t) => rows.push(line(t)));
  const csv = rows.map((r) => r.map((v) => {
    const s = v == null ? '' : String(v);
    return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `taches-${toISO(new Date())}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast(`${rows.length - 1} ligne(s) exportée(s)`);
}

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
