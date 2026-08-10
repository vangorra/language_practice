import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWordState,
  reviewWord,
  tierOf,
  pickNextWord,
  TIER,
  MINUTE,
  DAY,
} from '../js/srs.js';

test('a brand-new word starts in the NEW tier', () => {
  const s = createWordState();
  assert.equal(tierOf(s), TIER.NEW);
});

test('a clean correct match (no misses) graduates through learning steps quickly', () => {
  let s = createWordState(0);
  s = reviewWord(s, 0, 0);
  assert.equal(tierOf(s), TIER.LEARNING);
  assert.equal(s.timesCorrect, 1);
  assert.ok(s.dueAt > 0 && s.dueAt <= 10 * MINUTE);
});

test('two clean reviews graduate the word to day-scale review', () => {
  let s = createWordState(0);
  s = reviewWord(s, 0, 0);
  s = reviewWord(s, 0, s.dueAt);
  s = reviewWord(s, 0, s.dueAt); // third success graduates out of learning steps
  assert.ok(s.intervalMin >= DAY, 'interval should be at least a day after graduating');
  assert.equal(tierOf(s), TIER.FAMILIAR); // graduated to a >= 1 day interval
});

test('a miss (wrong guesses before matching) demotes the word and shrinks the interval', () => {
  let s = createWordState(0);
  s = reviewWord(s, 0, 0);
  s = reviewWord(s, 0, s.dueAt);
  s = reviewWord(s, 0, s.dueAt); // graduated, interval >= 1 day
  const strongInterval = s.intervalMin;
  s = reviewWord(s, 2, s.dueAt); // now miss badly
  assert.ok(s.intervalMin < strongInterval, 'a miss should shrink the interval');
  assert.equal(s.lapses, 1);
  assert.equal(s.reps, 0);
});

test('repeated clean reviews eventually reach the MASTERED tier', () => {
  let s = createWordState(0);
  let now = 0;
  for (let i = 0; i < 10; i++) {
    s = reviewWord(s, 0, now);
    now = s.dueAt;
  }
  assert.equal(tierOf(s), TIER.MASTERED);
});

test('pickNextWord introduces new words up to the cap, then prefers due words', () => {
  const words = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const now = 1000;
  const states = {
    1: createWordState(now), // never seen -> "new"
    2: { ...createWordState(now), timesSeen: 3, dueAt: now - 5000 }, // overdue
    3: createWordState(now), // never seen -> "new"
  };
  const rng = () => 0.99; // steer away from the "prefer new" random branch when possible

  const pick = pickNextWord(words, states, new Set(), { now, newWordCap: 0, rng });
  assert.equal(pick.id, 2, 'with the new-word cap at 0, the only due word should be picked');
});

test('pickNextWord returns null when every word is already active', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const states = { 1: createWordState(), 2: createWordState() };
  const pick = pickNextWord(words, states, new Set([1, 2]), { now: 0 });
  assert.equal(pick, null);
});

test('pickNextWord never returns a word that is already active', () => {
  const words = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const now = 0;
  const states = {
    1: { ...createWordState(now), timesSeen: 1, dueAt: -1 },
    2: { ...createWordState(now), timesSeen: 1, dueAt: -1 },
    3: { ...createWordState(now), timesSeen: 1, dueAt: -1 },
  };
  for (let i = 0; i < 20; i++) {
    const pick = pickNextWord(words, states, new Set([1, 2]), { now });
    assert.equal(pick.id, 3);
  }
});
