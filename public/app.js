import { ageOn, targetsFor, classify, BEFORE_MEAL, LOW, bpTargetsFor, classifyBp, BP_COLOUR } from './ranges.js';
import { STRINGS } from './i18n.js';

// ---------- language ----------

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
let lang = store.get('lang') === 'en' ? 'en' : 'ms';
function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.ms[key] ?? key;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
}
function setLang(l) { lang = l; store.set('lang', l); document.documentElement.lang = l; render(); }

// ---------- DOM helpers (no innerHTML with user data) ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  if (value !== undefined) el.value = value;
  return el;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function sv(tag, attrs, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

// ---------- formatting ----------

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => isoDate(new Date());
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoDate(d); };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const thisMonth = () => today().slice(0, 7);
const fmtDate = (s) => { const [y, m, d] = s.split('-'); return `${+d}/${+m}/${y}`; };
const fmtDayShort = (s) => {
  if (s === today()) return t('today');
  if (s === yesterday()) return t('yesterday');
  const [, m, d] = s.split('-').map(Number);
  return `${d} ${t('monthsShort')[m - 1]}`;
};
const fmtDateLong = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  const wd = t('weekdays')[new Date(y, m - 1, d).getDay()];
  const prefix = s === today() ? `${t('today')} · ` : s === yesterday() ? `${t('yesterday')} · ` : '';
  return `${prefix}${wd}, ${d} ${t('months')[m - 1]}`;
};
const monthLabel = (m) => { const [y, n] = m.split('-').map(Number); return `${t('months')[n - 1]} ${y}`; };
const shiftMonth = (m, delta) => { const [y, n] = m.split('-').map(Number); const d = new Date(y, n - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysIn = (m) => { const [y, n] = m.split('-').map(Number); return new Date(y, n, 0).getDate(); };
const fmt1 = (v) => Number(v).toFixed(1);
const genderLabel = (g) => t(g === 'male' ? 'male' : 'female');
const initial = (name) => name.trim()[0]?.toUpperCase() || '?';
const LEVEL_ICON = { low: '▼', below: '↓', normal: '✓', above: '↑', high: '▲' };
const KIND_ICON = { glucose: '🩸', weight: '⚖️', food: '🍽️', activity: '🚶', bp: '❤️' };
const BP_ICON = { low: '↓', normal: '✓', above: '↑', high: '▲', veryhigh: '▲' };
const fmtBp = (e) => `${Math.round(e.value)}/${Math.round(e.value2)}`;

// ---------- API ----------

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.endsWith('/login')) { state.me = null; location.hash = '#/login'; }
  if (!res.ok) throw new Error(data.error || t('errorGeneric'));
  return data;
}

const state = { me: undefined, config: { allowRegistration: true }, month: thisMonth() };

// ---------- shared widgets ----------

function toast(msg, kind = '') {
  const el = h('div', { class: `toast ${kind}`, role: 'status' }, msg);
  document.body.append(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2500);
}

// Full-height sheet on phones, centred dialog on big screens.
function sheet(title, content) {
  const dlg = h('dialog', { class: 'sheet' },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'sheet-body' }, content));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function signalPill(level, value) {
  return h('span', { class: `pill ${level}` },
    h('span', { 'aria-hidden': 'true' }, LEVEL_ICON[level]), ' ',
    value != null ? [h('b', {}, fmt1(value)), ' '] : null,
    t('level_' + level));
}

function bpPill(level, e) {
  return h('span', { class: `pill ${BP_COLOUR[level]}` },
    h('span', { 'aria-hidden': 'true' }, BP_ICON[level]), ' ',
    e ? [h('b', {}, fmtBp(e)), ' '] : null,
    t('bp_' + level));
}

function chips(name, options, selected, { required = false } = {}) {
  return h('div', { class: 'chips', role: 'radiogroup' }, options.map((o, i) =>
    h('label', { class: 'chip' },
      h('input', { type: 'radio', name, value: o.value, checked: o.value === selected, required: required && i === 0 }),
      h('span', {}, o.icon ? h('span', { class: 'chip-icon', 'aria-hidden': 'true' }, o.icon) : null, o.label))));
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

function langToggle() {
  return h('div', { class: 'lang', role: 'group', 'aria-label': 'Language' },
    h('button', { type: 'button', class: lang === 'ms' ? 'on' : '', onclick: () => setLang('ms') }, 'BM'),
    h('button', { type: 'button', class: lang === 'en' ? 'on' : '', onclick: () => setLang('en') }, 'EN'));
}

function download(name, text, mime) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function monthNav(month, onChange) {
  return h('div', { class: 'month-nav' },
    h('button', { class: 'round-btn', 'aria-label': t('prevMonth'), onclick: () => onChange(shiftMonth(month, -1)) }, '‹'),
    h('div', { class: 'month-label' }, monthLabel(month)),
    h('button', { class: 'round-btn', 'aria-label': t('nextMonth'), disabled: month >= thisMonth(), onclick: () => onChange(shiftMonth(month, 1)) }, '›'));
}

// ---------- login / register ----------

function renderLogin(root) {
  let mode = 'login';
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'stack' });
  const draw = () => {
    form.replaceChildren(...[
      mode === 'register' ? field(t('yourName'), h('input', { name: 'display_name', autocomplete: 'name', placeholder: t('yourNameEg') })) : null,
      field(t('username'), h('input', { name: 'username', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }), mode === 'register' ? t('usernameHint') : null),
      field(t('password'), h('input', { name: 'password', type: 'password', required: true, minlength: mode === 'register' ? 6 : null, autocomplete: mode === 'register' ? 'new-password' : 'current-password' }), mode === 'register' ? t('passwordHint') : null),
      err,
      h('button', { class: 'btn primary block', type: 'submit' }, mode === 'login' ? t('login') : t('createAccount')),
      state.config.allowRegistration ? h('p', { class: 'center muted' },
        mode === 'login' ? t('noAccount') : t('haveAccount'), ' ',
        h('button', { type: 'button', class: 'link', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; err.textContent = ''; draw(); } },
          mode === 'login' ? t('register') : t('login'))) : null,
    ].filter(Boolean));
  };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    try {
      state.me = await api('POST', mode === 'login' ? '/api/login' : '/api/register', Object.fromEntries(new FormData(form)));
      location.hash = '#/';
    } catch (e) { err.textContent = e.message; }
  });
  draw();
  root.replaceChildren(
    h('div', { class: 'login-wrap' },
      h('div', { class: 'login-lang' }, langToggle()),
      h('div', { class: 'login-logo', 'aria-hidden': 'true' }, '🩸'),
      h('h1', { class: 'center' }, t('appName')),
      h('p', { class: 'center muted' }, t('tagline')),
      form));
}

// ---------- home: list of people ----------

