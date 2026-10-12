import { ageOn, targetsFor, classify, BEFORE_MEAL, LOW } from './ranges.js';
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
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const thisMonth = () => today().slice(0, 7);
const fmtDate = (s) => { const [y, m, d] = s.split('-'); return `${+d}/${+m}/${y}`; };
const fmtDateLong = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  const wd = t('weekdays')[new Date(y, m - 1, d).getDay()];
  return `${wd}, ${d} ${t('months')[m - 1]} ${y}`;
};
const monthLabel = (m) => { const [y, n] = m.split('-').map(Number); return `${t('months')[n - 1]} ${y}`; };
const shiftMonth = (m, delta) => { const [y, n] = m.split('-').map(Number); const d = new Date(y, n - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const daysIn = (m) => { const [y, n] = m.split('-').map(Number); return new Date(y, n, 0).getDate(); };
const fmt1 = (v) => Number(v).toFixed(1);
const genderLabel = (g) => t(g === 'male' ? 'male' : 'female');
const LEVEL_ICON = { low: '▼', below: '↓', normal: '✓', above: '↑', high: '▲' };

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
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

function modal(title, content, { wide = false } = {}) {
  const dlg = h('dialog', { class: wide ? 'wide' : '' },
    h('div', { class: 'modal-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('close'), onclick: () => dlg.close() }, '✕')),
    h('div', { class: 'modal-body' }, content));
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

function signalPill(level, value, { big = false } = {}) {
  return h('span', { class: `pill ${level}${big ? ' big' : ''}` },
    h('span', { 'aria-hidden': 'true' }, LEVEL_ICON[level]), ' ',
    value != null ? h('b', {}, fmt1(value)) : null, value != null ? ' ' : null,
    t('level_' + level));
}

function chips(name, options, selected, { required = false, onpick } = {}) {
  return h('div', { class: 'chips', role: 'radiogroup' }, options.map((o, i) =>
    h('label', { class: 'chip' },
      h('input', { type: 'radio', name, value: o.value, checked: o.value === selected, required: required && i === 0, onchange: onpick ? () => onpick(o.value) : null }),
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

function topbar(extra) {
  return h('header', { class: 'topbar noprint' },
    h('a', { class: 'brand', href: '#/' }, h('span', { class: 'logo', 'aria-hidden': 'true' }, '🩸'), t('appName')),
    h('div', { class: 'topbar-actions' }, extra, langToggle(),
      state.me ? h('button', { class: 'btn ghost small', onclick: openSettings, 'aria-label': t('settings') }, '⚙ ', h('span', { class: 'topbar-settings-label' }, t('settings'))) : null));
}

function download(name, text, mime) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: mime })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- login / register ----------

function renderLogin(root) {
  let mode = 'login';
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'stack' });
  const draw = () => {
    form.replaceChildren(
      mode === 'register' ? field(t('yourName'), h('input', { name: 'display_name', autocomplete: 'name', placeholder: t('yourNameEg') })) : null,
      field(t('username'), h('input', { name: 'username', required: true, autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false' }), mode === 'register' ? t('usernameHint') : null),
      field(t('password'), h('input', { name: 'password', type: 'password', required: true, minlength: mode === 'register' ? 6 : null, autocomplete: mode === 'register' ? 'new-password' : 'current-password' }), mode === 'register' ? t('passwordHint') : null),
      err,
      h('button', { class: 'btn primary block', type: 'submit' }, mode === 'login' ? t('login') : t('createAccount')),
      state.config.allowRegistration ? h('p', { class: 'center muted' },
        mode === 'login' ? t('noAccount') : t('haveAccount'), ' ',
        h('button', { type: 'button', class: 'link', onclick: () => { mode = mode === 'login' ? 'register' : 'login'; err.textContent = ''; draw(); } },
          mode === 'login' ? t('register') : t('login'))) : null);
  };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const body = Object.fromEntries(new FormData(form));
    try {
      state.me = await api('POST', mode === 'login' ? '/api/login' : '/api/register', body);
      location.hash = '#/';
    } catch (e) { err.textContent = e.message; }
  });
  draw();
  root.replaceChildren(
    h('div', { class: 'login-wrap' },
      h('div', { class: 'login-lang' }, langToggle()),
      h('div', { class: 'card login-card' },
        h('div', { class: 'login-logo', 'aria-hidden': 'true' }, '🩸'),
        h('h1', { class: 'center' }, t('appName')),
        h('p', { class: 'center muted' }, t('tagline')),
        form)));
}

// ---------- home: list of people ----------

async function renderHome(root) {
  const profiles = await api('GET', '/api/profiles');
  const list = h('div', { class: 'people' },
    profiles.map((p) => {
      const age = ageOn(p.birthdate);
      const last = p.last_glucose;
      const sig = last ? classify(last.value, last.context, targetsFor(p)) : null;
      return h('a', { class: 'card person', href: `#/p/${p.id}` },
        h('div', { class: `avatar ${p.gender}`, 'aria-hidden': 'true' }, p.name.trim()[0]?.toUpperCase() || '?'),
        h('div', { class: 'person-main' },
          h('div', { class: 'person-name' }, p.name),
          h('div', { class: 'muted' }, t('yearsOld', { n: age }), ' · ', genderLabel(p.gender)),
          last ? h('div', { class: 'person-last' }, signalPill(sig.level, last.value), h('span', { class: 'muted small' }, ' ', fmtDate(last.date), last.time ? ' ' + last.time : ''))
            : h('div', { class: 'muted small' }, t('noReadingsYet'))),
        h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
    }),
    h('button', { class: 'card person add', onclick: () => openProfileForm() },
      h('div', { class: 'avatar add', 'aria-hidden': 'true' }, '+'),
      h('div', { class: 'person-main' }, h('div', { class: 'person-name' }, t('addPerson')), h('div', { class: 'muted' }, t('addPersonHint')))));
  root.replaceChildren(topbar(),
    h('main', { class: 'shell' },
      h('h1', {}, t('hello', { name: state.me.display_name })),
      h('p', { class: 'lead muted' }, profiles.length ? t('whoToday') : t('startByAdding')),
      list,
      h('section', { class: 'card info' }, h('h3', {}, 'ℹ ', t('signalExplainTitle')), legendRow(), h('p', { class: 'small muted' }, t('signalExplain')))));
}

function legendRow() {
  return h('div', { class: 'legend-row' }, ['low', 'below', 'normal', 'above', 'high'].map((l) => signalPill(l)));
}

// ---------- person dashboard ----------

async function renderPerson(root, id) {
  const month = state.month;
  const [p, entries] = await Promise.all([
    api('GET', `/api/profiles/${id}`),
    api('GET', `/api/profiles/${id}/entries?from=${month}-01&to=${month}-31`),
  ]);
  const targets = targetsFor(p);
  const age = ageOn(p.birthdate);
  const stats = computeStats(entries, targets);

  const actions = h('div', { class: 'actions-grid' },
    actionBtn('🩸', t('addGlucose'), 'glucose', () => openEntry(p, 'glucose')),
    actionBtn('🍽️', t('addFood'), 'food', () => openEntry(p, 'food')),
    actionBtn('🚶', t('addActivity'), 'activity', () => openEntry(p, 'activity')),
    actionBtn('⚖️', t('addWeight'), 'weight', () => openEntry(p, 'weight')));

  const monthNav = h('div', { class: 'month-nav' },
    h('button', { class: 'btn ghost', 'aria-label': t('prevMonth'), onclick: () => { state.month = shiftMonth(month, -1); render(); } }, '‹'),
    h('div', { class: 'month-label' }, monthLabel(month)),
    h('button', { class: 'btn ghost', 'aria-label': t('nextMonth'), disabled: month >= thisMonth(), onclick: () => { state.month = shiftMonth(month, 1); render(); } }, '›'),
    h('a', { class: 'btn secondary', href: `#/p/${p.id}/report/${month}` }, '🖨 ', t('monthlyReport')));

  const glucose = entries.filter((e) => e.kind === 'glucose');
  const weight = entries.filter((e) => e.kind === 'weight');

  root.replaceChildren(topbar(),
    h('main', { class: 'shell' },
      h('a', { class: 'back', href: '#/' }, '← ', t('allPeople')),
      h('div', { class: 'person-head' },
        h('div', { class: `avatar lg ${p.gender}`, 'aria-hidden': 'true' }, p.name.trim()[0]?.toUpperCase() || '?'),
        h('div', {}, h('h1', {}, p.name), h('div', { class: 'muted' }, t('yearsOld', { n: age }), ' · ', genderLabel(p.gender), ' · ', t('born'), ' ', fmtDate(p.birthdate))),
        h('div', { class: 'person-head-actions' },
          h('button', { class: 'btn ghost small', onclick: () => openProfileForm(p) }, '✎ ', t('editPerson')),
          h('button', { class: 'btn ghost small', onclick: () => openDataTools(p) }, '⇅ ', t('backup')))),
      latestCard(p, targets),
      actions,
      monthNav,
      h('div', { class: 'stats' },
        statTile(t('statAverage'), stats.avg != null ? fmt1(stats.avg) : '—', 'mmol/L', t('statReadings', { n: stats.count })),
        statTile(t('statInTarget'), stats.count ? `${stats.pctInTarget}%` : '—', '', stats.count ? t('statInTargetDetail', { a: stats.levels.normal, b: stats.count }) : t('noData')),
        statTile(t('statActivity'), String(stats.activityMin), t('minutes'), t('statSessions', { n: stats.activityCount })),
        statTile(t('statWeight'), stats.weightLast != null ? stats.weightLast.toFixed(1) : '—', 'kg', stats.weightChange != null ? t('statWeightChange', { v: (stats.weightChange > 0 ? '+' : '') + stats.weightChange.toFixed(2) }) : t('noData'))),
      h('section', { class: 'card' },
        h('h2', {}, t('glucoseTrend')),
        glucose.length ? glucoseChart(glucose, targets, month) : h('p', { class: 'empty' }, t('noGlucoseMonth')),
        glucose.length ? chartLegend(targets) : null),
      weight.length ? h('section', { class: 'card' }, h('h2', {}, t('weightTrend')), weightChart(weight, month)) : null,
      targetsBox(p, targets, age),
      h('section', { class: 'card' },
        h('h2', {}, t('diary'), ' — ', monthLabel(month)),
        entries.length ? diary(p, entries, targets) : h('p', { class: 'empty' }, t('noEntriesMonth')))));
}

function actionBtn(icon, label, kind, onclick) {
  return h('button', { class: `action ${kind}`, onclick }, h('span', { class: 'action-icon', 'aria-hidden': 'true' }, icon), h('span', {}, label));
}

function statTile(label, value, unit, detail) {
  return h('div', { class: 'card stat' }, h('div', { class: 'stat-label' }, label), h('div', { class: 'stat-value' }, value, unit ? h('span', {}, ' ', unit) : null), h('div', { class: 'small muted' }, detail));
}

function latestCard(p, targets) {
  const last = p.last_glucose;
  if (!last) {
    return h('section', { class: 'card latest none' }, h('div', {}, h('div', { class: 'latest-label' }, t('latestReading')), h('div', { class: 'latest-value' }, '—')), h('p', { class: 'muted' }, t('noReadingsYetLong')));
  }
  const sig = classify(last.value, last.context, targets);
  return h('section', { class: `card latest ${sig.level}` },
    h('div', { class: 'latest-left' },
      h('div', { class: 'latest-label' }, t('latestReading')),
      h('div', { class: 'latest-value' }, fmt1(last.value), h('span', {}, ' mmol/L')),
      h('div', { class: 'muted' }, t('ctx_' + last.context), ' · ', fmtDate(last.date), last.time ? ' ' + last.time : '')),
    h('div', { class: 'latest-right' },
      h('div', { class: 'latest-signal' }, h('span', { 'aria-hidden': 'true' }, LEVEL_ICON[sig.level]), ' ', t('level_' + sig.level)),
      h('p', {}, t('advice_' + sig.level)),
      h('p', { class: 'small muted' }, t('targetWas', { min: fmt1(sig.range.min), max: fmt1(sig.range.max) }))));
}

function targetsBox(p, targets, age) {
  return h('section', { class: 'card info' },
    h('h3', {}, '🎯 ', t('targetsFor', { name: p.name })),
    h('div', { class: 'target-grid' },
      h('div', {}, h('div', { class: 'muted small' }, t('beforeMeals')), h('b', {}, `${fmt1(targets.beforeMin)} – ${fmt1(targets.beforeMax)}`), ' mmol/L'),
      h('div', {}, h('div', { class: 'muted small' }, t('afterMeals')), h('b', {}, `${t('upTo')} ${fmt1(targets.afterMax)}`), ' mmol/L'),
      h('div', {}, h('div', { class: 'muted small' }, t('lowBelow')), h('b', {}, `< ${fmt1(LOW)}`), ' mmol/L')),
    h('p', { class: 'small muted' }, targets.custom ? t('targetsCustom') : t('targetsDefault', { group: t('group_' + targets.group), age })));
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
    weightFirst: w.length ? w[0].value : null,
    weightLast: w.length ? w.at(-1).value : null,
    weightChange: w.length > 1 ? w.at(-1).value - w[0].value : null,
    weightCount: w.length,
    activityMin: acts.reduce((a, e) => a + (e.duration || 0), 0),
    activityCount: acts.length,
    foodCount: entries.filter((e) => e.kind === 'food').length,
  };
}

// ---------- charts (inline SVG, one axis each) ----------

// x position inside a month: day + time of day, so several readings on one day spread out.
function monthX(e, month) {
  const day = Number(e.date.slice(8, 10));
  const [hh, mm] = (e.time || '12:00').split(':').map(Number);
  return (day - 1 + (hh * 60 + mm) / 1440) / daysIn(month);
}

function chartFrame({ points, yMin, yMax, yStep, month, band, refLines = [], unit, compact = false }) {
  // a narrower drawing on phones keeps the axis text readable
  const W = !compact && window.innerWidth < 600 ? 380 : 640, H = compact ? 200 : 260, L = 40, R = 14, T = 14, B = 30;
  const x = (f) => L + f * (W - L - R);
  const y = (v) => T + (1 - (v - yMin) / (yMax - yMin)) * (H - T - B);
  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': t('chartAria') });

  if (band) svg.append(sv('rect', { x: L, width: W - L - R, y: y(band.max), height: y(band.min) - y(band.max), class: 'band' }));
  for (let v = yMin; v <= yMax + 1e-9; v += yStep) {
    svg.append(sv('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }),
      sv('text', { x: L - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, Number.isInteger(yStep) ? String(v) : v.toFixed(1)));
  }
  refLines.forEach((r) => svg.append(
    sv('line', { x1: L, x2: W - R, y1: y(r.v), y2: y(r.v), class: `ref ${r.cls}` }),
    sv('text', { x: W - R - 4, y: y(r.v) - 5, 'text-anchor': 'end', class: `ref-label ${r.cls}` }, r.label)));
  const days = daysIn(month);
  [1, 5, 10, 15, 20, 25, days].forEach((d) => svg.append(sv('text', { x: x((d - 0.5) / days), y: H - 8, 'text-anchor': 'middle', class: 'tick' }, String(d))));

  const pts = points.map((p) => ({ ...p, px: x(p.x), py: y(p.v) }));
  if (pts.length > 1) svg.append(sv('polyline', { points: pts.map((p) => `${p.px},${p.py}`).join(' '), class: 'trend' }));
  pts.forEach((p) => svg.append(sv('circle', { cx: p.px, cy: p.py, r: compact ? 4 : 5.5, class: `dot ${p.cls || ''}` })));

  const wrap = h('div', { class: 'chart-wrap' }, svg);
  if (!compact) attachTooltip(wrap, svg, pts, W);
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
    if (!best || bd > 40) { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); return; }
    hair.setAttribute('x1', best.px); hair.setAttribute('x2', best.px); hair.setAttribute('visibility', 'visible');
    tip.replaceChildren(h('div', { class: 'tip-value' }, best.valueText), ...best.lines.map((l) => h('div', { class: 'tip-line' }, l)));
    tip.hidden = false;
    const left = (best.px / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 80), r.width - 80)}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hair.setAttribute('visibility', 'hidden'); });
}

function glucoseChart(list, targets, month, compact = false) {
  const sorted = [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const vals = sorted.map((e) => e.value);
  const yMin = Math.max(0, Math.floor(Math.min(3, ...vals) - 0.5));
  const yMax = Math.ceil(Math.max(targets.afterMax + 2, ...vals) + 0.5);
  return chartFrame({
    month, compact, unit: 'mmol/L', yMin, yMax, yStep: yMax - yMin > 12 ? 4 : 2,
    band: { min: targets.beforeMin, max: targets.beforeMax },
    refLines: [
      { v: targets.afterMax, cls: 'after', label: t('chartAfterLimit', { v: fmt1(targets.afterMax) }) },
      { v: LOW, cls: 'low', label: t('chartLow', { v: fmt1(LOW) }) },
    ],
    points: sorted.map((e) => {
      const s = classify(e.value, e.context, targets);
      return { x: monthX(e, month), v: e.value, cls: s.level, valueText: `${fmt1(e.value)} mmol/L · ${t('level_' + s.level)}`, lines: [`${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}`, t('ctx_' + e.context)] };
    }),
  });
}

function weightChart(list, month, compact = false) {
  const sorted = [...list].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const vals = sorted.map((e) => e.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(hi - lo, 1);
  const step = span > 6 ? 2 : span > 3 ? 1 : 0.5;
  lo = Math.floor((lo - span * 0.2) / step) * step;
  hi = Math.ceil((hi + span * 0.2) / step) * step;
  return chartFrame({
    month, compact, unit: 'kg', yMin: lo, yMax: hi, yStep: step,
    points: sorted.map((e) => ({ x: monthX(e, month), v: e.value, cls: 'weight', valueText: `${e.value.toFixed(2)} kg`, lines: [fmtDate(e.date) + (e.time ? ' ' + e.time : '')] })),
  });
}

function chartLegend(targets) {
  return h('div', { class: 'chart-legend' },
    h('span', {}, h('i', { class: 'key band' }), t('legendBand', { min: fmt1(targets.beforeMin), max: fmt1(targets.beforeMax) })),
    h('span', {}, h('i', { class: 'key after' }), t('legendAfter', { v: fmt1(targets.afterMax) })),
    h('span', {}, h('i', { class: 'key low' }), t('legendLow')),
    h('span', { class: 'muted' }, t('legendDots')));
}

// ---------- diary ----------

function entryMain(e) {
  if (e.kind === 'glucose') return h('span', {}, h('b', { class: 'big-num' }, fmt1(e.value)), ' mmol/L · ', t('ctx_' + e.context));
  if (e.kind === 'weight') return h('span', {}, h('b', { class: 'big-num' }, e.value.toFixed(2)), ' kg');
  if (e.kind === 'food') return h('span', {}, h('b', {}, t('meal_' + e.context)), ': ', e.description);
  return h('span', {}, h('b', {}, e.description), e.duration ? ` · ${e.duration} ${t('minutes')}` : '');
}
const KIND_ICON = { glucose: '🩸', weight: '⚖️', food: '🍽️', activity: '🚶' };

function diary(p, entries, targets) {
  const byDate = new Map();
  entries.forEach((e) => { if (!byDate.has(e.date)) byDate.set(e.date, []); byDate.get(e.date).push(e); });
  return h('div', { class: 'diary' }, [...byDate].map(([date, list]) =>
    h('div', { class: 'day' },
      h('h3', { class: 'day-title' }, fmtDateLong(date)),
      list.map((e) => h('div', { class: `entry ${e.kind}` },
        h('span', { class: 'entry-icon', 'aria-hidden': 'true' }, KIND_ICON[e.kind]),
        h('span', { class: 'entry-time' }, e.time || '—'),
        h('div', { class: 'entry-main' },
          entryMain(e),
          e.kind === 'glucose' ? h('div', {}, signalPill(classify(e.value, e.context, targets).level)) : null,
          e.notes ? h('div', { class: 'muted small' }, e.notes) : null),
        h('div', { class: 'entry-actions' },
          h('button', { class: 'btn ghost small', onclick: () => openEntry(p, e.kind, e) }, t('edit'))))))));
}

// ---------- forms ----------

const GLUCOSE_CTX = ['before_breakfast', 'before_lunch', 'before_dinner', 'after_meal', 'bedtime', 'other'];
const MEALS = [['breakfast', '🌅'], ['lunch', '☀️'], ['dinner', '🌙'], ['snack', '🍎']];
const ACTIVITIES = ['walk', 'treadmill', 'exercise', 'cycling', 'gardening', 'swimming'];

function guessMeal() {
  const hr = new Date().getHours();
  return hr < 11 ? 'breakfast' : hr < 16 ? 'lunch' : hr < 22 ? 'dinner' : 'snack';
}

function openEntry(p, kind, entry) {
  const e = entry || { kind, date: today(), time: nowTime(), value: '', context: kind === 'food' ? guessMeal() : '', description: '', notes: '', duration: '' };
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'stack' });
  const parts = [];

  if (kind === 'glucose') {
    parts.push(
      field(t('glucoseReading'), h('div', { class: 'big-input' }, h('input', { name: 'value', type: 'number', inputmode: 'decimal', step: '0.1', min: '0.5', max: '40', required: true, placeholder: '5.6', value: e.value }), h('span', {}, 'mmol/L'))),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('whenTaken')),
        chips('context', GLUCOSE_CTX.map((c) => ({ value: c, label: t('ctx_' + c) })), e.context === 'unspecified' ? '' : e.context, { required: true })),
      field(t('notes'), h('textarea', { name: 'notes', rows: 2, placeholder: t('notesGlucoseEg'), value: e.notes })));
  } else if (kind === 'weight') {
    parts.push(
      field(t('weightKg'), h('div', { class: 'big-input' }, h('input', { name: 'value', type: 'number', inputmode: 'decimal', step: '0.05', min: '1', max: '400', required: true, placeholder: '70.5', value: e.value }), h('span', {}, 'kg'))),
      field(t('notes'), h('textarea', { name: 'notes', rows: 2, value: e.notes })));
  } else if (kind === 'food') {
    parts.push(
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('whichMeal')), chips('context', MEALS.map(([m, icon]) => ({ value: m, label: t('meal_' + m), icon })), e.context, { required: true })),
      field(t('whatEaten'), h('textarea', { name: 'description', rows: 3, required: true, placeholder: t('whatEatenEg'), value: e.description })),
      field(t('notes'), h('textarea', { name: 'notes', rows: 2, placeholder: t('notesFoodEg'), value: e.notes })));
  } else {
    const desc = h('input', { name: 'description', required: true, placeholder: t('activityEg'), value: e.description });
    const dur = h('input', { name: 'duration', type: 'number', inputmode: 'numeric', min: '1', max: '1440', placeholder: '30', value: e.duration ?? '' });
    parts.push(
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('whatActivity')),
        h('div', { class: 'quick' }, ACTIVITIES.map((a) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { desc.value = t('act_' + a); } }, t('act_' + a)))), desc),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('howLong')),
        h('div', { class: 'quick' }, [10, 15, 20, 30, 45, 60].map((m) => h('button', { type: 'button', class: 'chip-btn', onclick: () => { dur.value = m; } }, `${m} ${t('min')}`))),
        h('div', { class: 'big-input small' }, dur, h('span', {}, t('minutes')))),
      field(t('notes'), h('textarea', { name: 'notes', rows: 2, value: e.notes })));
  }

  parts.push(h('div', { class: 'row2' },
    field(t('date'), h('input', { name: 'date', type: 'date', required: true, max: today(), value: e.date })),
    field(t('time'), h('input', { name: 'time', type: 'time', value: e.time }))));
  parts.push(err, h('div', { class: 'form-actions' },
    entry ? h('button', { type: 'button', class: 'btn danger', onclick: async () => {
      if (!confirm(t('confirmDelete'))) return;
      await api('DELETE', `/api/entries/${entry.id}`);
      dlg.close(); toast(t('deleted')); render();
    } }, '🗑 ', t('delete')) : null,
    h('button', { type: 'submit', class: 'btn primary grow' }, '✓ ', t('save'))));
  form.append(...parts);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const body = { kind, ...Object.fromEntries(new FormData(form)) };
    try {
      const saved = entry ? await api('PUT', `/api/entries/${entry.id}`, body) : await api('POST', `/api/profiles/${p.id}/entries`, body);
      dlg.close();
      state.month = saved.date.slice(0, 7);
      await render();
      if (kind === 'glucose') showResult(p, saved);
      else toast('✓ ' + t('saved'), 'ok');
    } catch (e2) { err.textContent = e2.message; }
  });

  const titles = { glucose: 'addGlucose', weight: 'addWeight', food: 'addFood', activity: 'addActivity' };
  const dlg = modal(`${KIND_ICON[kind]} ${entry ? t('editRecord') : t(titles[kind])}`, form);
  form.querySelector('input[name=value], textarea[name=description], input[name=description]')?.focus();
}

