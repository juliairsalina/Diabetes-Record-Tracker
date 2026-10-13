// Blood glucose targets and the traffic-light signal. Values in mmol/L.
//
// Defaults follow common diabetes guidance (Malaysian CPG T2DM 2020, ADA
// Standards of Care for older adults, ISPAD for children). Clinical targets
// depend on AGE GROUP, not on gender, so gender is recorded for the report
// but does not move the thresholds. A doctor's own targets, when entered on
// the person's profile, always win over these defaults.

export const LOW = 3.9;        // below this = hypoglycaemia for everyone
export const VERY_LOW = 3.0;
export const VERY_HIGH = 13.9; // at or above this = see a doctor / follow sick-day plan

export const DEFAULT_TARGETS = {
  child: { beforeMin: 4.0, beforeMax: 7.0, afterMax: 10.0 }, // under 18
  adult: { beforeMin: 4.4, beforeMax: 7.0, afterMax: 8.5 },  // 18 – 64
  older: { beforeMin: 4.4, beforeMax: 8.0, afterMax: 10.0 }, // 65 and above: relaxed to avoid lows
};

export const BEFORE_MEAL = ['before_breakfast', 'before_meal', 'before_lunch', 'before_dinner'];

// Age in whole years on a given day. Recomputed every time, so it updates on each birthday.
export function ageOn(birthdate, today = new Date()) {
  const [y, m, d] = birthdate.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

export function ageGroup(age) {
  if (age < 18) return 'child';
  if (age < 65) return 'adult';
  return 'older';
}

export function targetsFor(profile, today = new Date()) {
  const group = ageGroup(ageOn(profile.birthdate, today));
  const base = DEFAULT_TARGETS[group];
  const pick = (v, fallback) => (v == null || v === '' ? fallback : Number(v));
  const t = {
    group,
    beforeMin: pick(profile.target_before_min, base.beforeMin),
    beforeMax: pick(profile.target_before_max, base.beforeMax),
    afterMax: pick(profile.target_after_max, base.afterMax),
  };
  t.custom = t.beforeMin !== base.beforeMin || t.beforeMax !== base.beforeMax || t.afterMax !== base.afterMax;
  return t;
}

// The acceptable range for one reading, depending on when it was taken.
export function rangeFor(context, targets) {
  if (BEFORE_MEAL.includes(context)) return { min: targets.beforeMin, max: targets.beforeMax };
  // after meal, bedtime, other and unknown: judged against the after-meal ceiling
  return { min: targets.beforeMin, max: targets.afterMax };
}

// level: 'low' | 'below' | 'normal' | 'above' | 'high'
//  low    (red)    < 3.9          hypoglycaemia — treat now
//  below  (yellow) 3.9 – min      a little low
//  normal (green)  min – max      in target
//  above  (yellow) max – 13.9     a little high
//  high   (red)    >= 13.9        very high
export function classify(value, context, targets) {
  const v = Number(value);
  const range = rangeFor(context, targets);
  let level;
  if (v < LOW) level = 'low';
  else if (v < range.min) level = 'below';
  else if (v <= range.max) level = 'normal';
  else if (v < VERY_HIGH) level = 'above';
  else level = 'high';
  return { level, range, veryLow: v < VERY_LOW };
}

// ---------- blood pressure (mmHg) ----------
// Based on the Malaysian CPG on Hypertension (2018) categories:
//   normal < 130/85 · high normal 130–139 / 85–89 · hypertension >= 140/90 · grade 3 >= 180/110.
// Like glucose, the thresholds do not depend on gender. A doctor's target ("below 130/80",
// "below 150/90"), entered on the profile, replaces the "normal" limit.

export const BP_DEFAULT = { sys: 130, dia: 85 }; // normal = below both numbers
export const BP_LOW = { sys: 90, dia: 60 };
export const BP_HIGH = { sys: 140, dia: 90 };
export const BP_VERY_HIGH = { sys: 180, dia: 110 };

export function bpTargetsFor(profile) {
  const pick = (v, fallback) => (v == null || v === '' ? fallback : Number(v));
  const t = { sys: pick(profile.target_bp_sys, BP_DEFAULT.sys), dia: pick(profile.target_bp_dia, BP_DEFAULT.dia) };
  t.custom = t.sys !== BP_DEFAULT.sys || t.dia !== BP_DEFAULT.dia;
  return t;
}

// level: 'low' | 'normal' | 'above' | 'high' | 'veryhigh'
//  low      (yellow) < 90 or < 60          low blood pressure
//  normal   (green)  below the target
//  above    (yellow) above target, < 140/90
//  high     (red)    >= 140 or >= 90       high blood pressure
//  veryhigh (red)    >= 180 or >= 110      very high, seek medical help
// The worse of the two numbers decides.
export function classifyBp(sys, dia, targets) {
  sys = Number(sys); dia = Number(dia);
  if (sys >= BP_VERY_HIGH.sys || dia >= BP_VERY_HIGH.dia) return 'veryhigh';
  if (sys < BP_LOW.sys || dia < BP_LOW.dia) return 'low';
  if (sys < targets.sys && dia < targets.dia) return 'normal';
  if (sys < BP_HIGH.sys && dia < BP_HIGH.dia) return 'above';
  return 'high';
}

// The shared colour (CSS class) for each blood pressure level.
export const BP_COLOUR = { low: 'below', normal: 'normal', above: 'above', high: 'high', veryhigh: 'high' };