async function renderHome(root) {
  const profiles = await api('GET', '/api/profiles');
  root.replaceChildren(
    h('header', { class: 'bar' },
      h('div', { class: 'bar-title' }, '🩸 ', t('appName')),
      h('button', { class: 'icon-btn', 'aria-label': t('settings'), onclick: openSettings }, '⚙')),
    h('main', { class: 'page' },
      h('p', { class: 'lead' }, profiles.length ? t('whoToday') : t('startByAdding')),
      h('div', { class: 'people' },
        profiles.map((p) => {
          const last = p.last_glucose;
          const sig = last ? classify(last.value, last.context, targetsFor(p)) : null;
          return h('a', { class: 'person', href: `#/p/${p.id}` },
            h('div', { class: `avatar ${p.gender}`, 'aria-hidden': 'true' }, initial(p.name)),
            h('div', { class: 'person-main' },
              h('div', { class: 'person-name' }, p.name),
              last ? h('div', {}, signalPill(sig.level, last.value)) : h('div', { class: 'muted small' }, t('noReadingsYet'))),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
        })),
      h('button', { class: 'btn ghost block add-person', onclick: () => openProfileForm() }, '+ ', t('addPerson'))));
}

// ---------- person pages (bottom tabs) ----------

const TABS = [
  { id: '', icon: '🏠', label: 'tabToday' },
  { id: 'graf', icon: '📈', label: 'tabChart' },
  { id: 'sejarah', icon: '📋', label: 'tabHistory' },
];

function personShell(p, tab, content) {
  return [
    h('header', { class: 'bar' },
      h('a', { class: 'icon-btn', href: '#/', 'aria-label': t('allPeople') }, '‹'),
      h('div', { class: 'bar-title center' }, p.name),
      h('button', { class: 'icon-btn', 'aria-label': t('more'), onclick: () => openPersonMenu(p) }, '⋯')),
    h('main', { class: 'page with-tabs' }, content),
    h('nav', { class: 'tabs', 'aria-label': t('menu') }, TABS.map((tb) =>
      h('a', { class: `tab${tb.id === tab ? ' on' : ''}`, href: `#/p/${p.id}${tb.id ? '/' + tb.id : ''}`, 'aria-current': tb.id === tab ? 'page' : null },
        h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, tb.icon), h('span', {}, t(tb.label))))),
  ];
}

const loadMonth = (id, month) => api('GET', `/api/profiles/${id}/entries?from=${month}-01&to=${month}-31`);
const changeMonth = (m) => { state.month = m; render(); };

async function renderToday(root, id) {
  const [p, entries] = await Promise.all([api('GET', `/api/profiles/${id}`), api('GET', `/api/profiles/${id}/entries?from=${today()}&to=${today()}`)]);
  const targets = targetsFor(p);
  root.replaceChildren(...personShell(p, '', [
    latestCard(p, targets),
    h('button', { class: 'big-action', onclick: () => openEntry(p, 'glucose') }, '＋ ', t('addGlucoseShort')),
    latestBp(p),
    h('div', { class: 'small-actions' },
      smallAction('❤️', t('addBp'), () => openEntry(p, 'bp')),
      smallAction('🍽️', t('addFood'), () => openEntry(p, 'food')),
      smallAction('🚶', t('addActivity'), () => openEntry(p, 'activity')),
      smallAction('⚖️', t('addWeight'), () => openEntry(p, 'weight'))),
    entries.length ? [h('h2', { class: 'section-title' }, t('todayRecords')), entryList(p, entries, targets)] : null,
  ]));
}

function smallAction(icon, label, onclick) {
  return h('button', { class: 'small-action', onclick }, h('span', { class: 'small-action-icon', 'aria-hidden': 'true' }, icon), h('span', {}, label));
}

function latestCard(p, targets) {
  const last = p.last_glucose;
  if (!last) return h('section', { class: 'latest none' }, h('div', { class: 'latest-empty', 'aria-hidden': 'true' }, '🩸'), h('p', { class: 'muted' }, t('noReadingsYetLong')));
  const sig = classify(last.value, last.context, targets);
  return h('section', { class: `latest ${sig.level}` },
    h('div', { class: 'latest-label' }, t('lastReading'), ': ', fmtDayShort(last.date), last.time ? ', ' + last.time : ''),
    h('div', { class: 'latest-value' }, fmt1(last.value)),
    h('div', { class: 'latest-signal' }, h('span', { 'aria-hidden': 'true' }, LEVEL_ICON[sig.level]), ' ', t('level_' + sig.level)),
    sig.level !== 'normal' ? h('p', { class: 'latest-advice' }, t('advice_' + sig.level)) : null);
}

// One quiet line under the sugar card: the last blood pressure and its label.
function latestBp(p) {
  const last = p.last_bp;
  if (!last) return null;
  const level = classifyBp(last.value, last.value2, bpTargetsFor(p));
  return h('button', { class: 'latest-bp', onclick: () => openEntry(p, 'bp') },
    h('span', { class: 'latest-bp-label' }, '❤️ ', t('bpShort')),
    h('span', { class: 'latest-bp-value' }, fmtBp(last)),
    bpPill(level),
    h('span', { class: 'latest-bp-when' }, fmtDayShort(last.date), last.time ? ' ' + last.time : ''));
}

async function renderChart(root, id) {
  const month = state.month;
  const [p, entries] = await Promise.all([api('GET', `/api/profiles/${id}`), loadMonth(id, month)]);
  const targets = targetsFor(p);
  const s = computeStats(entries, targets);
  const glucose = entries.filter((e) => e.kind === 'glucose');
  const weight = entries.filter((e) => e.kind === 'weight');
  const bp = entries.filter((e) => e.kind === 'bp');
  const bpT = bpTargetsFor(p);
  const bs = bpStats(bp, bpT);
  root.replaceChildren(...personShell(p, 'graf', [
    monthNav(month, changeMonth),
    h('section', { class: 'card' },
      h('h2', {}, t('glucoseTrend')),
      glucose.length ? [
        h('p', { class: 'chart-summary' }, t('chartSummary', { avg: fmt1(s.avg), a: s.levels.normal, b: s.count })),
        glucoseChart(glucose, targets, periodRange(month)),
        h('p', { class: 'chart-legend' }, h('i', { class: 'key band' }), t('legendBandSimple')),
      ] : h('p', { class: 'empty' }, t('noGlucoseMonth'))),
    bp.length ? h('section', { class: 'card' },
      h('h2', {}, t('bpTrend')),
      h('p', { class: 'chart-summary' }, t('bpSummary', { avg: bs.avgText, a: bs.normal, b: bs.count })),
      bpChart(bp, bpT, periodRange(month)),
      bpLegend(bpT)) : null,
    weight.length ? h('section', { class: 'card' },
      h('h2', {}, t('weightTrend')),
      h('p', { class: 'chart-summary' }, t('weightSummary', { w: s.weightLast.toFixed(1), c: s.weightChange != null ? `${s.weightChange > 0 ? '+' : ''}${s.weightChange.toFixed(1)}` : '0' })),
      weightChart(weight, periodRange(month))) : null,
  ]));
}

async function renderHistory(root, id) {
  const month = state.month;
  const [p, entries] = await Promise.all([api('GET', `/api/profiles/${id}`), loadMonth(id, month)]);
  const targets = targetsFor(p);
  const byDate = new Map();
  entries.forEach((e) => { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); });
  root.replaceChildren(...personShell(p, 'sejarah', [
    monthNav(month, changeMonth),
    h('a', { class: 'btn secondary block', href: `#/p/${p.id}/report/${month}` }, '🖨️ ', t('printReport')),
    entries.length ? [...byDate].map(([date, list]) => h('section', { class: 'day' },
      h('h3', { class: 'day-title' }, fmtDateLong(date)),
      entryList(p, list, targets))) : h('p', { class: 'empty' }, t('noEntriesMonth')),
  ]));
}

