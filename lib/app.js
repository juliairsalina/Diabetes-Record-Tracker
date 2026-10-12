// Rekod Gula API. Used by both the local server (server.js) and the Vercel function (api/index.js).
// Storage: Turso (libSQL) in production, a local SQLite file when developing.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

const SESSION_DAYS = 60;
const MAX_BODY = 2 * 1024 * 1024;

const KINDS = ['glucose', 'weight', 'food', 'activity'];
const GLUCOSE_CONTEXTS = ['before_breakfast', 'before_meal', 'before_lunch', 'before_dinner', 'after_meal', 'bedtime', 'other', 'unspecified'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

// ---------- database ----------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    birthdate TEXT NOT NULL,
    gender TEXT NOT NULL CHECK (gender IN ('male','female')),
    target_before_min REAL,
    target_before_max REAL,
    target_after_max REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('glucose','weight','food','activity')),
    date TEXT NOT NULL,
    time TEXT NOT NULL DEFAULT '',
    value REAL,
    context TEXT NOT NULL DEFAULT '',
    duration INTEGER,
    description TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS entries_profile_date ON entries(profile_id, date)',
];

// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN on Vercel; otherwise a local file in ./data.
function connect({ url, authToken } = {}) {
  url = url || process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  authToken = authToken || process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    url = 'file:' + path.join(dir, 'rekod.db');
  }
  return createClient({ url, authToken });
}

// Plain objects with Number ids (libSQL rows are array-like and ids can be BigInt).
const plain = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])) : undefined);

// ---------- passwords & sessions ----------

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---------- validation ----------

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const isTime = (s) => s === '' || (typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s));
const str = (v, max) => (v == null ? '' : String(v).trim().slice(0, max));

