'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createApp } = require('../server.js');

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
  const { server } = createApp({ dbFile: ':memory:', allowRegistration: true });
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
