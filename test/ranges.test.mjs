import test from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, ageGroup, targetsFor, classify } from '../public/ranges.js';

test('age updates on the birthday', () => {
  assert.equal(ageOn('1960-10-13', new Date(2026, 9, 12)), 65);
  assert.equal(ageOn('1960-10-13', new Date(2026, 9, 13)), 66);
  assert.equal(ageOn('1960-02-29', new Date(2027, 2, 1)), 67);
});

test('age groups', () => {
  assert.equal(ageGroup(12), 'child');
  assert.equal(ageGroup(18), 'adult');
  assert.equal(ageGroup(64), 'adult');
  assert.equal(ageGroup(65), 'older');
});

test('default targets by age, doctor targets override', () => {
  const now = new Date(2026, 9, 12);
  assert.deepEqual(targetsFor({ birthdate: '1990-01-01' }, now), { group: 'adult', beforeMin: 4.4, beforeMax: 7.0, afterMax: 8.5, custom: false });
  const custom = targetsFor({ birthdate: '1958-01-01', target_before_max: 6, target_after_max: 10 }, now);
  assert.equal(custom.group, 'older');
  assert.equal(custom.beforeMax, 6);
  assert.equal(custom.afterMax, 10);
  assert.equal(custom.custom, true);
});

test('signal levels', () => {
  const tg = { beforeMin: 4.4, beforeMax: 7.0, afterMax: 8.5 };
  assert.equal(classify(3.5, 'before_breakfast', tg).level, 'low');
  assert.equal(classify(4.1, 'before_breakfast', tg).level, 'below');
  assert.equal(classify(5.6, 'before_breakfast', tg).level, 'normal');
  assert.equal(classify(7.0, 'before_breakfast', tg).level, 'normal');
  assert.equal(classify(7.5, 'before_breakfast', tg).level, 'above');
  assert.equal(classify(7.5, 'after_meal', tg).level, 'normal');
  assert.equal(classify(9.0, 'after_meal', tg).level, 'above');
  assert.equal(classify(14.2, 'after_meal', tg).level, 'high');
  assert.equal(classify(2.8, 'other', tg).veryLow, true);
});

import { bpTargetsFor, classifyBp } from '../public/ranges.js';

test('blood pressure levels', () => {
  const tg = bpTargetsFor({});
  assert.equal(classifyBp(118, 76, tg), 'normal');
  assert.equal(classifyBp(129, 84, tg), 'normal');
  assert.equal(classifyBp(130, 80, tg), 'above');
  assert.equal(classifyBp(134, 80, tg), 'above');
  assert.equal(classifyBp(125, 87, tg), 'above');
  assert.equal(classifyBp(145, 85, tg), 'high');
  assert.equal(classifyBp(128, 92, tg), 'high');
  assert.equal(classifyBp(185, 100, tg), 'veryhigh');
  assert.equal(classifyBp(150, 112, tg), 'veryhigh');
  assert.equal(classifyBp(88, 58, tg), 'low');
});

test('doctor blood pressure target', () => {
  const strict = bpTargetsFor({ target_bp_sys: 130, target_bp_dia: 80 });
  assert.equal(strict.custom, true);
  assert.equal(classifyBp(128, 82, strict), 'above');
  const relaxed = bpTargetsFor({ target_bp_sys: 150, target_bp_dia: 90 });
  assert.equal(classifyBp(146, 88, relaxed), 'normal');
  assert.equal(classifyBp(146, 90, relaxed), 'high');
  assert.equal(classifyBp(155, 88, relaxed), 'high');
});