// ---------- entries list (tap a row to edit) ----------

function entryText(e) {
  if (e.kind === 'glucose') return [h('b', { class: 'num' }, fmt1(e.value)), ' ', h('span', { class: 'unit' }, t('ctxShort_' + e.context))];
  if (e.kind === 'weight') return [h('b', { class: 'num' }, e.value.toFixed(1)), ' ', h('span', { class: 'unit' }, 'kg')];
  if (e.kind === 'bp') return [h('b', { class: 'num' }, fmtBp(e)), ' ', h('span', { class: 'unit' }, e.pulse ? `${t('pulse')} ${e.pulse}` : 'mmHg')];
  if (e.kind === 'food') return [`${KIND_ICON.food} `, h('b', {}, t('meal_' + e.context)), ': ', e.description];
  return [`${KIND_ICON.activity} `, h('b', {}, e.description), e.duration ? ` · ${e.duration} ${t('min')}` : ''];
}

// Where a record sits in the day, so a day reads from morning to night. Records saved without
// a time are placed by their meal or reading time.
const USUAL_TIME = {
  breakfast: '08:00', lunch: '13:00', dinner: '19:30', snack: '16:00',
  before_breakfast: '07:30', before_meal: '12:30', before_lunch: '12:30', before_dinner: '18:30', after_meal: '21:30', bedtime: '22:30',
};
const dayOrder = (e) => e.time || USUAL_TIME[e.context] || (e.kind === 'weight' ? '07:00' : '12:00');

function entryList(p, list, targets) {
  const bpT = bpTargetsFor(p);
  list = [...list].sort((a, b) => dayOrder(a).localeCompare(dayOrder(b)) || a.id - b.id);
  return h('div', { class: 'entries' }, list.map((e) => {
    let badge = null;
    if (e.kind === 'glucose') {
      const sig = classify(e.value, e.context, targets);
      badge = h('span', { class: `dot-sig ${sig.level}` }, LEVEL_ICON[sig.level], ' ', t('level_' + sig.level));
    } else if (e.kind === 'bp') {
      const level = classifyBp(e.value, e.value2, bpT);
      badge = h('span', { class: `dot-sig ${BP_COLOUR[level]}` }, '❤️ ', t('bp_' + level));
    } else if (e.kind === 'weight') badge = h('span', { class: 'entry-kind' }, KIND_ICON.weight);
    return h('button', { class: 'entry', onclick: () => openEntry(p, e.kind, e) },
      h('span', { class: 'entry-time' }, e.time || '–'),
      h('span', { class: 'entry-body' }, h('span', { class: 'entry-line' }, entryText(e))),
      badge);
  }));
}

// Blood pressure numbers for a list of readings.
function bpStats(list, bpT) {
  const levels = { low: 0, normal: 0, above: 0, high: 0, veryhigh: 0 };
  list.forEach((e) => { levels[classifyBp(e.value, e.value2, bpT)]++; });
  const n = list.length;
  const avg = (k) => Math.round(list.reduce((a, e) => a + e[k], 0) / n);
  const pulses = list.filter((e) => e.pulse);
  return {
    count: n, levels, normal: levels.normal,
    avgSys: n ? avg('value') : null, avgDia: n ? avg('value2') : null,
    avgText: n ? `${avg('value')}/${avg('value2')}` : '—',
    pctNormal: n ? Math.round((levels.normal / n) * 100) : 0,
    maxText: n ? fmtBp(list.reduce((a, e) => (e.value > a.value ? e : a))) : '—',
    avgPulse: pulses.length ? Math.round(pulses.reduce((a, e) => a + e.pulse, 0) / pulses.length) : null,
  };
}

// ---------- stats ----------

function computeStats(entries, targets) {
  const g = entries.filter((e) => e.kind === 'glucose');
  const levels = { low: 0, below: 0, normal: 0, above: 0, high: 0 };
  g.forEach((e) => { levels[classify(e.value, e.context, targets).level]++; });
  const mean = (arr) => (arr.length ? arr.reduce((a, e) => a + e.value, 0) / arr.length : null);
  const vals = g.map((e) => e.value);
  const w = entries.filter((e) => e.kind === 'weight').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const acts = entries.filter((e) => e.kind === 'activity');
  return {
    count: g.length,
    levels,
    avg: mean(g),
    avgBefore: mean(g.filter((e) => BEFORE_MEAL.includes(e.context))),
    avgAfter: mean(g.filter((e) => e.context === 'after_meal')),
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    pctInTarget: g.length ? Math.round((levels.normal / g.length) * 100) : 0,
    weightLast: w.length ? w.at(-1).value : null,
    weightChange: w.length > 1 ? w.at(-1).value - w[0].value : null,
    activityMin: acts.reduce((a, e) => a + (e.duration || 0), 0),
    activityCount: acts.length,
    foodCount: entries.filter((e) => e.kind === 'food').length,
  };
}

// ---------- charts (inline SVG, one axis each) ----------

const dayNum = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 864e5;

// The months a chart or report covers, ending with lastMonth. Axis ticks are days for one month
// and month names for longer periods.
function periodRange(lastMonth, months = 1) {
  const first = shiftMonth(lastMonth, -(months - 1));
  const from = `${first}-01`, to = `${lastMonth}-${pad(daysIn(lastMonth))}`;
  const start = dayNum(from), days = dayNum(to) - start + 1;
  const monthList = Array.from({ length: months }, (_, i) => shiftMonth(first, i));
  const ticks = months === 1
    ? [1, 10, 20, daysIn(lastMonth)].map((d) => ({ f: (d - 0.5) / days, label: String(d) }))
    : monthList.map((m) => ({ f: (dayNum(`${m}-01`) - start + daysIn(m) / 2) / days, label: t('monthsShort')[+m.slice(5) - 1] }));
  const separators = months === 1 ? [] : monthList.slice(1).map((m) => (dayNum(`${m}-01`) - start) / days);
  return { first, last: lastMonth, months, monthList, from, to, start, days, ticks, separators };
}

// x position (0–1) inside the period: day + time of day, so several readings on one day spread out.
function rangeX(e, range) {
  const [hh, mm] = (e.time || '12:00').split(':').map(Number);
  return (dayNum(e.date) - range.start + (hh * 60 + mm) / 1440) / range.days;
}

