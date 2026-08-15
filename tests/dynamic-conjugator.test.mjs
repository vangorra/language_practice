import test from 'node:test';
import assert from 'node:assert/strict';
import { createConjugationExpander } from '../js/dynamic-conjugator.js';

test('expands a regular verb into cards for all 5 simple indicative tenses', () => {
  const { expandVerb } = createConjugationExpander(new Set());
  const entries = expandVerb({ es: 'hablar', en: 'to speak' });

  // present: 5 (yo/tú/él-ella/nosotros/ellos), preterite: 4 (nosotros
  // collides with present for an -ar verb, see below), imperfect: 4
  // (yo/él-ella merged), future: 5 (no collisions), conditional: 4
  // (yo/él-ella merged, same -ía-ending collision as imperfect).
  assert.equal(entries.length, 22);

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

  const future = entries.filter((e) => e.context.includes('· future'));
  assert.equal(future.length, 5, 'future has no yo/él-ella collision');
  const yoFuture = future.find((e) => e.context.includes('· yo ·'));
  assert.equal(yoFuture.es, 'hablaré');
  assert.equal(yoFuture.en, 'I will speak');

  const conditional = entries.filter((e) => e.context.includes('conditional'));
  assert.equal(conditional.length, 4, 'yo and él/ella are merged into one conditional card, same as imperfect');
  const mergedConditional = conditional.find((e) => e.context.includes('yo / él/ella'));
  assert.equal(mergedConditional.es, 'hablaría');
  assert.equal(mergedConditional.en, 'I/he/she would speak');
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

test('a verb whose conjugation genuinely throws is handled without crashing', async () => {
  // The real engine is defensive internally and never actually throws for
  // any input we've found (even garbage input just comes back as an
  // "Unknown verb" result, caught by the Array.isArray check below the try
  // block) -- so expandVerb's try/catch is tested here by making the engine
  // throw directly, restoring it immediately after regardless of outcome.
  const { Conjugator } = await import('@jirimracek/conjugate-esp');
  const original = Conjugator.prototype.conjugateSync;
  Conjugator.prototype.conjugateSync = () => {
    throw new Error('simulated engine failure');
  };
  try {
    const { expandVerb } = createConjugationExpander(new Set());
    const entries = expandVerb({ es: 'hablar', en: 'to speak' });
    assert.deepEqual(entries, []);
  } finally {
    Conjugator.prototype.conjugateSync = original;
  }
});

test('regular English present-tense 3rd person spelling rules (sibilant +es, consonant+y -> +ies)', () => {
  const besar = createConjugationExpander(new Set()).expandVerb({ es: 'besar', en: 'to kiss' });
  const besarElla = besar.find((e) => e.context.includes('· él/ella ·') && e.context.includes('present'));
  assert.equal(besarElla.en, 'he/she kisses');

  const intentar = createConjugationExpander(new Set()).expandVerb({ es: 'intentar', en: 'to try' });
  const intentarElla = intentar.find((e) => e.context.includes('· él/ella ·') && e.context.includes('present'));
  assert.equal(intentarElla.en, 'he/she tries');
});

test('a genuinely defective verb (every entry marked defective) falls back to the first result', () => {
  // "soler" has no non-defective entry at all -- entry.find(...) returns
  // undefined for every candidate, exercising the `|| result[0]` fallback.
  const { expandVerb } = createConjugationExpander(new Set());
  const entries = expandVerb({ es: 'soler', en: 'to usually' });
  const yoPresent = entries.find((e) => e.context.includes('· yo ·') && e.context.includes('present'));
  assert.equal(yoPresent.es, 'suelo');
});

test('a tense missing entirely, too short, or missing one person is skipped defensively', async () => {
  // The real engine always returns full 6-element arrays (using "-" as a
  // placeholder for truly defective forms), so these shapes never occur in
  // practice -- exercised here directly, the same way the "genuinely
  // throws" test above exercises its try/catch.
  const { Conjugator } = await import('@jirimracek/conjugate-esp');
  const original = Conjugator.prototype.conjugateSync;
  Conjugator.prototype.conjugateSync = () => [
    {
      info: { defective: false },
      conjugation: {
        Indicativo: {
          Presente: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
          PreteritoIndefinido: undefined, // whole tense missing -> `!forms`
          PreteritoImperfecto: ['x', 'y', 'z'], // too short -> `forms.length < 6`
          FuturoImperfecto: [undefined, 'f2', 'f3', 'f4', 'f5', 'f6'], // one missing person -> `!es`
          CondicionalSimple: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'],
        },
      },
    },
  ];
  try {
    const { expandVerb } = createConjugationExpander(new Set());
    const entries = expandVerb({ es: 'fakeverb', en: 'to fake' });
    assert.ok(!entries.some((e) => e.context.includes('preterite')), 'missing tense produced no entries');
    assert.ok(!entries.some((e) => e.context.includes('imperfect')), 'too-short tense produced no entries');
    const future = entries.filter((e) => e.context.includes('· future'));
    assert.equal(future.length, 4, 'one of the 5 future persons (yo) was skipped for a missing form');
    assert.ok(!future.some((e) => e.context.includes('· yo ·')), 'the missing person (yo) was skipped');
  } finally {
    Conjugator.prototype.conjugateSync = original;
  }
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