// Big, clear feedback right after a glucose reading is saved.
function showResult(p, e) {
  const targets = targetsFor(p);
  const s = classify(e.value, e.context, targets);
  const dlg = modal(t('resultTitle'), h('div', { class: `result ${s.level}` },
    h('div', { class: 'result-icon', 'aria-hidden': 'true' }, LEVEL_ICON[s.level]),
    h('div', { class: 'result-value' }, fmt1(e.value), h('span', {}, ' mmol/L')),
    h('div', { class: 'result-label' }, t('level_' + s.level)),
    h('p', { class: 'result-advice' }, t('advice_' + s.level)),
    h('p', { class: 'small muted' }, t('ctx_' + e.context), ' · ', t('targetWas', { min: fmt1(s.range.min), max: fmt1(s.range.max) })),
    h('button', { class: 'btn primary block', onclick: () => dlg.close() }, t('ok'))));
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
  const hasCustom = p && (p.target_before_min != null || p.target_before_max != null || p.target_after_max != null);
  const form = h('form', { class: 'stack' },
    field(t('name'), h('input', { name: 'name', required: true, maxlength: 80, placeholder: t('nameEg'), value: p?.name || '' })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, t('birthdate')), bd, ageOut),
    h('div', { class: 'field' }, h('span', { class: 'field-label' }, t('gender')),
      chips('gender', [{ value: 'female', label: t('female'), icon: '👩' }, { value: 'male', label: t('male'), icon: '👨' }], p?.gender || '', { required: true })),
    h('details', { class: 'targets-details', open: hasCustom },
      h('summary', {}, '🎯 ', t('doctorTargets')),
      h('p', { class: 'hint' }, t('doctorTargetsHint')),
      defaultsHint,
      h('div', { class: 'row3' },
        field(t('beforeMealMin'), num('target_before_min', p?.target_before_min)),
        field(t('beforeMealMax'), num('target_before_max', p?.target_before_max)),
        field(t('afterMealMax'), num('target_after_max', p?.target_after_max)))),
    err,
    h('div', { class: 'form-actions' },
      p ? h('button', { type: 'button', class: 'btn danger', onclick: async () => {
        if (!confirm(t('confirmDeletePerson', { name: p.name }))) return;
        if (!confirm(t('confirmDeletePerson2'))) return;
        await api('DELETE', `/api/profiles/${p.id}`);
        dlg.close(); location.hash = '#/';
      } }, '🗑 ', t('delete')) : null,
      h('button', { type: 'submit', class: 'btn primary grow' }, '✓ ', t('save'))));
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
  const dlg = modal(p ? t('editPerson') : t('addPerson'), form);
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
  const exportJson = async () => {
    const data = await api('GET', `/api/profiles/${p.id}/export`);
    download(`rekod-gula-${p.name.replace(/\W+/g, '-')}-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
  };
  const exportCsv = async () => {
    const { entries } = await api('GET', `/api/profiles/${p.id}/export`);
    const targets = targetsFor(p);
    const rows = [[t('date'), t('time'), t('type'), t('value'), t('when'), t('signal'), t('description'), t('minutes'), t('notes')],
      ...entries.map((e) => [e.date, e.time, t('kind_' + e.kind), e.value ?? '',
        e.kind === 'glucose' ? t('ctx_' + e.context) : e.kind === 'food' ? t('meal_' + e.context) : '',
        e.kind === 'glucose' ? t('level_' + classify(e.value, e.context, targets).level) : '',
        e.description, e.duration ?? '', e.notes])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`rekod-gula-${p.name.replace(/\W+/g, '-')}-${today()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  };
  const dlg = modal(t('backup'), h('div', { class: 'stack' },
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
    h('h3', {}, t('changePassword')),
    field(t('currentPassword'), h('input', { name: 'current', type: 'password', required: true, autocomplete: 'current-password' })),
    field(t('newPassword'), h('input', { name: 'password', type: 'password', required: true, minlength: 6, autocomplete: 'new-password' })),
    err,
    h('button', { class: 'btn secondary block', type: 'submit' }, t('changePassword')));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await api('PUT', '/api/me/password', Object.fromEntries(new FormData(form))); dlg.close(); toast('✓ ' + t('passwordChanged'), 'ok'); } catch (e) { err.textContent = e.message; }
  });
  const dlg = modal(t('settings'), h('div', { class: 'stack' },
    h('p', {}, t('loggedInAs'), ' ', h('b', {}, state.me.display_name), ` (${state.me.username})`),
    h('p', { class: 'hint' }, t('shareAccountHint')),
    form,
    h('hr'),
    h('button', { class: 'btn danger block', onclick: async () => { await api('POST', '/api/logout', {}); state.me = null; dlg.close(); location.hash = '#/login'; } }, '⎋ ', t('logout'))));
}

