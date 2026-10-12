# Rekod Gula — Diabetes Record Tracker

A simple family website for logging blood glucose, food, physical activity and weight. It is built for parents: large buttons, Bahasa Melayu by default (English toggle), and a clear traffic-light signal after every reading.

It is designed **for phones first**. Each person has three bottom tabs:

- **Hari ini** (Today): the last reading in big numbers with its colour, one big *Rekod Gula* button, small buttons for food, activity and weight, and today's records.
- **Graf** (Charts): the month's sugar and weight graphs.
- **Sejarah** (History): every record for the month by day (tap one to edit), and the printable monthly report.

The **⋯** menu holds the monthly report, targets and colour meanings, the person's details, backup and settings. Forms open as full-screen sheets with only the essentials. Date and time default to *now*; tap *Tukar* to change them.

## Features

- **Login.** Family accounts with username and password. Everyone in the family can use the same account on their own phone.
- **People (profiles).** Add Mama, Papa and others with name, date of birth and gender. Age is calculated from the birthdate each time, so it updates on every birthday.
- **Glucose signal.** Every reading is checked against targets for the person's age group and for when it was taken (before a meal, or 2 hours after):

  | Signal | Meaning |
  |---|---|
  | ▼ Rendah (red) | below 3.9 mmol/L: hypoglycaemia, treat now |
  | ↓ Agak rendah (yellow) | between 3.9 and the target minimum |
  | ✓ Normal (green) | in target |
  | ↑ Agak tinggi (yellow) | above target, below 13.9 |
  | ▲ Tinggi (red) | 13.9 mmol/L or more |

  Default targets (mmol/L) are in `public/ranges.js`:

  | Age group | Before meals | 2 h after meals |
  |---|---|---|
  | Under 18 | 4.0 – 7.0 | up to 10.0 |
  | 18 – 64 | 4.4 – 7.0 | up to 8.5 (Malaysian CPG T2DM) |
  | 65 + | 4.4 – 8.0 | up to 10.0 (relaxed to avoid lows) |

  **Gender does not change glucose targets** in clinical guidelines. It is recorded and shown on the report but does not move the thresholds. If the doctor has given personal targets (for example *before breakfast < 6.0, after meal < 10*), enter them under **Ubah maklumat → Sasaran dari doktor**. They then replace the defaults for that person.
- **Food and activity diary.** Quick buttons for meal times, common activities and durations.
- **Charts.** Monthly glucose chart with the target band and colour-coded dots, plus a weight chart.
- **Monthly report.** A printable page with summary, charts and all tables. Use *Cetak / Simpan PDF* to print it or save it as a PDF for the doctor.
- **Backup.** Download JSON or CSV (opens in Excel). You can import JSON backups, including backups from the old single-page *Rekod Kesihatan Ibu* file.

## Run it

Requires **Node.js 22.13 or newer**. There are no other dependencies: the database is Node's built-in SQLite.

```bash
npm start            # http://localhost:3000
npm test
```

Data is stored in `data/rekod.db` (change it with `DATA_DIR` or `DB_FILE`). Back up that file.

### Load Mama's existing record (Aug – Oct 2026)

Register an account in the app first (for example `julia`), then run:

```bash
node scripts/add-person.js julia Mama 1974-01-18 female sample-data/rekod-mama-ogos-okt-2026.json
```

This adds **Mama** (born 18 January 1974, female) with all 77 old sugar and weight records. Or do it in the app: add Mama, then **⋯ → Sandaran data → Import fail sandaran** and choose the same file.

### Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `./data` | Folder for the SQLite database |
| `ALLOW_REGISTRATION` | `true` | Set to `false` after your family accounts exist, so strangers cannot sign up |
| `COOKIE_SECURE` | – | Set to `1` to force secure cookies (they are set automatically behind HTTPS proxies) |

## Putting it online

The app needs a small server with a **persistent disk** for the database file. Options:

- **Docker** on any VPS: `docker build -t rekod-gula . && docker run -d -p 3000:3000 -v rekod-data:/data -e ALLOW_REGISTRATION=false rekod-gula`
- **Render / Railway / Fly.io**: deploy this repo as a Node service and attach a persistent volume mounted at `DATA_DIR`.
- **A home computer or Raspberry Pi** on the family Wi-Fi.

Always serve it over **HTTPS** when it is on the internet. On a phone, open the site and choose *Add to Home Screen* so it works like an app.

## Disclaimer

This is for home monitoring and for discussion with a doctor. It does not give a diagnosis. Follow the doctor's advice and targets.
