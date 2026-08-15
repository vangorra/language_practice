import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWordState,
  reviewWord,
  tierOf,
  pickNextWord,
  weightedPick,
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

test('weightedPick chooses the item whose cumulative weight range contains the roll', () => {
  const items = ['a', 'b', 'c'];
  const weights = [1, 2, 3]; // total 6
  assert.equal(weightedPick(items, weights, () => 0), 'a'); // roll 0 -> r=0, first item
  assert.equal(weightedPick(items, weights, () => 1 / 6 + 1e-9), 'b'); // just past a's slice
  assert.equal(weightedPick(items, weights, () => 0.99), 'c'); // deep into c's slice
});

test('weightedPick falls back to a uniform pick when every weight is non-positive', () => {
  const items = ['a', 'b', 'c'];
  const weights = [0, 0, 0];
  assert.equal(weightedPick(items, weights, () => 0), 'a');
  assert.equal(weightedPick(items, weights, () => 0.9), 'c');
});

test('weightedPick falls back to the last item if a misbehaving rng never lets the cumulative weight reach the roll', () => {
  // Math.random() (the real rng) can never return >= 1, so this path is
  // unreachable through normal use -- exercised directly here as a defensive
  // guarantee that weightedPick still returns *something* rather than
  // undefined even if it were ever called with a bad rng.
  const items = ['a', 'b', 'c'];
  const weights = [1, 1, 1];
  // rng() must exceed 1 so the roll (r = rng() * total) still has leftover
  // after every weight has been subtracted -- otherwise the loop's own
  // `r <= 0` branch returns first (as it would for a well-behaved rng that
  // never reaches 1), never reaching this fallback.
  assert.equal(weightedPick(items, weights, () => 1.5), 'c');
});

test('pickNextWord introduces a new word immediately when nothing is due yet', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const now = 0;
  const states = { 1: createWordState(now), 2: createWordState(now) }; // both brand new, nothing due
  const pick = pickNextWord(words, states, new Set(), { now, newWordCap: 2, rng: () => 0.99 });
  assert.ok([1, 2].includes(pick.id));
});

test('pickNextWord can prefer a new word over a due one when the newWordChance roll succeeds', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const now = 1000;
  const states = {
    1: createWordState(now), // brand new
    2: { ...createWordState(now), timesSeen: 1, dueAt: now - 1 }, // due
  };
  const pick = pickNextWord(words, states, new Set(), { now, newWordCap: 2, newWordChance: 1, rng: () => 0 });
  assert.equal(pick.id, 1, 'a rng roll under newWordChance should pick the new word despite a due one existing');
});

test('pickNextWord picks the due word when the newWordChance roll fails', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const now = 1000;
  const states = {
    1: createWordState(now), // brand new
    2: { ...createWordState(now), timesSeen: 1, dueAt: now - 1 }, // due
  };
  const pick = pickNextWord(words, states, new Set(), { now, newWordCap: 2, newWordChance: 0, rng: () => 0.99 });
  assert.equal(pick.id, 2);
});

test('pickNextWord introduces a new word past the cap when nothing due or masteredNotDue is available', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const now = 0;
  const states = { 1: createWordState(now), 2: createWordState(now) }; // both brand new
  // Cap of 0 with one already "active" (counted via a fake active state) would
  // normally forbid introducing more -- but with nothing due and nothing
  // mastered-not-due, the fallback should still hand back a new word instead
  // of stalling.
  const pick = pickNextWord(words, states, new Set(), { now, newWordCap: 0, rng: () => 0.99 });
  assert.ok([1, 2].includes(pick.id));
});

test('pickNextWord falls back to the earliest-seen mastered word when the mastery-check roll fails and nothing else qualifies', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const now = 100_000;
  const states = {
    1: { ...markKnown(createWordState(now), now), lastSeenAt: 1000 },
    2: { ...markKnown(createWordState(now), now), lastSeenAt: 2000 },
  };
  const pick = pickNextWord(words, states, new Set(), {
    now,
    newWordCap: 0,
    masteryCheckChance: 0,
    rng: () => 0.99,
  });
  assert.equal(pick.id, 1, 'should fall back to the least-recently-seen mastered word');
});

test('pickNextWord falls back to the least-recently-seen candidate when nothing is due, new, or mastered-not-due', () => {
  const words = [{ id: 1 }, { id: 2 }];
  const now = 100_000;
  // Both seen before, not due yet, and not mastered -- e.g. mid-way through
  // learning steps with a future dueAt.
  const states = {
    1: { ...createWordState(now), timesSeen: 1, dueAt: now + 10_000, lastSeenAt: 500 },
    2: { ...createWordState(now), timesSeen: 1, dueAt: now + 10_000, lastSeenAt: 1500 },
  };
  const pick = pickNextWord(words, states, new Set(), { now, newWordCap: 0, rng: () => 0.99 });
  assert.equal(pick.id, 1, 'should fall back to the least-recently-seen candidate');
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
