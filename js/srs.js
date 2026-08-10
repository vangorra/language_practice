// Spaced-repetition scheduling for vocabulary words.
//
// This is a variant of the SM-2 algorithm (the same family Anki uses):
//   - Brand-new words graduate through a couple of short "learning steps"
//     (minutes) so they resurface quickly while still fresh.
//   - Once graduated, correct reviews grow the interval by the word's ease
//     factor (days), pushing well-known words further and further apart.
//   - A miss (mismatch during the game) shrinks the interval back down and
//     nudges the ease factor down, so a word that's slipping gets practiced
//     again soon.
//
// The "quality" of a review is derived automatically from how many wrong
// attempts touched the card before it was finally matched correctly —
// there's no explicit self-rating, since the matching game itself supplies
// the signal.

export const MINUTE = 60 * 1000;
export const DAY = 24 * 60 * MINUTE;

export const TIER = {
  NEW: 'new',
  LEARNING: 'learning',
  FAMILIAR: 'familiar',
  MASTERED: 'mastered',
};

const LEARNING_STEPS_MIN = [1, 10]; // graduation steps, in minutes
const MIN_EASE = 1.3;
const DEFAULT_EASE = 2.5;
const FAMILIAR_THRESHOLD_MIN = 21 * DAY; // matches classic SM-2's "mature" cutoff

/** A fresh, never-seen state for a word. */
export function createWordState(now = Date.now()) {
  return {
    ef: DEFAULT_EASE,
    intervalMin: 0,
    reps: 0,
    lapses: 0,
    learningStep: 0,
    dueAt: now,
    lastSeenAt: null,
    timesSeen: 0,
    timesCorrect: 0,
    timesWrong: 0,
  };
}

/** Map "number of wrong attempts before the correct match" to an SM-2-style quality (0-5). */
function qualityFromMisses(misses) {
  if (misses <= 0) return 5; // matched cleanly, first try
  if (misses === 1) return 3; // matched, but hesitated once
  return 1; // matched only after repeated wrong guesses
}

/** Which mastery tier a word is currently in, for display/reporting. */
export function tierOf(state) {
  if (state.timesSeen === 0) return TIER.NEW;
  if (state.intervalMin < DAY) return TIER.LEARNING;
  if (state.intervalMin < FAMILIAR_THRESHOLD_MIN) return TIER.FAMILIAR;
  return TIER.MASTERED;
}

/**
 * Apply the outcome of one review (one successful match, plus however many
 * wrong attempts preceded it) and return the word's next state.
 *
 * @param {object} state - current word state (see createWordState)
 * @param {number} misses - wrong attempts touching this card before it matched
 * @param {number} now - current timestamp (ms), injectable for tests
 */
export function reviewWord(state, misses, now = Date.now()) {
  const quality = qualityFromMisses(misses);
  const s = { ...state };
  s.timesSeen += 1;
  s.lastSeenAt = now;
  if (quality >= 3) s.timesCorrect += 1;
  else s.timesWrong += 1;

  if (quality < 3) {
    // Lapse: back to the first learning step, ease takes a small hit.
    s.lapses += 1;
    s.reps = 0;
    s.learningStep = 0;
    s.ef = Math.max(MIN_EASE, s.ef - 0.2);
    s.intervalMin = LEARNING_STEPS_MIN[0];
    s.dueAt = now + s.intervalMin * MINUTE;
    return s;
  }

  if (s.learningStep < LEARNING_STEPS_MIN.length) {
    // Still working through the short learning steps.
    s.intervalMin = LEARNING_STEPS_MIN[s.learningStep];
    s.learningStep += 1;
    s.dueAt = now + s.intervalMin * MINUTE;
    return s;
  }

  // Graduated: full SM-2 day-scale interval growth.
  s.ef = Math.max(MIN_EASE, s.ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  if (s.reps === 0) {
    s.intervalMin = 1 * DAY;
  } else if (s.reps === 1) {
    s.intervalMin = 6 * DAY;
  } else {
    s.intervalMin = Math.round(s.intervalMin * s.ef);
  }
  s.reps += 1;
  s.dueAt = now + s.intervalMin * MINUTE;
  return s;
}

/** Weighted random pick: items is an array, weights is a same-length array of positive numbers. */
function weightedPick(items, weights, rng = Math.random) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(rng() * items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Choose the next word to bring into the active pool.
 *
 * Priority, roughly:
 *   1. Words that are due for review (weighted toward "most overdue"),
 *      which covers both "struggling" words (short intervals, due again
 *      soon) and ordinary spaced review.
 *   2. New, never-seen words, trickled in a couple at a time.
 *   3. Occasional early "mastery check" on a well-known word that isn't
 *      technically due yet, just to confirm it's still solid.
 *   4. A least-recently-seen fallback so the game never stalls.
 *
 * @param {object[]} allWords - full word list, each with an `id`
 * @param {Object.<number, object>} states - map of wordId -> SRS state
 * @param {Set<number>} activeIds - word ids currently in the pool
 * @param {object} [options]
 * @param {number} [options.now]
 * @param {number} [options.newWordCap] - max never-seen words active at once
 * @param {number} [options.newWordChance] - chance to prefer a new word when both are available
 * @param {number} [options.masteryCheckChance] - chance to early-review a mastered word
 * @param {function} [options.rng] - injectable RNG for tests
 */
export function pickNextWord(allWords, states, activeIds, options = {}) {
  const {
    now = Date.now(),
    newWordCap = 2,
    newWordChance = 0.35,
    masteryCheckChance = 0.15,
    rng = Math.random,
  } = options;

  const candidates = allWords.filter((w) => !activeIds.has(w.id));
  if (candidates.length === 0) return null;

  const activeNewCount = [...activeIds].filter((id) => states[id]?.timesSeen === 0).length;

  const brandNew = candidates.filter((w) => states[w.id].timesSeen === 0);
  const due = candidates.filter((w) => states[w.id].timesSeen > 0 && states[w.id].dueAt <= now);
  const masteredNotDue = candidates.filter(
    (w) => tierOf(states[w.id]) === TIER.MASTERED && states[w.id].dueAt > now
  );

  const canIntroduceNew = brandNew.length > 0 && activeNewCount < newWordCap;

  if (canIntroduceNew && (due.length === 0 || rng() < newWordChance)) {
    return brandNew[Math.floor(rng() * brandNew.length)];
  }

  if (due.length > 0) {
    const weights = due.map((w) => Math.max(1, now - states[w.id].dueAt));
    return weightedPick(due, weights, rng);
  }

  if (masteredNotDue.length > 0 && rng() < masteryCheckChance) {
    masteredNotDue.sort((a, b) => (states[a.id].lastSeenAt ?? 0) - (states[b.id].lastSeenAt ?? 0));
    return masteredNotDue[0];
  }

  if (canIntroduceNew) {
    return brandNew[Math.floor(rng() * brandNew.length)];
  }

  if (brandNew.length > 0) {
    return brandNew[Math.floor(rng() * brandNew.length)];
  }

  if (masteredNotDue.length > 0) {
    masteredNotDue.sort((a, b) => (states[a.id].lastSeenAt ?? 0) - (states[b.id].lastSeenAt ?? 0));
    return masteredNotDue[0];
  }

  // Fallback: nothing due, nothing new — just pick the least-recently-seen candidate.
  const sorted = [...candidates].sort(
    (a, b) => (states[a.id].lastSeenAt ?? 0) - (states[b.id].lastSeenAt ?? 0)
  );
  return sorted[0];
}
