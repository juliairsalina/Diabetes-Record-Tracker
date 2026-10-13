'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServer } = require('../server.js');
const { connect } = require('../lib/app.js');

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

test('accounts, profiles, entries, import and isolation', async (t) => {
  const { server } = createServer({ db: connect({ url: ':memory:' }), allowRegistration: true });
  await new Promise((r) => server.listen(0, r));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = client(base), b = client(base);

  assert.equal((await a('GET', '/api/profiles')).status, 401);
  assert.equal((await a('POST', '/api/register', { username: 'keluarga', password: 'rahsia123', display_name: 'Keluarga' })).status, 200);
  assert.equal((await b('POST', '/api/register', { username: 'keluarga', password: 'xxxxxx' })).status, 409);
  assert.equal((await b('POST', '/api/login', { username: 'keluarga', password: 'wrong!' })).status, 401);

  const p = (await a('POST', '/api/profiles', { name: 'Mama', birthdate: '1974-01-18', gender: 'female' })).data;
  assert.equal(p.name, 'Mama');
  assert.equal((await a('POST', '/api/profiles', { name: 'X', birthdate: '1960-05-01', gender: 'other' })).status, 400);

  const g = await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'glucose', date: '2026-10-12', time: '23:00', value: '5.6', context: 'before_breakfast' });
  assert.equal(g.status, 200);
  assert.equal(g.data.value, 5.6);
  assert.equal((await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'food', date: '2026-10-12', context: 'lunch', description: '' })).status, 400);
  assert.equal((await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'activity', date: '2026-10-12', description: 'Treadmill', duration: 30 })).status, 200);
  const bp = await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'bp', date: '2026-10-12', time: '08:00', value: '128', value2: '82', pulse: '72' });
  assert.equal(bp.status, 200);
  assert.deepEqual([bp.data.value, bp.data.value2, bp.data.pulse], [128, 82, 72]);
  assert.equal((await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'bp', date: '2026-10-12', value: '80', value2: '120' })).status, 400);
  assert.equal((await a('GET', `/api/profiles/${p.id}`)).data.last_bp.value2, 82);

  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sample-data', 'rekod-mama-ogos-okt-2026.json'), 'utf8'));
  const imp = await a('POST', `/api/profiles/${p.id}/import`, sample);
  assert.equal(imp.data.imported, sample.entries.length);
  // old "sugar" format is accepted too
  assert.equal((await a('POST', `/api/profiles/${p.id}/import`, { entries: [{ kind: 'sugar', date: '2026-09-01', value: 5.4, time: '08:15', context: 'unspecified', notes: '' }] })).data.imported, 1);

  const oct = (await a('GET', `/api/profiles/${p.id}/entries?from=2026-10-01&to=2026-10-31`)).data;
  assert.ok(oct.every((e) => e.date.startsWith('2026-10')));
  assert.equal((await a('GET', `/api/profiles/${p.id}`)).data.last_glucose.value, 5.6);

  // another account cannot see or change Mama's data
  await b('POST', '/api/register', { username: 'jiran', password: 'abcdef' });
  assert.equal((await b('GET', `/api/profiles/${p.id}/entries`)).status, 404);
  assert.equal((await b('DELETE', `/api/entries/${g.data.id}`)).status, 404);
  assert.deepEqual((await b('GET', '/api/profiles')).data, []);

  // cross-site form posts are refused
  const form = await fetch(base + '/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=1' });
  assert.equal(form.status, 415);

  assert.equal((await a('DELETE', `/api/entries/${g.data.id}`)).status, 200);
  assert.equal((await a('POST', '/api/logout', {})).status, 200);
  assert.equal((await a('GET', '/api/me')).status, 401);
  assert.equal((await a('POST', '/api/login', { username: 'KELUARGA', password: 'rahsia123' })).status, 200);
});