function chartFrame({ points, yMin, yMax, yStep, range, band, refLines = [], print = false }) {
  // Drawn at phone proportions so text stays readable; the report uses a wide version.
  const W = print ? 640 : 360, H = print ? 200 : 230, L = 30, R = 8, T = 10, B = 26;
  const x = (f) => L + f * (W - L - R);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': t('chartAria') });

  if (band) svg.append(sv('rect', { x: L, width: W - L - R, y: y(band.max), height: y(band.min) - y(band.max), class: 'band' }));
  for (let v = yMin; v <= yMax + 1e-9; v += yStep) {
    svg.append(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }),
      sv('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, Number.isInteger(yStep) ? String(v) : v.toFixed(1)));
  }
  refLines.forEach((r) => svg.append(sv('line', { x1: L, x2: W - R, y1: y(r.v), y2: y(r.v), class: `ref ${r.cls}` })));
  range.separators.forEach((f) => svg.append(sv('line', { x1: x(f), x2: x(f), y1: T, y2: H - B, class: 'grid' })));
  range.ticks.forEach((tk) => svg.append(sv('text', { x: x(tk.f), y: H - 7, 'text-anchor': 'middle', class: 'tick' }, tk.label)));

  const pts = points.map((p) => ({ ...p, px: x(p.x), py: y(p.v) }));
  // one line per series (blood pressure has two: upper and lower)
  const groups = new Map();
  pts.forEach((p) => { const k = p.series || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  groups.forEach((g, k) => { if (g.length > 1) svg.append(sv('polyline', { points: g.map((p) => `${p.px},${p.py}`).join(' '), class: `trend ${k}` })); });
  pts.forEach((p) => svg.append(sv('circle', { cx: p.px, cy: p.py, r: pts.length > 120 ? 2.5 : pts.length > 40 ? 3.5 : 4.5, class: `dot ${p.cls || ''}` })));

  const wrap = h('div', { class: 'chart-wrap' }, svg);
  if (!print) attachTooltip(wrap, svg, pts, W);
  return wrap;
}

function attachTooltip(wrap, svg, pts, W) {
  const tip = h('div', { class: 'tooltip', hidden: true });
  const hair = sv('line', { class: 'hair', y1: 0, y2: '100%', visibility: 'hidden' });
  svg.append(hair);
  wrap.append(tip);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    let best = null, bd = Infinity;
    pts.forEach((p) => { const d = Math.abs(p.px - sx); if (d < bd) { bd = d; best = p; } });
    if (!best || bd > 30) { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); return; }
    hair.setAttribute('x1', best.px); hair.setAttribute('x2', best.px); hair.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('div', { class: 'tip-value' }, best.valueText), ...best.lines.map((l) => h('div', {}, l)));
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max((best.px / W) * r.width, 90), r.width - 90)}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); });
}

