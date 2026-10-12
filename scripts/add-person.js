// Add a person to an existing account, optionally with records from a backup file.
//   node scripts/add-person.js <username> <name> <YYYY-MM-DD> <female|male> [backup.json]
// Example (Mama, with the Aug–Oct 2026 records):
//   node scripts/add-person.js julia Mama 1974-01-18 female sample-data/rekod-mama-ogos-okt-2026.json
'use strict';
const fs = require('node:fs');
const { createApp, normaliseImported } = require('../server.js');

const [username, name, birthdate, gender, file] = process.argv.slice(2);
if (!username || !name || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate || '') || !['female', 'male'].includes(gender)) {
  console.error('Usage: node scripts/add-person.js <username> <name> <YYYY-MM-DD> <female|male> [backup.json]');
  process.exit(1);
}
const { db } = createApp();
const account = db.prepare('SELECT id FROM accounts WHERE username = ?').get(username.toLowerCase());
if (!account) {
  console.error(`No account "${username}". Register it in the app first.`);
  process.exit(1);
}
const { lastInsertRowid: profileId } = db.prepare('INSERT INTO profiles (account_id, name, birthdate, gender) VALUES (?, ?, ?, ?)').run(account.id, name, birthdate, gender);
let count = 0;
if (file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const insert = db.prepare('INSERT INTO entries (profile_id, kind, date, time, value, context, duration, description, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  for (const r of Array.isArray(data) ? data : data.entries) {
    const e = normaliseImported(r);
    insert.run(profileId, e.kind, e.date, e.time, e.value, e.context, e.duration, e.description, e.notes);
    count++;
  }
  db.exec('COMMIT');
}
console.log(`Added ${name} (born ${birthdate}) to ${username} with ${count} records.`);
