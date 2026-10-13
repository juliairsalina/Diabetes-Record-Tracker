# Rekod — Family Health Record
(This project and website is only to be used by my family since all other apps need subscription :((( HAHA)

A simple family website for logging blood glucose, blood pressure, food, physical activity and weight. It is built for parents: large buttons, Bahasa Melayu by default (English toggle), and a clear traffic-light signal after every reading.

It is designed **for phones first**. Each person has three bottom tabs:

- **Hari ini** (Today): the last reading in big numbers with its colour, one big *Rekod Gula* button, small buttons for food, activity and weight, and today's records.
- **Graf** (Charts): the month's sugar and weight graphs.
- **Sejarah** (History): every record for the month by day (tap one to edit), and the printable report (1, 3 or 6 months).

The **⋯** menu holds the report (1, 3 or 6 months), targets and colour meanings, the person's details, backup and settings. Forms open as full-screen sheets with only the essentials. Date and time default to *now*; tap *Tukar* to change them.

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
- **Blood pressure.** Record the upper and lower numbers (and pulse, if you like). Each reading gets a label based on the Malaysian Hypertension CPG: *Normal* (below 130/85, or the doctor's target), *Agak tinggi* (up to 139/89), *Tinggi* (140/90 or more), *Sangat tinggi* (180/110 or more, with advice to seek help) and *Rendah* (below 90/60). A doctor's target, e.g. "below 130/80", can be entered under **Ubah maklumat**. Blood pressure has its own graph and is in both reports.
- **Food and activity diary.** Quick buttons for meal times, common activities and durations.
- **Charts.** Monthly glucose chart with the target band and colour-coded dots, plus a weight chart.
- **Reports: 1, 3 or 6 months.** A printable page with summary, charts and all tables. The 3- and 6-month reports add a month-by-month summary table and charts across the whole period, and group the readings by month. Use *Cetak* to print it or save it as a PDF for the doctor.
- **Backup.** Download JSON or CSV (opens in Excel). You can import JSON backups, including backups from the old single-page *Rekod Kesihatan Ibu* file.

## Put it online (Vercel + Turso, free)

The website runs on **Vercel** and saves the data in a **Turso** database. Both have free plans that are enough for a family.

### 1. Create the database on Turso

1. Go to <https://turso.tech> and sign up (you can sign in with GitHub).
2. Create a database. Name it `rekod-gula` and choose the **Singapore** location (the website runs in Singapore too, so it stays fast).
3. Open the database and copy its **URL**. It starts with `libsql://`.
4. Create a **token** for the database (*Create Token*, read & write) and copy it. Keep it secret, because it opens the database.

### 2. Publish on Vercel

1. Merge this work into the `main` branch on GitHub (Vercel publishes `main`).
2. Go to <https://vercel.com>, sign in with GitHub, then **Add New… → Project** and import `diabetes-record-tracker`.
3. Leave *Framework Preset* as **Other** and do not change the build settings.
4. Open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the `libsql://…` URL from Turso |
   | `TURSO_AUTH_TOKEN` | the token from Turso |

5. Press **Deploy**. After about a minute you get a link like `https://diabetes-record-tracker.vercel.app`.

The app creates its tables by itself the first time it runs.

### 3. First use

1. Open the link and tap **Daftar akaun baru** to register the family account.
2. Tap **+ Tambah orang** and add **Mama** (18/1/1974, Perempuan).
3. To load Mama's old records, download [`sample-data/rekod-mama-ogos-okt-2026.json`](sample-data/rekod-mama-ogos-okt-2026.json) to the phone or computer, then in the app go to **⋯ → Sandaran data → Import fail sandaran** and choose that file.
4. **Close sign-ups** so strangers cannot create accounts. In Vercel go to *Settings → Environment Variables*, add `ALLOW_REGISTRATION` = `false`, then *Deployments → ⋯ → Redeploy*.
5. On each phone, open the link and choose **Add to Home Screen** so it opens like an app.

Every family member can log in with the same account on their own phone.

## Run it on your computer

Requires Node.js 20 or newer.

```bash
npm install
npm start            # http://localhost:3000
npm test
```

Without the Turso variables, data is stored in a local file, `data/rekod.db`.

### Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `TURSO_DATABASE_URL` | – | Turso database URL. If empty, uses the local file in `DATA_DIR` |
| `TURSO_AUTH_TOKEN` | – | Turso token |
| `ALLOW_REGISTRATION` | `true` | Set to `false` once your family account exists |
| `DATA_DIR` | `./data` | Folder for the local database file |
| `PORT` | `3000` | Port for `npm start` |

### Add a person from the command line (optional)

This does the same as steps 2–3 above in one go. With the Turso variables set it writes to the live database:

```bash
node scripts/add-person.js <username> Mama 1974-01-18 female sample-data/rekod-mama-ogos-okt-2026.json
```

### Other hosting

The app also runs anywhere that runs Node, for example with the included Dockerfile:
`docker build -t rekod-gula . && docker run -d -p 3000:3000 -v rekod-data:/data rekod-gula`

## Disclaimer

This is for home monitoring and for discussion with a doctor. It does not give a diagnosis. Follow the doctor's advice and targets.
