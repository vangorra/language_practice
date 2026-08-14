import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWordState,
  reviewWord,
  tierOf,
  pickNextWord,
  markKnown,
  markNeedsPractice,
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

test('markKnown immediately jumps a word to the MASTERED tier', () => {
  const fresh = createWordState(0);
  const known = markKnown(fresh, 1000);
  assert.equal(tierOf(known), TIER.MASTERED);
  assert.equal(known.manuallyMastered, true);
  assert.ok(known.dueAt > 1000, 'should be scheduled well into the future');
  assert.equal(known.timesSeen, 1, 'counts as having been "seen" once for reporting purposes');
});

test('markKnown works even on a word that already has review history', () => {
  let s = createWordState(0);
  s = reviewWord(s, 0, 0); // one clean review, still in early learning steps
  const known = markKnown(s, 5000);
  assert.equal(tierOf(known), TIER.MASTERED);
  assert.ok(known.timesSeen >= s.timesSeen, "shouldn't lose review history");
});

test('markNeedsPractice forgets everything and starts fresh', () => {
  let s = createWordState(0);
  s = reviewWord(s, 0, 0);
  s = markKnown(s, 1000);
  const forgotten = markNeedsPractice(2000);
  assert.equal(tierOf(forgotten), TIER.NEW);
  assert.equal(forgotten.manuallyMastered, false);
  assert.equal(forgotten.timesSeen, 0);
});

test('pickNextWord treats a manually-known word like a mastered one: not due, occasionally rechecked', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const now = 10_000;
  const states = {
    1: markKnown(createWordState(now), now), // manually known, due far in the future
    2: createWordState(now), // brand new
  };
  // With the new-word cap at 0 and mastery-check chance forced to 1, the
  // only remaining candidate is the manually-known word.
  const pick = pickNextWord(words, states, new Set(), {
    now,
    newWordCap: 0,
    masteryCheckChance: 1,
    rng: () => 0,
  });
  assert.equal(pick.id, 1);
});