function glucoseChart(list, targets, range, print = false) {
  const sorted = [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const vals = sorted.map((e) => e.value);
  const yMin = Math.max(0, Math.floor(Math.min(3, ...vals) - 0.5));
  const yMax = Math.ceil(Math.max(targets.afterMax + 2, ...vals) + 0.5);
  return chartFrame({
    range, print, yMin, yMax, yStep: yMax - yMin > 12 ? 4 : 2,
    band: { min: targets.beforeMin, max: targets.beforeMax },
    refLines: [{ v: targets.afterMax, cls: 'after' }, { v: LOW, cls: 'low' }],
    points: sorted.map((e) => {
      const s = classify(e.value, e.context, targets);
      return { x: rangeX(e, range), v: e.value, cls: s.level, valueText: `${fmt1(e.value)} · ${t('level_' + s.level)}`, lines: [`${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}`, t('ctx_' + e.context)] };
    }),
  });
}

function weightChart(list, range, print = false) {
  const sorted = [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const vals = sorted.map((e) => e.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1);
  const step = span > 6 ? 2 : span > 3 ? 1 : 0.5;
  lo = Math.floor((lo - span * 0.2) / step) * step;
  hi = Math.ceil((hi + span * 0.2) / step) * step;
  return chartFrame({
    range, print, yMin: lo, yMax: hi, yStep: step,
    points: sorted.map((e) => ({ x: rangeX(e, range), v: e.value, cls: 'weight', valueText: `${e.value.toFixed(2)} kg`, lines: [fmtDate(e.date)] })),
  });
}

function bpChart(list, bpT, range, print = false) {
  const sorted = [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const yMin = Math.max(20, Math.floor((Math.min(60, ...sorted.map((e) => e.value2)) - 10) / 20) * 20);
  const yMax = Math.ceil((Math.max(160, ...sorted.map((e) => e.value)) + 10) / 20) * 20;
  const point = (e, series, v) => {
    const level = classifyBp(e.value, e.value2, bpT);
    return { x: rangeX(e, range), v, series, cls: series, valueText: `${fmtBp(e)} mmHg · ${t('bp_' + level)}`, lines: [`${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}`, e.pulse ? `${t('pulse')} ${e.pulse}` : ''].filter(Boolean) };
  };
  return chartFrame({
    range, print, yMin, yMax, yStep: 20,
    refLines: [{ v: bpT.sys, cls: 'sys' }, { v: bpT.dia, cls: 'dia' }],
    points: [...sorted.map((e) => point(e, 'sys', e.value)), ...sorted.map((e) => point(e, 'dia', e.value2))],
  });
}

function bpLegend(bpT) {
  return h('div', { class: 'chart-legend wrap' },
    h('span', {}, h('i', { class: 'key line sys' }), t('bpUpper')),
    h('span', {}, h('i', { class: 'key line dia' }), t('bpLower')),
    h('span', {}, h('i', { class: 'key dashed' }), t('bpTargetLine', { s: bpT.sys, d: bpT.dia })));
}

function chartLegend(targets) {
  return h('div', { class: 'chart-legend' },
    h('span', {}, h('i', { class: 'key band' }), t('legendBand', { min: fmt1(targets.beforeMin), max: fmt1(targets.beforeMax) })),
    h('span', {}, h('i', { class: 'key after' }), t('legendAfter', { v: fmt1(targets.afterMax) })),
    h('span', {}, h('i', { class: 'key low' }), t('legendLow')));
}

// ---------- forms ----------

const GLUCOSE_CTX = ['before_breakfast', 'before_meal', 'after_meal', 'other'];
const MEALS = [['breakfast', '🌅'], ['lunch', '☀️'], ['dinner', '🌙'], ['snack', '🍎']];
const ACTIVITIES = ['walk', 'treadmill', 'exercise', 'cycling', 'gardening', 'swimming'];

function guessMeal() {
  const hr = new Date().getHours();
  return hr < 11 ? 'breakfast' : hr < 16 ? 'lunch' : hr < 22 ? 'dinner' : 'snack';
}

// "Today, 11:12 — Change" line; the date and time inputs stay hidden until asked for.
function whenField(e) {
  const date = h('input', { name: 'date', type: 'date', required: true, max: today(), value: e.date });
  const time = h('input', { name: 'time', type: 'time', value: e.time });
  const inputs = h('div', { class: 'row2', hidden: true }, field(t('date'), date), field(t('time'), time));
  const label = h('span', {}, `📅 ${fmtDayShort(e.date)}${e.time ? ', ' + e.time : ''}`);
  const btn = h('button', { type: 'button', class: 'link', onclick: () => { inputs.hidden = false; summary.hidden = true; } }, t('change'));
  const summary = h('div', { class: 'when-line' }, label, btn);
  return h('div', {}, summary, inputs);
}

function openEntry(p, kind, entry) {
  const e = entry || { kind, date: today(), time: nowTime(), value: '', context: kind === 'food' ? guessMeal() : '', description: '', notes: '', duration: '' };
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'stack' });
  const parts = [];

  if (kind === 'glucose') {
    // show the old detailed choice when editing a reading saved with it
    const ctxList = GLUCOSE_CTX.includes(e.context) || !e.context || e.context === 'unspecified' ? GLUCOSE_CTX : [...GLUCOSE_CTX, e.context];
    parts.push(
      h('div', { class: 'big-input' }, h('input', { name: 'value', type: 'number', inputmode: 'decimal', step: '0.1', min: '0.5', max: '40', required: true, placeholder: '0.0', 'aria-label': t('glucoseReading'), value: e.value }), h('span', {}, 'mmol/L')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('whenTaken')),
        chips('context', ctxList.map((c) => ({ value: c, label: t('ctx_' + c) })), e.context === 'unspecified' ? '' : e.context, { required: true })),
      field(t('notesOptional'), h('input', { name: 'notes', placeholder: t('notesGlucoseEg'), value: e.notes })));
  } else if (kind === 'bp') {
    const num = (name, ph, label, value) => h('label', { class: 'bp-field' },
      h('span', { class: 'field-label' }, label),
      h('input', { name, type: 'number', inputmode: 'numeric', step: '1', min: name === 'value' ? 50 : 30, max: name === 'value' ? 300 : 200, required: true, placeholder: ph, value }));
    parts.push(
      h('div', { class: 'bp-input' },
        num('value', '120', t('bpUpperShort'), e.value ?? ''),
        h('span', { class: 'bp-slash', 'aria-hidden': 'true' }, '/'),
        num('value2', '80', t('bpLowerShort'), e.value2 ?? '')),
      h('p', { class: 'hint center' }, 'mmHg'),
      field(t('pulseOptional'), h('div', { class: 'inline-input' }, h('input', { name: 'pulse', type: 'number', inputmode: 'numeric', min: 30, max: 250, placeholder: '72', value: e.pulse ?? '' }), h('span', {}, t('perMinute')))),
      field(t('notesOptional'), h('input', { name: 'notes', placeholder: t('notesBpEg'), value: e.notes })));
  } else if (kind === 'weight') {
    parts.push(
      h('div', { class: 'big-input' }, h('input', { name: 'value', type: 'number', inputmode: 'decimal', step: '0.05', min: '1', max: '400', required: true, placeholder: '0.0', 'aria-label': t('weightKg'), value: e.value }), h('span', {}, 'kg')),
      h('input', { type: 'hidden', name: 'notes', value: e.notes }));
  } else if (kind === 'food') {
    parts.push(
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('whichMeal')), chips('context', MEALS.map(([m, icon]) => ({ value: m, label: t('meal_' + m), icon })), e.context, { required: true })),
      field(t('whatEaten'), h('textarea', { name: 'description', rows: 3, required: true, placeholder: t('whatEatenEg'), value: e.description })),
      h('input', { type: 'hidden', name: 'notes', value: e.notes }));
  } else {
    const desc = h('input', { name: 'description', required: true, placeholder: t('activityEg'), value: e.description });
    const dur = h('input', { name: 'duration', type: 'number', inputmode: 'numeric', min: '1', max: '1440', placeholder: '30', value: e.duration ?? '' });
    const pick = (group, input, val) => (ev) => {
      input.value = val;
      group.querySelectorAll('.chip-btn').forEach((b) => b.classList.toggle('on', b === ev.currentTarget));
    };
    const actGroup = h('div', { class: 'quick' });
    actGroup.append(...ACTIVITIES.map((a) => h('button', { type: 'button', class: `chip-btn${e.description === t('act_' + a) ? ' on' : ''}`, onclick: pick(actGroup, desc, t('act_' + a)) }, t('act_' + a))));
    const durGroup = h('div', { class: 'quick' });
    durGroup.append(...[10, 15, 30, 45, 60].map((m) => h('button', { type: 'button', class: `chip-btn${Number(e.duration) === m ? ' on' : ''}`, onclick: pick(durGroup, dur, m) }, `${m} ${t('min')}`)));
    parts.push(
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('whatActivity')), actGroup, desc),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('howLong')), durGroup, h('div', { class: 'inline-input' }, dur, h('span', {}, t('minutes')))),
      h('input', { type: 'hidden', name: 'notes', value: e.notes }));
  }

  parts.push(whenField(e), err, h('div', { class: 'sheet-actions' },
    h('button', { type: 'submit', class: 'btn primary block' }, '✓ ', t('save')),
    entry ? h('button', { type: 'button', class: 'btn danger-text block', onclick: async () => {
      if (!confirm(t('confirmDelete'))) return;
      await api('DELETE', `/api/entries/${entry.id}`);
      dlg.close(); toast(t('deleted')); render();
    } }, t('deleteRecord')) : null));
  form.append(...parts);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const body = { kind, ...Object.fromEntries(new FormData(form)) };
    try {
      const saved = entry ? await api('PUT', `/api/entries/${entry.id}`, body) : await api('POST', `/api/profiles/${p.id}/entries`, body);
      dlg.close();
      await render();
      if (kind === 'glucose') showResult(p, saved);
      else if (kind === 'bp') showBpResult(p, saved);
      else toast('✓ ' + t('saved'), 'ok');
    } catch (e2) { err.textContent = e2.message; }
  });

  const titles = { glucose: 'addGlucose', weight: 'addWeight', food: 'addFood', activity: 'addActivity', bp: 'addBp' };
  const dlg = sheet(`${KIND_ICON[kind]} ${entry ? t('editRecord') : t(titles[kind])}`, form);
  if (!entry) form.querySelector('input[name=value], textarea[name=description]')?.focus();
}

// Big, clear feedback right after a glucose reading is saved.
function showResult(p, e) {
  const s = classify(e.value, e.context, targetsFor(p));
  const dlg = sheet(t('resultTitle'), h('div', { class: `result ${s.level}` },
    h('div', { class: 'result-icon', 'aria-hidden': 'true' }, LEVEL_ICON[s.level]),
    h('div', { class: 'result-value' }, fmt1(e.value), h('span', {}, ' mmol/L')),
    h('div', { class: 'result-label' }, t('level_' + s.level)),
    h('p', { class: 'result-advice' }, t('advice_' + s.level)),
    h('p', { class: 'small muted' }, t('ctx_' + e.context), ' · ', t('targetWas', { min: fmt1(s.range.min), max: fmt1(s.range.max) })),
    h('button', { class: 'btn primary block', onclick: () => dlg.close() }, t('ok'))));
}

function showBpResult(p, e) {
  const bpT = bpTargetsFor(p);
  const level = classifyBp(e.value, e.value2, bpT);
  const cls = BP_COLOUR[level];
  const dlg = sheet(t('resultTitle'), h('div', { class: `result ${cls}` },
    h('div', { class: 'result-icon', 'aria-hidden': 'true' }, BP_ICON[level]),
    h('div', { class: 'result-value' }, fmtBp(e), h('span', {}, ' mmHg')),
    e.pulse ? h('div', { class: 'muted' }, `${t('pulse')} ${e.pulse} ${t('perMinute')}`) : null,
    h('div', { class: 'result-label' }, t('bp_' + level)),
    h('p', { class: 'result-advice' }, t('bpAdvice_' + level)),
    h('p', { class: 'small muted' }, t('bpTargetWas', { s: bpT.sys, d: bpT.dia })),
    h('button', { class: 'btn primary block', onclick: () => dlg.close() }, t('ok'))));
}

