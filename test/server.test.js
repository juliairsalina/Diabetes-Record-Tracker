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

  const g = await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'glucose', date: '2026-10-12', time: '08:30', value: '5.6', context: 'before_breakfast' });
  assert.equal(g.status, 200);
  assert.equal(g.data.value, 5.6);
  assert.equal((await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'food', date: '2026-10-12', context: 'lunch', description: '' })).status, 400);
  assert.equal((await a('POST', `/api/profiles/${p.id}/entries`, { kind: 'activity', date: '2026-10-12', description: 'Treadmill', duration: 30 })).status, 200);

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
