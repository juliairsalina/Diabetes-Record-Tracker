// Add a person to an existing account, optionally with records from a backup file.
//   node scripts/add-person.js <username> <name> <YYYY-MM-DD> <female|male> [backup.json]
// Uses TURSO_DATABASE_URL / TURSO_AUTH_TOKEN when set (the live database), otherwise ./data.
// Example (Mama, with the Aug–Oct 2026 records):
//   node scripts/add-person.js julia Mama 1974-01-18 female sample-data/rekod-mama-ogos-okt-2026.json
'use strict';
const fs = require('node:fs');
const { createApp, normaliseImported, INSERT_ENTRY, entryArgs } = require('../lib/app.js');

async function main() {
  const [username, name, birthdate, gender, file] = process.argv.slice(2);
  if (!username || !name || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate || '') || !['female', 'male'].includes(gender)) {
    throw new Error('Usage: node scripts/add-person.js <username> <name> <YYYY-MM-DD> <female|male> [backup.json]');
  }
  const { db, ready } = createApp();
  await ready;
  const account = (await db.execute({ sql: 'SELECT id FROM accounts WHERE username = ?', args: [username.toLowerCase()] })).rows[0];
  if (!account) throw new Error(`No account "${username}". Register it in the app first.`);
  const entries = file ? (() => { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return (Array.isArray(d) ? d : d.entries).map(normaliseImported); })() : [];
  const r = await db.execute({ sql: 'INSERT INTO profiles (account_id, name, birthdate, gender) VALUES (?, ?, ?, ?)', args: [account.id, name, birthdate, gender] });
  const profileId = Number(r.lastInsertRowid);
  if (entries.length) await db.batch(entries.map((e) => ({ sql: INSERT_ENTRY, args: entryArgs(profileId, e) })), 'write');
  console.log(`Added ${name} (born ${birthdate}) to ${username} with ${entries.length} records.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