function optNumber(v, min, max, label) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${label} is out of range`);
  return n;
}

function cleanProfile(b) {
  const name = str(b.name, 80);
  if (!name) throw bad('Name is required');
  if (!isDate(b.birthdate) || b.birthdate > new Date().toISOString().slice(0, 10) || b.birthdate < '1900-01-01') throw bad('Birthdate is not valid');
  if (!['male', 'female'].includes(b.gender)) throw bad('Gender is required');
  return {
    name,
    birthdate: b.birthdate,
    gender: b.gender,
    target_before_min: optNumber(b.target_before_min, 2, 15, 'Target'),
    target_before_max: optNumber(b.target_before_max, 3, 20, 'Target'),
    target_after_max: optNumber(b.target_after_max, 3, 25, 'Target'),
  };
}

function cleanEntry(b) {
  if (!KINDS.includes(b.kind)) throw bad('Unknown record type');
  if (!isDate(b.date)) throw bad('Date is not valid');
  const time = b.time == null ? '' : String(b.time).slice(0, 5);
  if (!isTime(time)) throw bad('Time is not valid');
  const e = { kind: b.kind, date: b.date, time, value: null, context: '', duration: null, description: str(b.description, 1000), notes: str(b.notes, 2000) };
  if (b.kind === 'glucose') {
    e.value = optNumber(b.value, 0.5, 40, 'Glucose reading');
    if (e.value == null) throw bad('Glucose reading is required');
    e.context = GLUCOSE_CONTEXTS.includes(b.context) ? b.context : 'unspecified';
  } else if (b.kind === 'weight') {
    e.value = optNumber(b.value, 1, 400, 'Weight');
    if (e.value == null) throw bad('Weight is required');
  } else if (b.kind === 'food') {
    e.context = MEALS.includes(b.context) ? b.context : 'snack';
    if (!e.description) throw bad('Please write what was eaten');
  } else if (b.kind === 'activity') {
    e.duration = optNumber(b.duration, 1, 1440, 'Duration');
    if (e.duration != null) e.duration = Math.round(e.duration);
    if (!e.description) throw bad('Please write the activity');
  }
  return e;
}

// Accepts this app's own export and the older single-page "Rekod Kesihatan Ibu" backup.
function normaliseImported(r) {
  const kind = r.kind === 'sugar' ? 'glucose' : r.kind;
  return cleanEntry({ ...r, kind });
}

const INSERT_ENTRY = 'INSERT INTO entries (profile_id, kind, date, time, value, context, duration, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
const entryArgs = (profileId, e) => [profileId, e.kind, e.date, e.time, e.value, e.context, e.duration, e.description, e.notes];

const LAST_GLUCOSE = `(SELECT json_object('value', value, 'context', context, 'date', date, 'time', time) FROM entries e
  WHERE e.profile_id = p.id AND e.kind = 'glucose' ORDER BY date DESC, time DESC, id DESC LIMIT 1) AS last_glucose`;

// ---------- app ----------

function createApp({ db = connect(), allowRegistration = process.env.ALLOW_REGISTRATION !== 'false' } = {}) {
  const ready = db.batch(SCHEMA, 'write');

  const all = async (sql, args = []) => (await db.execute({ sql, args })).rows.map(plain);
  const get = async (sql, args = []) => plain((await db.execute({ sql, args })).rows[0]);
  const run = (sql, args = []) => db.execute({ sql, args });

  const failedLogins = new Map(); // ip -> { count, first }
  const LOGIN_WINDOW = 15 * 60 * 1000, LOGIN_MAX = 10;

  async function startSession(res, req, accountId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const maxAge = SESSION_DAYS * 86400;
    await db.batch([
      { sql: 'DELETE FROM sessions WHERE expires_at <= ?', args: [Date.now()] },
      { sql: 'INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)', args: [sha256(token), accountId, Date.now() + maxAge * 1000] },
    ], 'write');
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket?.encrypted || process.env.COOKIE_SECURE === '1';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }

  function getToken(req) {
    const m = /(?:^|;\s*)sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  }

  async function currentAccount(req) {
    const token = getToken(req);
    if (!token) return undefined;
    return get('SELECT a.id, a.username, a.display_name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?', [sha256(token), Date.now()]);
  }

  async function ownedProfile(id, account) {
    const p = await get(`SELECT p.*, ${LAST_GLUCOSE} FROM profiles p WHERE id = ? AND account_id = ?`, [Number(id), account.id]);
    if (!p) throw new HttpError(404, 'Person not found');
    return p;
  }

  async function ownedEntry(id, account) {
    const e = await get('SELECT e.* FROM entries e JOIN profiles p ON p.id = e.profile_id WHERE e.id = ? AND p.account_id = ?', [Number(id), account.id]);
    if (!e) throw new HttpError(404, 'Record not found');
    return e;
  }

  function publicProfile(p) {
    const out = { ...p };
    delete out.account_id;
    if (typeof out.last_glucose === 'string') out.last_glucose = JSON.parse(out.last_glucose);
    return out;
  }

  const profileArgs = (p) => [p.name, p.birthdate, p.gender, p.target_before_min, p.target_before_max, p.target_after_max];

  // route table: [method, regex, async handler(ctx), { auth }]
  const routes = [
    ['GET', /^\/api\/config$/, async () => ({ allowRegistration })],

    ['POST', /^\/api\/register$/, async ({ body, req, res, ip }) => {
      if (!allowRegistration) throw new HttpError(403, 'Registration is closed');
      const username = str(body.username, 40).toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Username: 3–40 letters or numbers, no spaces');
      if (password.length < 6) throw bad('Password must be at least 6 characters');
      if (await get('SELECT id FROM accounts WHERE username = ?', [username])) throw new HttpError(409, 'That username is already taken');
      const name = str(body.display_name, 80) || username;
      const r = await run('INSERT INTO accounts (username, display_name, password_hash) VALUES (?, ?, ?)', [username, name, hashPassword(password)]);
      const id = Number(r.lastInsertRowid);
      await startSession(res, req, id);
      failedLogins.delete(ip);
      return { id, username, display_name: name };
    }],

    ['POST', /^\/api\/login$/, async ({ body, req, res, ip }) => {
      const f = failedLogins.get(ip);
      if (f && Date.now() - f.first < LOGIN_WINDOW && f.count >= LOGIN_MAX) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes.');
      const acc = await get('SELECT * FROM accounts WHERE username = ?', [str(body.username, 40).toLowerCase()]);
      if (!acc || !verifyPassword(String(body.password || ''), acc.password_hash)) {
        const cur = f && Date.now() - f.first < LOGIN_WINDOW ? f : { count: 0, first: Date.now() };
        cur.count++;
        failedLogins.set(ip, cur);
        throw new HttpError(401, 'Wrong username or password');
      }
      failedLogins.delete(ip);
      await startSession(res, req, acc.id);
      return { id: acc.id, username: acc.username, display_name: acc.display_name };
    }],

    ['POST', /^\/api\/logout$/, async ({ req, res }) => {
      const token = getToken(req);
      if (token) await run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return { ok: true };
    }],

    ['GET', /^\/api\/me$/, async ({ account }) => account, { auth: true }],

    ['PUT', /^\/api\/me\/password$/, async ({ account, body }) => {
      const acc = await get('SELECT password_hash FROM accounts WHERE id = ?', [account.id]);
      if (!verifyPassword(String(body.current || ''), acc.password_hash)) throw bad('Current password is wrong');
      if (String(body.password || '').length < 6) throw bad('Password must be at least 6 characters');
      await run('UPDATE accounts SET password_hash = ? WHERE id = ?', [hashPassword(String(body.password)), account.id]);
      return { ok: true };
    }, { auth: true }],

    ['GET', /^\/api\/profiles$/, async ({ account }) =>
      (await all(`SELECT p.*, ${LAST_GLUCOSE} FROM profiles p WHERE account_id = ? ORDER BY p.created_at, p.id`, [account.id])).map(publicProfile), { auth: true }],

    ['POST', /^\/api\/profiles$/, async ({ account, body }) => {
      const p = cleanProfile(body);
      const r = await run('INSERT INTO profiles (account_id, name, birthdate, gender, target_before_min, target_before_max, target_after_max) VALUES (?, ?, ?, ?, ?, ?, ?)', [account.id, ...profileArgs(p)]);
      return publicProfile(await ownedProfile(Number(r.lastInsertRowid), account));
    }, { auth: true }],

    ['GET', /^\/api\/profiles\/(\d+)$/, async ({ account, params }) => publicProfile(await ownedProfile(params[0], account)), { auth: true }],

    ['PUT', /^\/api\/profiles\/(\d+)$/, async ({ account, params, body }) => {
      const old = await ownedProfile(params[0], account);
      const p = cleanProfile(body);
      await run('UPDATE profiles SET name = ?, birthdate = ?, gender = ?, target_before_min = ?, target_before_max = ?, target_after_max = ? WHERE id = ? AND account_id = ?', [...profileArgs(p), old.id, account.id]);
      return publicProfile(await ownedProfile(old.id, account));
    }, { auth: true }],

    ['DELETE', /^\/api\/profiles\/(\d+)$/, async ({ account, params }) => {
      const p = await ownedProfile(params[0], account);
      // explicit, so it does not depend on foreign-key enforcement on the remote connection
      await db.batch([
        { sql: 'DELETE FROM entries WHERE profile_id = ?', args: [p.id] },
        { sql: 'DELETE FROM profiles WHERE id = ? AND account_id = ?', args: [p.id, account.id] },
      ], 'write');
      return { ok: true };
    }, { auth: true }],

    ['GET', /^\/api\/profiles\/(\d+)\/entries$/, async ({ account, params, url }) => {
      const p = await ownedProfile(params[0], account);
      const from = url.searchParams.get('from') || '0000-01-01';
      const to = url.searchParams.get('to') || '9999-12-31';
      if (!isDate(from) && from !== '0000-01-01') throw bad('from is not a date');
      if (!isDate(to) && to !== '9999-12-31') throw bad('to is not a date');
      return all('SELECT * FROM entries WHERE profile_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, time DESC, id DESC', [p.id, from, to]);
    }, { auth: true }],

    ['POST', /^\/api\/profiles\/(\d+)\/entries$/, async ({ account, params, body }) => {
      const p = await ownedProfile(params[0], account);
      const r = await run(INSERT_ENTRY, entryArgs(p.id, cleanEntry(body)));
      return ownedEntry(Number(r.lastInsertRowid), account);
    }, { auth: true }],

    ['POST', /^\/api\/profiles\/(\d+)\/import$/, async ({ account, params, body }) => {
      const p = await ownedProfile(params[0], account);
      const list = Array.isArray(body) ? body : body.entries;
      if (!Array.isArray(list) || list.length > 20000) throw bad('File format is not recognised');
      const clean = list.map((r, i) => {
        try { return normaliseImported(r); } catch (err) { throw bad(`Row ${i + 1}: ${err.message}`); }
      });
      // a batch is one transaction: all rows are saved, or none
      if (clean.length) await db.batch(clean.map((e) => ({ sql: INSERT_ENTRY, args: entryArgs(p.id, e) })), 'write');
      return { imported: clean.length };
    }, { auth: true }],

    ['GET', /^\/api\/profiles\/(\d+)\/export$/, async ({ account, params }) => {
      const p = await ownedProfile(params[0], account);
      const entries = await all('SELECT kind, date, time, value, context, duration, description, notes FROM entries WHERE profile_id = ? ORDER BY date, time, id', [p.id]);
      return { profile: { name: p.name, birthdate: p.birthdate, gender: p.gender }, entries };
    }, { auth: true }],

    ['PUT', /^\/api\/entries\/(\d+)$/, async ({ account, params, body }) => {
      const old = await ownedEntry(params[0], account);
      const e = cleanEntry(body);
      await run('UPDATE entries SET kind = ?, date = ?, time = ?, value = ?, context = ?, duration = ?, description = ?, notes = ? WHERE id = ?', [e.kind, e.date, e.time, e.value, e.context, e.duration, e.description, e.notes, old.id]);
      return ownedEntry(old.id, account);
    }, { auth: true }],

    ['DELETE', /^\/api\/entries\/(\d+)$/, async ({ account, params }) => {
      const old = await ownedEntry(params[0], account);
      await run('DELETE FROM entries WHERE id = ?', [old.id]);
      return { ok: true };
    }, { auth: true }],
  ];

  function send(res, status, data) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  }

  async function readBody(req) {
    // Vercel may already have parsed the body for us.
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
      const text = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body);
      if (text.length > MAX_BODY) throw new HttpError(413, 'Data too large');
      try { return text ? JSON.parse(text) : {}; } catch { throw bad('Invalid JSON'); }
    }
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Data too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Invalid JSON')); }
      });
      req.on('error', reject);
    });
  }

  // Handles /api/* requests. On Vercel the rewrite passes the original path as ?path=…
  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      const url = new URL(req.url, 'http://localhost');
      const rewritten = url.searchParams.get('path');
      const pathname = url.pathname.startsWith('/api/') && url.pathname !== '/api/index' ? url.pathname : `/api/${rewritten || ''}`;
      url.searchParams.delete('path');
      const match = routes.find(([m, re]) => m === req.method && re.test(pathname));
      if (!match) throw new HttpError(404, 'Not found');
      const [, re, handler, opts = {}] = match;
      // POST/PUT must be JSON; with SameSite cookies this blocks cross-site form posts.
      // (A cross-site DELETE cannot be sent without a CORS preflight, which we never allow.)
      if ((req.method === 'POST' || req.method === 'PUT') && !/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected JSON');
      await ready;
      const account = await currentAccount(req);
      if (opts.auth && !account) throw new HttpError(401, 'Please log in');
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
      send(res, 200, await handler({ req, res, url, body, account, ip, params: re.exec(pathname).slice(1) }));
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      send(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
    }
  }

  return { handle, db, ready };
}

module.exports = { createApp, connect, cleanEntry, normaliseImported, INSERT_ENTRY, entryArgs };
