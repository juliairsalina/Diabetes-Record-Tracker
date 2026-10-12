// Rekod Gula — small family blood-glucose tracker.
// Zero dependencies: Node 22+ built-in http, crypto and sqlite.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'rekod.db');
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION !== 'false';
const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_DAYS = 60;
const MAX_BODY = 2 * 1024 * 1024;

const KINDS = ['glucose', 'weight', 'food', 'activity'];
const GLUCOSE_CONTEXTS = ['before_breakfast', 'before_lunch', 'before_dinner', 'after_meal', 'bedtime', 'other', 'unspecified'];
const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];

// ---------- database ----------

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      birthdate TEXT NOT NULL,
      gender TEXT NOT NULL CHECK (gender IN ('male','female')),
      target_before_min REAL,
      target_before_max REAL,
      target_after_max REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS entries (
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
    );
    CREATE INDEX IF NOT EXISTS entries_profile_date ON entries(profile_id, date);
  `);
  return db;
}

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

// ---------- app ----------

function createApp({ dbFile = DB_FILE, allowRegistration = ALLOW_REGISTRATION } = {}) {
  const db = openDb(dbFile);
  const q = {
    accountByName: db.prepare('SELECT * FROM accounts WHERE username = ?'),
    insertAccount: db.prepare('INSERT INTO accounts (username, display_name, password_hash) VALUES (?, ?, ?)'),
    setPassword: db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ?'),
    accountById: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)'),
    sessionAccount: db.prepare('SELECT a.id, a.username, a.display_name FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    profiles: db.prepare(`SELECT p.*,
        (SELECT json_object('value', value, 'context', context, 'date', date, 'time', time) FROM entries e
          WHERE e.profile_id = p.id AND e.kind = 'glucose' ORDER BY date DESC, time DESC, id DESC LIMIT 1) AS last_glucose
      FROM profiles p WHERE account_id = ? ORDER BY p.created_at, p.id`),
    profile: db.prepare(`SELECT p.*,
        (SELECT json_object('value', value, 'context', context, 'date', date, 'time', time) FROM entries e
          WHERE e.profile_id = p.id AND e.kind = 'glucose' ORDER BY date DESC, time DESC, id DESC LIMIT 1) AS last_glucose
      FROM profiles p WHERE id = ? AND account_id = ?`),
    insertProfile: db.prepare('INSERT INTO profiles (account_id, name, birthdate, gender, target_before_min, target_before_max, target_after_max) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    updateProfile: db.prepare('UPDATE profiles SET name = ?, birthdate = ?, gender = ?, target_before_min = ?, target_before_max = ?, target_after_max = ? WHERE id = ? AND account_id = ?'),
    deleteProfile: db.prepare('DELETE FROM profiles WHERE id = ? AND account_id = ?'),
    entries: db.prepare('SELECT * FROM entries WHERE profile_id = ? AND date >= ? AND date <= ? ORDER BY date DESC, time DESC, id DESC'),
    allEntries: db.prepare('SELECT kind, date, time, value, context, duration, description, notes FROM entries WHERE profile_id = ? ORDER BY date, time, id'),
    entry: db.prepare('SELECT e.* FROM entries e JOIN profiles p ON p.id = e.profile_id WHERE e.id = ? AND p.account_id = ?'),
    insertEntry: db.prepare('INSERT INTO entries (profile_id, kind, date, time, value, context, duration, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateEntry: db.prepare('UPDATE entries SET kind = ?, date = ?, time = ?, value = ?, context = ?, duration = ?, description = ?, notes = ? WHERE id = ?'),
    deleteEntry: db.prepare('DELETE FROM entries WHERE id = ?'),
  };

  const failedLogins = new Map(); // ip -> { count, first }
  const LOGIN_WINDOW = 15 * 60 * 1000, LOGIN_MAX = 10;

  function startSession(res, req, accountId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const maxAge = SESSION_DAYS * 86400;
    q.purgeSessions.run(Date.now());
    q.insertSession.run(sha256(token), accountId, Date.now() + maxAge * 1000);
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted || process.env.COOKIE_SECURE === '1';
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
  }

  function getToken(req) {
    const m = /(?:^|;\s*)sid=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
  }

  function currentAccount(req) {
    const token = getToken(req);
    return token ? q.sessionAccount.get(sha256(token), Date.now()) : undefined;
  }

  function ownedProfile(id, account) {
    const p = q.profile.get(Number(id), account.id);
    if (!p) throw new HttpError(404, 'Person not found');
    return p;
  }

  function ownedEntry(id, account) {
    const e = q.entry.get(Number(id), account.id);
    if (!e) throw new HttpError(404, 'Record not found');
    return e;
  }

  const insertEntry = (profileId, e) => q.insertEntry.run(profileId, e.kind, e.date, e.time, e.value, e.context, e.duration, e.description, e.notes);

  function publicProfile(p) {
    const out = { ...p };
    delete out.account_id;
    if (typeof out.last_glucose === 'string') out.last_glucose = JSON.parse(out.last_glucose);
    return out;
  }

  // route table: [method, regex, handler(ctx)], handlers return JSON-able values
  const routes = [
    ['GET', /^\/api\/config$/, () => ({ allowRegistration })],

    ['POST', /^\/api\/register$/, ({ body, req, res, ip }) => {
      if (!allowRegistration) throw new HttpError(403, 'Registration is closed');
      const username = str(body.username, 40).toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Username: 3–40 letters or numbers, no spaces');
      if (password.length < 6) throw bad('Password must be at least 6 characters');
      if (q.accountByName.get(username)) throw new HttpError(409, 'That username is already taken');
      const name = str(body.display_name, 80) || username;
      const { lastInsertRowid } = q.insertAccount.run(username, name, hashPassword(password));
      startSession(res, req, Number(lastInsertRowid));
      failedLogins.delete(ip);
      return { id: Number(lastInsertRowid), username, display_name: name };
    }],

    ['POST', /^\/api\/login$/, ({ body, req, res, ip }) => {
      const f = failedLogins.get(ip);
      if (f && Date.now() - f.first < LOGIN_WINDOW && f.count >= LOGIN_MAX) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes.');
      const acc = q.accountByName.get(str(body.username, 40).toLowerCase());
      if (!acc || !verifyPassword(String(body.password || ''), acc.password_hash)) {
        const cur = f && Date.now() - f.first < LOGIN_WINDOW ? f : { count: 0, first: Date.now() };
        cur.count++;
        failedLogins.set(ip, cur);
        throw new HttpError(401, 'Wrong username or password');
      }
      failedLogins.delete(ip);
      startSession(res, req, acc.id);
      return { id: acc.id, username: acc.username, display_name: acc.display_name };
    }],

    ['POST', /^\/api\/logout$/, ({ req, res }) => {
      const token = getToken(req);
      if (token) q.deleteSession.run(sha256(token));
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
      return { ok: true };
    }],

    ['GET', /^\/api\/me$/, ({ account }) => account, { auth: true }],

    ['PUT', /^\/api\/me\/password$/, ({ account, body }) => {
      const acc = q.accountById.get(account.id);
      if (!verifyPassword(String(body.current || ''), acc.password_hash)) throw bad('Current password is wrong');
      if (String(body.password || '').length < 6) throw bad('Password must be at least 6 characters');
      q.setPassword.run(hashPassword(String(body.password)), account.id);
      return { ok: true };
    }, { auth: true }],

    ['GET', /^\/api\/profiles$/, ({ account }) => q.profiles.all(account.id).map(publicProfile), { auth: true }],

    ['POST', /^\/api\/profiles$/, ({ account, body }) => {
      const p = cleanProfile(body);
      const { lastInsertRowid } = q.insertProfile.run(account.id, p.name, p.birthdate, p.gender, p.target_before_min, p.target_before_max, p.target_after_max);
      return publicProfile(q.profile.get(Number(lastInsertRowid), account.id));
    }, { auth: true }],

    ['GET', /^\/api\/profiles\/(\d+)$/, ({ account, params }) => publicProfile(ownedProfile(params[0], account)), { auth: true }],

    ['PUT', /^\/api\/profiles\/(\d+)$/, ({ account, params, body }) => {
      ownedProfile(params[0], account);
      const p = cleanProfile(body);
      q.updateProfile.run(p.name, p.birthdate, p.gender, p.target_before_min, p.target_before_max, p.target_after_max, Number(params[0]), account.id);
      return publicProfile(ownedProfile(params[0], account));
    }, { auth: true }],

    ['DELETE', /^\/api\/profiles\/(\d+)$/, ({ account, params }) => {
      ownedProfile(params[0], account);
      q.deleteProfile.run(Number(params[0]), account.id);
      return { ok: true };
    }, { auth: true }],

    ['GET', /^\/api\/profiles\/(\d+)\/entries$/, ({ account, params, url }) => {
      const p = ownedProfile(params[0], account);
      const from = url.searchParams.get('from') || '0000-01-01';
      const to = url.searchParams.get('to') || '9999-12-31';
      if (!isDate(from) && from !== '0000-01-01') throw bad('from is not a date');
      if (!isDate(to) && to !== '9999-12-31') throw bad('to is not a date');
      return q.entries.all(p.id, from, to);
    }, { auth: true }],

    ['POST', /^\/api\/profiles\/(\d+)\/entries$/, ({ account, params, body }) => {
      const p = ownedProfile(params[0], account);
      const { lastInsertRowid } = insertEntry(p.id, cleanEntry(body));
      return ownedEntry(lastInsertRowid, account);
    }, { auth: true }],

    ['POST', /^\/api\/profiles\/(\d+)\/import$/, ({ account, params, body }) => {
      const p = ownedProfile(params[0], account);
      const list = Array.isArray(body) ? body : body.entries;
      if (!Array.isArray(list) || list.length > 20000) throw bad('File format is not recognised');
      const clean = list.map((r, i) => {
        try { return normaliseImported(r); } catch (err) { throw bad(`Row ${i + 1}: ${err.message}`); }
      });
      db.exec('BEGIN');
      try { clean.forEach((e) => insertEntry(p.id, e)); db.exec('COMMIT'); } catch (err) { db.exec('ROLLBACK'); throw err; }
      return { imported: clean.length };
    }, { auth: true }],

    ['GET', /^\/api\/profiles\/(\d+)\/export$/, ({ account, params }) => {
      const p = ownedProfile(params[0], account);
      return { profile: { name: p.name, birthdate: p.birthdate, gender: p.gender }, entries: q.allEntries.all(p.id) };
    }, { auth: true }],

    ['PUT', /^\/api\/entries\/(\d+)$/, ({ account, params, body }) => {
      const old = ownedEntry(params[0], account);
      const e = cleanEntry(body);
      q.updateEntry.run(e.kind, e.date, e.time, e.value, e.context, e.duration, e.description, e.notes, old.id);
      return ownedEntry(old.id, account);
    }, { auth: true }],

    ['DELETE', /^\/api\/entries\/(\d+)$/, ({ account, params }) => {
      const old = ownedEntry(params[0], account);
      q.deleteEntry.run(old.id);
      return { ok: true };
    }, { auth: true }],
  ];

  function send(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }

  function readBody(req) {
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

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  }

  async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    try {
      const match = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
      if (!match) throw new HttpError(404, 'Not found');
      const [, re, handler, opts = {}] = match;
      // POST/PUT must be JSON; with SameSite cookies this blocks cross-site form posts.
      // (A cross-site DELETE cannot be sent without a CORS preflight, which we never allow.)
      if ((req.method === 'POST' || req.method === 'PUT') && !/^application\/json\b/.test(req.headers['content-type'] || '')) throw new HttpError(415, 'Expected JSON');
      const account = currentAccount(req);
      if (opts.auth && !account) throw new HttpError(401, 'Please log in');
      const body = req.method === 'POST' || req.method === 'PUT' ? await readBody(req) : {};
      const ip = req.socket.remoteAddress || '';
      const result = handler({ req, res, url, body, account, ip, params: re.exec(url.pathname).slice(1) });
      send(res, 200, result);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      send(res, err.status || 500, { error: err instanceof HttpError ? err.message : 'Server error' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, db };
}

if (require.main === module) {
  const { server } = createApp();
  server.listen(PORT, () => console.log(`Rekod Gula running on http://localhost:${PORT}`));
}

module.exports = { createApp, cleanEntry, normaliseImported };
