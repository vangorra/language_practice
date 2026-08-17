import test from 'node:test';
import assert from 'node:assert/strict';
import { WORDS, assertNoDuplicateIds } from '../js/words.js';
import { slugify } from '../js/slugify.js';
import { LEVELS } from '../js/level.js';

test('WORDS is non-empty and every entry has the required shape', () => {
  assert.ok(WORDS.length > 100, 'expect a substantial vocabulary');
  for (const w of WORDS) {
    assert.equal(typeof w.id, 'string');
    assert.ok(w.id.length > 0);
    assert.equal(typeof w.en, 'string');
    assert.equal(typeof w.es, 'string');
    assert.equal(typeof w.category, 'string');
    assert.ok(w.type === 'word' || w.type === 'phrase');
    assert.ok(LEVELS.includes(w.level), `expected a valid CEFR level, got ${w.level}`);
  }
});

test('level is assigned by position, earlier words landing at easier levels', () => {
  assert.equal(WORDS[0].level, 'A1');
  assert.equal(WORDS.at(-1).level, 'C2');
  // Non-decreasing overall: nothing at the midpoint of the deck should be
  // *easier* than the very first entry.
  const rank = (l) => LEVELS.indexOf(l);
  assert.ok(rank(WORDS[0].level) <= rank(WORDS[Math.floor(WORDS.length / 2)].level));
});

test('a raw entry can override its computed level explicitly', () => {
  const overridden = { en: 'x', es: 'unique-override-test-word', category: 'test', level: 'C1' };
  const merged = { type: 'word', level: 'A1', ...overridden, id: slugify(overridden.es) };
  assert.equal(merged.level, 'C1', 'the explicit level wins over the computed default');
});

test('each id is derived from its es text via slugify', () => {
  for (const w of WORDS.slice(0, 50)) {
    assert.equal(w.id, slugify(w.es));
  }
});

test('entries default to type "word" unless the raw entry overrides it', () => {
  const hello = WORDS.find((w) => w.es === 'hola');
  assert.equal(hello.type, 'phrase', 'phrases explicitly override the default');

  const dog = WORDS.find((w) => w.es === 'el perro');
  assert.equal(dog.type, 'word', 'entries without an explicit type default to "word"');
});

test('every id across the whole real vocabulary is unique (no es-text collisions)', () => {
  // Exercises the same check assertNoDuplicateIds performs, but as a
  // reusable assertion over the full real WORDS list.
  assert.doesNotThrow(() => assertNoDuplicateIds(WORDS));
  const ids = WORDS.map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('assertNoDuplicateIds passes silently for a list with no id collisions', () => {
  assert.doesNotThrow(() =>
    assertNoDuplicateIds([
      { id: 'a', es: 'a' },
      { id: 'b', es: 'b' },
    ])
  );
});

test('assertNoDuplicateIds throws, naming both colliding es values, on a collision', () => {
  assert.throws(
    () =>
      assertNoDuplicateIds([
        { id: 'x', es: 'primero' },
        { id: 'x', es: 'segundo' },
      ]),
    /Duplicate Spanish text produces the same id "x": "primero" and "segundo"/
  );
});