function openPersonMenu(p) {
  const item = (icon, label, onclick, cls = '') => h('button', { class: `menu-item ${cls}`, onclick: () => { dlg.close(); onclick(); } }, h('span', { 'aria-hidden': 'true' }, icon), label);
  const dlg = sheet(p.name, h('div', { class: 'menu' },
    h('p', { class: 'muted' }, t('yearsOld', { n: ageOn(p.birthdate) }), ' · ', genderLabel(p.gender), ' · ', t('born'), ' ', fmtDate(p.birthdate)),
    item('🖨️', t('monthlyReport'), () => { location.hash = `#/p/${p.id}/report/${state.month}`; }),
    item('🗓️', t('sixMonthReport'), () => { location.hash = `#/p/${p.id}/report/${state.month}/6`; }),
    item('🎯', t('targetsAndColours'), () => openTargets(p)),
    item('✎', t('editPerson'), () => openProfileForm(p)),
    item('⇅', t('backup'), () => openDataTools(p)),
    item('⚙', t('settings'), openSettings)));
}

function openTargets(p) {
  const targets = targetsFor(p);
  const bpT = bpTargetsFor(p);
  sheet(t('targetsAndColours'), h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('div', { class: 'sum-row' }, h('span', {}, t('beforeMeals')), h('b', {}, `${fmt1(targets.beforeMin)} – ${fmt1(targets.beforeMax)}`)),
      h('div', { class: 'sum-row' }, h('span', {}, t('afterMeals')), h('b', {}, `${t('upTo')} ${fmt1(targets.afterMax)}`)),
      h('div', { class: 'sum-row' }, h('span', {}, t('lowBelow')), h('b', {}, `< ${fmt1(LOW)}`))),
    h('p', { class: 'small muted' }, 'mmol/L · ', targets.custom ? t('targetsCustom') : t('targetsDefault', { group: t('group_' + targets.group), age: ageOn(p.birthdate) })),
    h('div', { class: 'legend-col' }, ['normal', 'below', 'above', 'low', 'high'].map((l) => h('div', {}, signalPill(l), ' ', h('span', { class: 'small muted' }, t('meaning_' + l))))),
    h('h3', { class: 'sheet-subtitle' }, '❤️ ', t('bpTitle')),
    h('div', { class: 'card' },
      h('div', { class: 'sum-row' }, h('span', {}, t('bp_normal')), h('b', {}, `< ${bpT.sys}/${bpT.dia}`)),
      h('div', { class: 'sum-row' }, h('span', {}, t('bp_high')), h('b', {}, '≥ 140/90')),
      h('div', { class: 'sum-row' }, h('span', {}, t('bp_veryhigh')), h('b', {}, '≥ 180/110')),
      h('div', { class: 'sum-row' }, h('span', {}, t('bp_low')), h('b', {}, '< 90/60'))),
    h('p', { class: 'small muted' }, 'mmHg · ', bpT.custom ? t('bpTargetsCustom') : t('bpTargetsDefault')),
    h('div', { class: 'legend-col' }, ['normal', 'above', 'high', 'veryhigh', 'low'].map((l) => h('div', {}, bpPill(l), ' ', h('span', { class: 'small muted' }, t('bpMeaning_' + l)))))));
}

function openProfileForm(p) {
  const err = h('p', { class: 'error', role: 'alert' });
  const defaultsHint = h('p', { class: 'hint' });
  const bd = h('input', { name: 'birthdate', type: 'date', required: true, max: today(), min: '1900-01-01', value: p?.birthdate || '' });
  const ageOut = h('span', { class: 'hint' });
  const updateHints = () => {
    if (!bd.value) { ageOut.textContent = ''; defaultsHint.textContent = t('targetsHintNoAge'); return; }
    const tg = targetsFor({ birthdate: bd.value });
    ageOut.textContent = t('ageAuto', { n: ageOn(bd.value) });
    defaultsHint.textContent = t('targetsHint', { group: t('group_' + tg.group), bmin: fmt1(tg.beforeMin), bmax: fmt1(tg.beforeMax), amax: fmt1(tg.afterMax) });
  };
  bd.addEventListener('input', updateHints);
  const num = (name, v) => h('input', { name, type: 'number', inputmode: 'decimal', step: '0.1', min: '2', max: '25', value: v ?? '' });
  const hasCustom = p && [p.target_before_min, p.target_before_max, p.target_after_max, p.target_bp_sys, p.target_bp_dia].some((v) => v != null);
  const form = h('form', { class: 'stack' },
    field(t('name'), h('input', { name: 'name', required: true, maxlength: 80, placeholder: t('nameEg'), value: p?.name || '' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('birthdate')), bd, ageOut),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('gender')),
      chips('gender', [{ value: 'female', label: t('female'), icon: '👩' }, { value: 'male', label: t('male'), icon: '👨' }], p?.gender || '', { required: true })),
    h('details', { class: 'targets-details', open: hasCustom },
      h('summary', {}, '🎯 ', t('doctorTargets')),
      h('p', { class: 'hint' }, t('doctorTargetsHint')),
      defaultsHint,
      field(t('beforeMealMin'), num('target_before_min', p?.target_before_min)),
      field(t('beforeMealMax'), num('target_before_max', p?.target_before_max)),
      field(t('afterMealMax'), num('target_after_max', p?.target_after_max)),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('bpTargetField')),
        h('div', { class: 'bp-input small' },
          h('input', { name: 'target_bp_sys', type: 'number', inputmode: 'numeric', min: 90, max: 200, placeholder: '130', 'aria-label': t('bpUpperShort'), value: p?.target_bp_sys ?? '' }),
          h('span', { class: 'bp-slash', 'aria-hidden': 'true' }, '/'),
          h('input', { name: 'target_bp_dia', type: 'number', inputmode: 'numeric', min: 50, max: 130, placeholder: '85', 'aria-label': t('bpLowerShort'), value: p?.target_bp_dia ?? '' })),
        h('span', { class: 'hint' }, t('bpTargetHint')))),
    err,
    h('div', { class: 'sheet-actions' },
      h('button', { type: 'submit', class: 'btn primary block' }, '✓ ', t('save')),
      p ? h('button', { type: 'button', class: 'btn danger-text block', onclick: async () => {
        if (!confirm(t('confirmDeletePerson', { name: p.name }))) return;
        if (!confirm(t('confirmDeletePerson2'))) return;
        await api('DELETE', `/api/profiles/${p.id}`);
        dlg.close(); location.hash = '#/';
      } }, t('deletePerson')) : null));
  updateHints();
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const body = Object.fromEntries(new FormData(form));
    try {
      const saved = p ? await api('PUT', `/api/profiles/${p.id}`, body) : await api('POST', '/api/profiles', body);
      dlg.close();
      if (p) render(); else location.hash = `#/p/${saved.id}`;
      toast('✓ ' + t('saved'), 'ok');
    } catch (e) { err.textContent = e.message; }
  });
  const dlg = sheet(p ? t('editPerson') : t('addPerson'), form);
}