// ---------- monthly report (print) ----------

async function renderReport(root, id, month) {
  const [p, entries] = await Promise.all([
    api('GET', `/api/profiles/${id}`),
    api('GET', `/api/profiles/${id}/entries?from=${month}-01&to=${month}-31`),
  ]);
  const targets = targetsFor(p);
  const s = computeStats(entries, targets);
  const asc = [...entries].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id - b.id);
  const g = asc.filter((e) => e.kind === 'glucose');
  const w = asc.filter((e) => e.kind === 'weight');
  const food = asc.filter((e) => e.kind === 'food');
  const act = asc.filter((e) => e.kind === 'activity');
  const table = (head, rows) => h('table', {}, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows));
  const when = (e) => `${fmtDate(e.date)}${e.time ? ' ' + e.time : ''}`;

  const sum = (label, value) => h('div', { class: 'sum' }, h('div', { class: 'sum-label' }, label), h('div', { class: 'sum-value' }, value));

  root.replaceChildren(
    h('div', { class: 'report-bar noprint' },
      h('a', { class: 'btn ghost', href: `#/p/${p.id}` }, '← ', t('back')),
      h('div', { class: 'month-nav' },
        h('a', { class: 'btn ghost', href: `#/p/${p.id}/report/${shiftMonth(month, -1)}`, 'aria-label': t('prevMonth') }, '‹'),
        h('div', { class: 'month-label' }, monthLabel(month)),
        month < thisMonth() ? h('a', { class: 'btn ghost', href: `#/p/${p.id}/report/${shiftMonth(month, 1)}`, 'aria-label': t('nextMonth') }, '›') : null),
      langToggle(),
      h('button', { class: 'btn primary', onclick: () => window.print() }, '🖨 ', t('printNow'))),
    h('article', { class: 'report' },
      h('header', { class: 'report-head' },
        h('div', {}, h('h1', {}, t('reportTitle')), h('div', { class: 'report-month' }, monthLabel(month))),
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
          sum(t('statActivity'), `${s.activityMin} ${t('minutes')} · ${t('statSessions', { n: s.activityCount })}`)),
        s.count ? h('div', { class: 'level-bar' }, ['low', 'below', 'normal', 'above', 'high'].map((l) => h('span', {}, signalPill(l), ' × ', h('b', {}, String(s.levels[l]))))) : null,
        h('p', { class: 'small' }, t('reportTargets', { bmin: fmt1(targets.beforeMin), bmax: fmt1(targets.beforeMax), amax: fmt1(targets.afterMax), low: fmt1(LOW) }),
          ' ', targets.custom ? t('targetsCustom') : t('targetsDefault', { group: t('group_' + targets.group), age: ageOn(p.birthdate) }))),

      h('section', { class: 'report-charts' },
        h('div', {}, h('h2', {}, t('glucoseTrend')), g.length ? glucoseChart(g, targets, month, true) : h('p', { class: 'muted' }, t('noData')), g.length ? chartLegend(targets) : null),
        w.length ? h('div', {}, h('h2', {}, t('weightTrend')), weightChart(w, month, true)) : null),

      h('section', {},
        h('h2', {}, '🩸 ', t('glucoseReadings')),
        g.length ? table([t('dateTime'), t('when'), t('value'), t('signal'), t('notes')], g.map((e) => {
          const c = classify(e.value, e.context, targets);
          return h('tr', {}, h('td', {}, when(e)), h('td', {}, t('ctx_' + e.context)), h('td', {}, h('b', {}, fmt1(e.value))), h('td', {}, signalPill(c.level)), h('td', {}, e.notes));
        })) : h('p', { class: 'muted' }, t('noData'))),

      h('section', {},
        h('h2', {}, '🍽️ ', t('foodDiary')),
        food.length ? table([t('dateTime'), t('meal'), t('whatEaten'), t('notes')], food.map((e) =>
          h('tr', {}, h('td', {}, when(e)), h('td', {}, t('meal_' + e.context)), h('td', {}, e.description), h('td', {}, e.notes)))) : h('p', { class: 'muted' }, t('noData'))),

      h('section', {},
        h('h2', {}, '🚶 ', t('activityLog')),
        act.length ? table([t('dateTime'), t('activity'), t('duration'), t('notes')], act.map((e) =>
          h('tr', {}, h('td', {}, when(e)), h('td', {}, e.description), h('td', {}, e.duration ? `${e.duration} ${t('minutes')}` : '—'), h('td', {}, e.notes)))) : h('p', { class: 'muted' }, t('noData'))),

      h('section', {},
        h('h2', {}, '⚖️ ', t('weightLog')),
        w.length ? table([t('dateTime'), t('weightKg'), t('notes')], w.map((e) =>
          h('tr', {}, h('td', {}, when(e)), h('td', {}, e.value.toFixed(2)), h('td', {}, e.notes)))) : h('p', { class: 'muted' }, t('noData'))),

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
    let m;
    if (hash === '#/login') { location.hash = '#/'; return; }
    if ((m = /^#\/p\/(\d+)\/report\/(\d{4}-\d{2})$/.exec(hash))) return await renderReport(root, m[1], m[2]);
    if ((m = /^#\/p\/(\d+)$/.exec(hash))) {
      if (state.personId !== m[1]) { state.personId = m[1]; state.month = thisMonth(); }
      return await renderPerson(root, m[1]);
    }
    return await renderHome(root);
  } catch (e) {
    if (token !== renderToken || !state.me) return;
    root.replaceChildren(topbar(), h('main', { class: 'shell' }, h('div', { class: 'card' }, h('h2', {}, t('errorGeneric')), h('p', {}, e.message), h('a', { class: 'btn primary', href: '#/' }, t('back')))));
  }
}

document.documentElement.lang = lang;
window.addEventListener('hashchange', render);
render();