// Vercel hands the function a rewritten URL (/api?path=…) and may pre-parse the JSON body.
test('works with Vercel-style requests', async () => {
  const { createApp } = require('../lib/app.js');
  const app = createApp({ db: connect({ url: ':memory:' }), allowRegistration: true });
  const call = (method, url, body, cookie) => new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (text) => resolve({ status: res.statusCode, headers, data: JSON.parse(text) }),
    };
    const req = { method, url, body, headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https', ...(cookie ? { cookie } : {}) }, socket: {} };
    app.handle(req, res);
  });
  const reg = await call('POST', '/api?path=register', { username: 'vercel', password: 'secret1' });
  assert.equal(reg.status, 200);
  assert.match(reg.headers['set-cookie'], /Secure/);
  const cookie = reg.headers['set-cookie'].split(';')[0];
  const p = await call('POST', '/api?path=profiles', { name: 'Mama', birthdate: '1974-01-18', gender: 'female' }, cookie);
  assert.equal(p.status, 200);
  await call('POST', `/api?path=profiles/${p.data.id}/entries`, { kind: 'glucose', date: '2026-10-12', value: 5.4, context: 'before_breakfast' }, cookie);
  const list = await call('GET', `/api?path=profiles/${p.data.id}/entries&from=2026-10-01&to=2026-10-31`, undefined, cookie);
  assert.equal(list.data.length, 1);
  assert.equal(list.data[0].value, 5.4);
  assert.equal((await call('GET', '/api?path=nope', undefined, cookie)).status, 404);
});

// A database created before blood pressure existed is upgraded without losing records.
test('upgrades an old database and keeps its records', async (t) => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rekod-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const url = 'file:' + path.join(dir, 'old.db');
  const old = connect({ url });
  await old.batch([
    "CREATE TABLE accounts (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE profiles (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, name TEXT NOT NULL, birthdate TEXT NOT NULL, gender TEXT NOT NULL CHECK (gender IN ('male','female')), target_before_min REAL, target_before_max REAL, target_after_max REAL, created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('glucose','weight','food','activity')), date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '', value REAL, context TEXT NOT NULL DEFAULT '', duration INTEGER, description TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
    "INSERT INTO accounts (id, username, display_name, password_hash) VALUES (1, 'julia', 'Julia', 'x')",
    "INSERT INTO profiles (id, account_id, name, birthdate, gender, target_before_max) VALUES (1, 1, 'Mama', '1974-01-18', 'female', 6)",
    "INSERT INTO entries (profile_id, kind, date, time, value, context, notes) VALUES (1, 'glucose', '2026-10-12', '18:30', 6.0, 'before_dinner', 'nota lama')",
    "INSERT INTO entries (profile_id, kind, date, value) VALUES (1, 'weight', '2026-10-12', 69.05)",
  ], 'write');
  old.close();

  const { createApp } = require('../lib/app.js');
  const app = createApp({ db: connect({ url }) });
  await app.ready;
  await app.ready; // a second start must not run the rebuild again
  const rows = (await app.db.execute('SELECT kind, value, notes FROM entries ORDER BY id')).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].notes, 'nota lama');
  assert.equal(rows[1].value, 69.05);
  const p = (await app.db.execute('SELECT target_before_max, target_bp_sys FROM profiles WHERE id = 1')).rows[0];
  assert.equal(p.target_before_max, 6);
  assert.equal(p.target_bp_sys, null);
  await app.db.execute("INSERT INTO entries (profile_id, kind, date, value, value2, pulse) VALUES (1, 'bp', '2026-10-13', 128, 82, 72)");
  assert.equal((await app.db.execute("SELECT COUNT(*) AS n FROM entries WHERE kind = 'bp'")).rows[0].n, 1);
  // starting again on the upgraded database is a no-op
  const again = createApp({ db: connect({ url }) });
  await again.ready;
  assert.equal((await again.db.execute('SELECT COUNT(*) AS n FROM entries')).rows[0].n, 3);
});
