import test from 'node:test';
import assert from 'node:assert/strict';
import { createConjugationExpander } from '../js/dynamic-conjugator.js';

test('expands a regular verb into present/preterite/imperfect cards', () => {
  const { expandVerb } = createConjugationExpander(new Set());
  const entries = expandVerb({ es: 'hablar', en: 'to speak' });

  // present: 5 (yo/tú/él-ella/nosotros/ellos), preterite: 4 (nosotros
  // collides with present for an -ar verb, see below), imperfect: 4
  // (yo/él-ella merged into one card).
  assert.equal(entries.length, 13);

  const present = entries.filter((e) => e.context.includes('present tense'));
  assert.equal(present.length, 5);
  const yoPresent = present.find((e) => e.context.includes('· yo ·'));
  assert.equal(yoPresent.es, 'hablo');
  assert.equal(yoPresent.en, 'I speak');

  const preterite = entries.filter((e) => e.context.includes('preterite'));
  assert.equal(preterite.length, 4, '-ar verb: preterite nosotros collides with present nosotros');
  assert.ok(!preterite.some((e) => e.context.includes('· nosotros ·')));

  const imperfect = entries.filter((e) => e.context.includes('imperfect'));
  assert.equal(imperfect.length, 4, 'yo and él/ella are merged into one imperfect card');
  const mergedImperfect = imperfect.find((e) => e.context.includes('yo / él/ella'));
  assert.equal(mergedImperfect.es, 'hablaba');
  assert.equal(mergedImperfect.en, 'I/he/she used to speak');
});

test('every generated id is unique and matches slugify(es)', async () => {
  const { slugify } = await import('../js/slugify.js');
  const { expandVerb } = createConjugationExpander(new Set());
  const entries = expandVerb({ es: 'hablar', en: 'to speak' });
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of entries) assert.equal(e.id, slugify(e.es));
});

test('reflexive verbs include the pronoun in the conjugated form', () => {
  const { expandVerb } = createConjugationExpander(new Set());
  const entries = expandVerb({ es: 'llamarse', en: 'to be named' });
  const yoPresent = entries.find((e) => e.context.includes('· yo ·') && e.context.includes('present'));
  assert.equal(yoPresent.es, 'me llamo');
});

test('an -er verb does not lose its preterite nosotros (no collision)', () => {
  const { expandVerb } = createConjugationExpander(new Set());
  const entries = expandVerb({ es: 'comer', en: 'to eat' });
  const preterite = entries.filter((e) => e.context.includes('preterite'));
  assert.equal(preterite.length, 5, '-er verb: present/preterite nosotros forms differ, so both exist');
});

test('respects a pre-seeded usedIds set (cross-verb / cross-session collisions)', () => {
  const usedIds = new Set(['hablo']); // pretend some other word already claimed this id
  const { expandVerb } = createConjugationExpander(usedIds);
  const entries = expandVerb({ es: 'hablar', en: 'to speak' });
  assert.ok(!entries.some((e) => e.es === 'hablo'));
});

test('calling expandVerb twice for the same verb produces nothing new the second time', () => {
  const usedIds = new Set();
  const { expandVerb } = createConjugationExpander(usedIds);
  const first = expandVerb({ es: 'comer', en: 'to eat' });
  const second = expandVerb({ es: 'comer', en: 'to eat' });
  assert.ok(first.length > 0);
  assert.equal(second.length, 0);
});

test('a verb the engine cannot conjugate (multi-word "infinitive") returns no entries, no throw', () => {
  const { expandVerb } = createConjugationExpander(new Set());
  const entries = expandVerb({ es: 'hacer clic', en: 'to click' });
  assert.deepEqual(entries, []);
});

test('irregular English present tense (to be, to have, to go) is handled', () => {
  const { expandVerb } = createConjugationExpander(new Set());
  const ser = createConjugationExpander(new Set()).expandVerb({ es: 'ser', en: 'to be' });
  const serElla = ser.find((e) => e.context.includes('· él/ella ·') && e.context.includes('present'));
  assert.equal(serElla.en, 'he/she is');

  const tener = createConjugationExpander(new Set()).expandVerb({ es: 'tener', en: 'to have' });
  const tenerElla = tener.find((e) => e.context.includes('· él/ella ·') && e.context.includes('present'));
  assert.equal(tenerElla.en, 'he/she has');

  const ir = createConjugationExpander(new Set()).expandVerb({ es: 'ir', en: 'to go' });
  const irElla = ir.find((e) => e.context.includes('· él/ella ·') && e.context.includes('present'));
  assert.equal(irElla.en, 'he/she goes');
});
