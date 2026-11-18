// Reconnaissance des dates en français dans une saisie rapide.
// parseQuickAdd("Appeler Paul pour vendredi", new Date()) -> { title: "Appeler Paul", due: "2026-11-20" }

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'f[ée]vrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'ao[uû]t', 'septembre', 'octobre', 'novembre', 'd[ée]cembre'];

const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d, n) => { const r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; };

function validDate(y, m, d) {
  const r = new Date(y, m, d);
  return r.getFullYear() === y && r.getMonth() === m && r.getDate() === d ? r : null;
}

function monthIndex(word) {
  const w = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'].indexOf(w);
}

// Chaque règle : motif (sans préfixe) + fonction qui renvoie une Date ou null.
const RULES = [
  { re: "aujourd'hui|aujourd’hui|ce soir", fn: (m, t) => t },
  { re: 'apr[eè]s[- ]demain', fn: (m, t) => addDays(t, 2) },
  { re: 'demain', fn: (m, t) => addDays(t, 1) },
  { re: 'dans (\\d{1,3}) jours?', fn: (m, t) => addDays(t, +m[1]) },
  { re: 'dans (\\d{1,2}) semaines?', fn: (m, t) => addDays(t, 7 * m[1]) },
  { re: 'la semaine prochaine|semaine prochaine', fn: (m, t) => addDays(t, ((8 - t.getDay()) % 7) || 7) },
  {
    re: '(?:le )?(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?',
    fn: (m, t) => {
      let y = m[3] ? +m[3] : t.getFullYear();
      if (y < 100) y += 2000;
      let d = validDate(y, m[2] - 1, +m[1]);
      if (d && !m[3] && d < t) d = validDate(y + 1, m[2] - 1, +m[1]);
      return d;
    },
  },
  {
    re: `(?:le )?(1er|\\d{1,2}) (${MONTHS.join('|')})(?: (\\d{4}))?`,
    fn: (m, t) => {
      const day = m[1] === '1er' ? 1 : +m[1];
      const mon = monthIndex(m[2]);
      const y = m[3] ? +m[3] : t.getFullYear();
      let d = validDate(y, mon, day);
      if (d && !m[3] && d < t) d = validDate(y + 1, mon, day);
      return d;
    },
  },
  {
    re: `(${DAYS.join('|')})(?: prochain)?`,
    fn: (m, t) => {
      const target = DAYS.indexOf(m[1].toLowerCase());
      const diff = (target - t.getDay() + 7) % 7 || 7;
      return addDays(t, diff);
    },
  },
  {
    // « le 25 » seul : ce mois-ci, ou le mois suivant si la date est passée
    re: 'le (1er|\\d{1,2})',
    fn: (m, t) => {
      const day = m[1] === '1er' ? 1 : +m[1];
      let d = validDate(t.getFullYear(), t.getMonth(), day);
      if (d && d < t) d = validDate(t.getFullYear(), t.getMonth() + 1, day);
      return d;
    },
  },
];

const PREFIX = "(?:(?:pour|d'ici|d’ici|avant|à rendre|a rendre)\\s+)?(?:(?:le|ce|cette)\\s+(?=lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|semaine))?";

export function parseQuickAdd(input, now = new Date()) {
  let text = (input || '').replace(/\s+/g, ' ').trim();
  // Dictée : « … point » en fin de phrase
  text = text.replace(/[\s,]+point\s*$/i, '').replace(/[.!]+$/, '').trim();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let due = null;

  for (const rule of RULES) {
    const re = new RegExp(`(^|\\s)${PREFIX}(?:${rule.re})(?=$|[\\s.,;!?])`, 'i');
    const m = text.match(re);
    if (!m) continue;
    // Les groupes de la règle commencent après le groupe (^|\s)
    const inner = m[0].slice(m[1].length).replace(new RegExp(`^${PREFIX}`, 'i'), '');
    const innerMatch = inner.match(new RegExp(`^(?:${rule.re})$`, 'i'));
    const d = innerMatch ? rule.fn(innerMatch, today) : null;
    if (!d) continue;
    due = toISO(d);
    text = (text.slice(0, m.index) + ' ' + text.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/\s+([,.;!?])/g, '$1').replace(/[\s,;:-]+$/, '').replace(/^[\s,;:-]+/, '').trim();
    break;
  }
  const title = text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  return { title, due };
}