function openDataTools(p) {
  const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  const status = h('p', { class: 'hint', role: 'status' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.entries;
      if (!Array.isArray(list)) throw new Error(t('importBadFile'));
      if (!confirm(t('importConfirm', { n: list.length, name: p.name }))) return;
      const r = await api('POST', `/api/profiles/${p.id}/import`, { entries: list });
      dlg.close();
      toast('✓ ' + t('importDone', { n: r.imported }), 'ok');
      render();
    } catch (e) { status.textContent = `${t('importFailed')}: ${e.message}`; }
    file.value = '';
  });
  const fileBase = `rekod-${p.name.replace(/\W+/g, '-')}-${today()}`;
  const exportJson = async () => {
    const data = await api('GET', `/api/profiles/${p.id}/export`);
    download(`${fileBase}.json`, JSON.stringify(data, null, 2), 'application/json');
  };
  const exportCsv = async () => {
    const { entries } = await api('GET', `/api/profiles/${p.id}/export`);
    const targets = targetsFor(p);
    const bpT = bpTargetsFor(p);
    const rows = [[t('date'), t('time'), t('type'), t('value'), t('pulse'), t('when'), t('signal'), t('description'), t('minutes'), t('notes')],
      ...entries.map((e) => [e.date, e.time, t('kind_' + e.kind), e.kind === 'bp' ? fmtBp(e) : e.value ?? '', e.pulse ?? '',
        e.kind === 'glucose' ? t('ctx_' + e.context) : e.kind === 'food' ? t('meal_' + e.context) : '',
        e.kind === 'glucose' ? t('level_' + classify(e.value, e.context, targets).level) : e.kind === 'bp' ? t('bp_' + classifyBp(e.value, e.value2, bpT)) : '',
        e.description, e.duration ?? '', e.notes])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`${fileBase}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  };
  const dlg = sheet(t('backup'), h('div', { class: 'stack' },
    h('p', {}, t('backupIntro')),
    h('button', { class: 'btn secondary block', onclick: exportJson }, '↓ ', t('exportJson')),
    h('button', { class: 'btn secondary block', onclick: exportCsv }, '↓ ', t('exportCsv')),
    h('hr'),
    h('p', {}, t('importIntro')),
    h('button', { class: 'btn ghost block', onclick: () => file.click() }, '↑ ', t('importJson')),
    file, status));
}

function openSettings() {
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'stack' },
    field(t('currentPassword'), h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
    field(t('newPassword'), h('input', { name: 'password', type: 'password', required: true, minlength: 6, autocomplete: 'new-password' })),
    err,
    h('button', { class: 'btn secondary block', type: 'submit' }, t('changePassword')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('PUT', '/api/me/password', Object.fromEntries(new FormData(form))); dlg.close(); toast('✓ ' + t('passwordChanged'), 'ok'); } catch (e) { err.textContent = e.message; }
  });
  const dlg = sheet(t('settings'), h('div', { class: 'stack' },
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('language')), langToggle()),
    h('p', {}, t('loggedInAs'), ' ', h('b', {}, state.me.display_name), ` (${state.me.username})`),
    h('p', { class: 'hint' }, t('shareAccountHint')),
    h('details', { class: 'targets-details' }, h('summary', {}, '🔑 ', t('changePassword')), form),
    h('button', { class: 'btn ghost block', onclick: async () => { await api('POST', '/api/logout', {}); state.me = null; dlg.close(); location.hash = '#/login'; } }, '⎋ ', t('logout'))));
}

// ---------- report (print): one month, or six months ending with the chosen month ----------

async function renderReport(root, id, lastMonth, months = 1) {
  const range = periodRange(lastMonth, months);
  const [p, entries] = await Promise.all([api('GET', `/api/profiles/${id}`), api('GET', `/api/profiles/${id}/entries?from=${range.from}&to=${range.to}`)]);
  const targets = targetsFor(p);
  const s = computeStats(entries, targets);
  const multi = months > 1;
  const asc = [...entries].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id - b.id);
  const g = asc.filter((e) => e.kind === 'glucose');
  const w = asc.filter((e) => e.kind === 'weight');
  const food = asc.filter((e) => e.kind === 'food');
  const act = asc.filter((e) => e.kind === 'activity');
  const bp = asc.filter((e) => e.kind === 'bp');
  const bpT = bpTargetsFor(p);
  const bs = bpStats(bp, bpT);
  const when = (e) => `${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}`;
  const sum = (label, value) => h('div', { class: 'sum' }, h('div', { class: 'sum-label' }, label), h('div', { class: 'sum-value' }, value));
  const periodLabel = multi ? `${monthLabel(range.first)} – ${monthLabel(range.last)}` : monthLabel(lastMonth);

  // In a six-month report, long tables get a heading row at the start of each month.
  const table = (head, list, rowFn) => {
    const rows = [];
    let current = null;
    for (const e of list) {
      const m = e.date.slice(0, 7);
      if (multi && m !== current) { current = m; rows.push(h('tr', { class: 'month-row' }, h('td', { colspan: head.length }, monthLabel(m)))); }
      rows.push(rowFn(e));
    }
    return h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows)));
  };
  const section = (title, list, head, rowFn) => h('section', {}, h('h2', {}, title), list.length ? table(head, list, rowFn) : h('p', { class: 'muted' }, t('noData')));

  const monthTable = () => h('section', {},
    h('h2', {}, t('monthlySummary')),
    h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, [t('colMonth'), t('statReadingsTitle'), t('statAverage'), t('statInTarget'), t('colLowHigh'), t('colBp'), t('colWeightEnd'), t('statActivity')].map((x) => h('th', {}, x)))),
      h('tbody', {}, range.monthList.map((m) => {
        const inMonth = entries.filter((e) => e.date.startsWith(m));
        const ms = computeStats(inMonth, targets);
        const mb = bpStats(inMonth.filter((e) => e.kind === 'bp'), bpT);
        return h('tr', {},
          h('td', {}, h('b', {}, monthLabel(m))),
          h('td', {}, String(ms.count)),
          h('td', {}, ms.avg != null ? fmt1(ms.avg) : '—'),
          h('td', {}, ms.count ? `${ms.pctInTarget}%` : '—'),
          h('td', {}, ms.count ? `${ms.levels.low + ms.levels.below} / ${ms.levels.above + ms.levels.high}` : '—'),
          h('td', {}, mb.count ? `${mb.avgText} (${mb.pctNormal}%)` : '—'),
          h('td', {}, ms.weightLast != null ? `${ms.weightLast.toFixed(1)} kg` : '—'),
          h('td', {}, `${ms.activityMin} ${t('min')}`));
      })))),
    h('p', { class: 'small muted' }, t('colLowHighHint'), ' ', t('colBpHint')));

  const reportHref = (n) => `#/p/${p.id}/report/${lastMonth}${n > 1 ? '/' + n : ''}`;

  root.replaceChildren(
    h('header', { class: 'bar noprint' },
      h('a', { class: 'icon-btn', href: `#/p/${p.id}/sejarah`, 'aria-label': t('back') }, '‹'),
      h('div', { class: 'seg', role: 'group', 'aria-label': t('tabReport') },
        h('a', { class: months === 1 ? 'on' : '', href: reportHref(1), 'aria-current': months === 1 ? 'page' : null }, t('period1')),
        h('a', { class: months === 6 ? 'on' : '', href: reportHref(6), 'aria-current': months === 6 ? 'page' : null }, t('period6'))),
      h('button', { class: 'btn primary small', onclick: () => window.print() }, '🖨️ ', t('print'))),
    h('article', { class: 'report' },
      h('header', { class: 'report-head' },
        h('div', {}, h('h1', {}, multi ? t('reportTitle6') : t('reportTitle')), h('div', { class: 'report-month' }, periodLabel)),
        h('div', { class: 'report-who' },
          h('div', {}, h('b', {}, p.name)),
          h('div', {}, t('yearsOld', { n: ageOn(p.birthdate) }), ' · ', genderLabel(p.gender)),
          h('div', {}, t('born'), ' ', fmtDate(p.birthdate)),
          h('div', { class: 'muted' }, t('printed'), ' ', fmtDate(today())))),

      h('section', {},
        h('h2', {}, t('summary')),
        h('div', { class: 'sum-grid' },
          sum(t('statReadingsTitle'), String(s.count)),
          sum(t('statAverage'), s.avg != null ? `${fmt1(s.avg)} mmol/L` : '—'),
          sum(t('avgBefore'), s.avgBefore != null ? `${fmt1(s.avgBefore)} mmol/L` : '—'),
          sum(t('avgAfter'), s.avgAfter != null ? `${fmt1(s.avgAfter)} mmol/L` : '—'),
          sum(t('lowestHighest'), s.count ? `${fmt1(s.min)} / ${fmt1(s.max)}` : '—'),
          sum(t('statInTarget'), s.count ? `${s.pctInTarget}%` : '—'),
          sum(t('statWeight'), s.weightLast != null ? `${s.weightLast.toFixed(2)} kg${s.weightChange != null ? ` (${s.weightChange > 0 ? '+' : ''}${s.weightChange.toFixed(2)})` : ''}` : '—'),
          sum(t('statActivity'), `${s.activityMin} ${t('minutes')} · ${t('statSessions', { n: s.activityCount })}`),
          sum(t('bpAverage'), bs.count ? `${bs.avgText} mmHg` : '—'),
          sum(t('bpNormalPct'), bs.count ? `${bs.pctNormal}% · ${t('bpReadings', { n: bs.count })}` : '—')),
        s.count ? h('div', { class: 'level-bar' }, h('b', { class: 'level-bar-label' }, '🩸 ', t('glucoseShort')), ['low', 'below', 'normal', 'above', 'high'].map((l) => h('span', {}, signalPill(l), ' × ', h('b', {}, String(s.levels[l]))))) : null,
        bs.count ? h('div', { class: 'level-bar' }, h('b', { class: 'level-bar-label' }, '❤️ ', t('bpShort')), ['low', 'normal', 'above', 'high', 'veryhigh'].map((l) => h('span', {}, bpPill(l), ' × ', h('b', {}, String(bs.levels[l]))))) : null,
        h('p', { class: 'small' }, t('reportTargets', { bmin: fmt1(targets.beforeMin), bmax: fmt1(targets.beforeMax), amax: fmt1(targets.afterMax), low: fmt1(LOW) }),
          ' ', targets.custom ? t('targetsCustom') : t('targetsDefault', { group: t('group_' + targets.group), age: ageOn(p.birthdate) })),
        h('p', { class: 'small' }, t('bpReportTargets', { s: bpT.sys, d: bpT.dia }), ' ', bpT.custom ? t('bpTargetsCustom') : t('bpTargetsDefault'))),

      multi ? monthTable() : null,

      h('section', { class: 'report-charts' },
        h('div', {}, h('h2', {}, t('glucoseTrend')), g.length ? [glucoseChart(g, targets, range, true), chartLegend(targets)] : h('p', { class: 'muted' }, t('noData'))),
        bp.length ? h('div', {}, h('h2', {}, t('bpTrend')), bpChart(bp, bpT, range, true), bpLegend(bpT)) : null,
        w.length ? h('div', {}, h('h2', {}, t('weightTrend')), weightChart(w, range, true)) : null),

      section(`🩸 ${t('glucoseReadings')}`, g, [t('dateTime'), t('when'), t('value'), t('signal'), t('notes')], (e) =>
        h('tr', {}, h('td', {}, when(e)), h('td', {}, t('ctx_' + e.context)), h('td', {}, h('b', {}, fmt1(e.value))), h('td', {}, signalPill(classify(e.value, e.context, targets).level)), h('td', {}, e.notes))),
      section(`❤️ ${t('bpReadingsTitle')}`, bp, [t('dateTime'), t('bpReadingCol'), t('pulse'), t('signal'), t('notes')], (e) =>
        h('tr', {}, h('td', {}, when(e)), h('td', {}, h('b', {}, fmtBp(e))), h('td', {}, e.pulse ?? '—'), h('td', {}, bpPill(classifyBp(e.value, e.value2, bpT))), h('td', {}, e.notes))),
      section(`🍽️ ${t('foodDiary')}`, food, [t('dateTime'), t('meal'), t('whatEaten'), t('notes')], (e) =>
        h('tr', {}, h('td', {}, when(e)), h('td', {}, t('meal_' + e.context)), h('td', {}, e.description), h('td', {}, e.notes))),
      section(`🚶 ${t('activityLog')}`, act, [t('dateTime'), t('activity'), t('duration'), t('notes')], (e) =>
        h('tr', {}, h('td', {}, when(e)), h('td', {}, e.description), h('td', {}, e.duration ? `${e.duration} ${t('minutes')}` : '—'), h('td', {}, e.notes))),
      section(`⚖️ ${t('weightLog')}`, w, [t('dateTime'), t('weightKg'), t('notes')], (e) =>
        h('tr', {}, h('td', {}, when(e)), h('td', {}, e.value.toFixed(2)), h('td', {}, e.notes))),

      h('footer', { class: 'report-foot small' }, t('disclaimer'))));
}

// ---------- router ----------

let renderToken = 0;
async function render() {
  const token = ++renderToken;
  const root = document.getElementById('app');
  document.title = t('appName');
  try {
    if (state.me === undefined) {
      state.config = await api('GET', '/api/config');
      state.me = await api('GET', '/api/me').catch(() => null);
    }
    const hash = location.hash || '#/';
    if (!state.me) { if (hash !== '#/login') { location.hash = '#/login'; return; } return renderLogin(root); }
    if (hash === '#/login') { location.hash = '#/'; return; }
    let m;
    if ((m = /^#\/p\/(\d+)\/report\/(\d{4}-\d{2})(?:\/(6))?$/.exec(hash))) return await renderReport(root, m[1], m[2], m[3] ? 6 : 1);
    if ((m = /^#\/p\/(\d+)(?:\/(graf|sejarah))?$/.exec(hash))) {
      if (state.personId !== m[1]) { state.personId = m[1]; state.month = thisMonth(); }
      const view = { graf: renderChart, sejarah: renderHistory }[m[2]] || renderToday;
      return await view(root, m[1]);
    }
    return await renderHome(root);
  } catch (e) {
    if (token !== renderToken || !state.me) return;
    root.replaceChildren(h('main', { class: 'page' }, h('div', { class: 'card' }, h('h2', {}, t('errorGeneric')), h('p', {}, e.message), h('a', { class: 'btn primary block', href: '#/' }, t('back')))));
  }
}

document.documentElement.lang = lang;
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });
render();
