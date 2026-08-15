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
const MANUAL_MASTER_INTERVAL_MIN = 30 * DAY; // where a manually-marked word starts

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
    manuallyMastered: false,
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
  if (state.manuallyMastered) return TIER.MASTERED;
  if (state.timesSeen === 0) return TIER.NEW;
  if (state.intervalMin < DAY) return TIER.LEARNING;
  if (state.intervalMin < FAMILIAR_THRESHOLD_MIN) return TIER.FAMILIAR;
  return TIER.MASTERED;
}

/**
 * User override: "I already know this, stop drilling it." Used by the
 * card long-press menu for words the player already knows from elsewhere
 * (e.g. finished a Duolingo unit covering them) and doesn't want to spend
 * early repetitions on. Jumps straight to a long, mastered-scale interval
 * rather than making the player earn it through normal reviews.
 */
export function markKnown(state, now = Date.now()) {
  return {
    ...state,
    ef: Math.max(state.ef, DEFAULT_EASE),
    intervalMin: MANUAL_MASTER_INTERVAL_MIN,
    reps: Math.max(state.reps, 4),
    learningStep: LEARNING_STEPS_MIN.length,
    dueAt: now + MANUAL_MASTER_INTERVAL_MIN,
    lastSeenAt: now,
    timesSeen: Math.max(state.timesSeen, 1),
    timesCorrect: Math.max(state.timesCorrect, 1),
    manuallyMastered: true,
  };
}

/**
 * Undo a manual "known" mark and forget this word's history entirely,
 * sending it back through the deck as if brand new. Used when the player
 * marked something known but it turns out they need practice after all.
 */
export function markNeedsPractice(now = Date.now()) {
  return createWordState(now);
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

/**
 * Weighted random pick: items is an array, weights is a same-length array of
 * positive numbers. Exported (only pickNextWord below calls it in practice)
 * so its two defensive fallbacks -- a non-positive weight total, and the
 * loop finishing without picking anything -- can be exercised directly:
 * neither is reachable through pickNextWord's real call site, since its
 * weights are always `Math.max(1, ...)` (so never <= 0 in total) and rng is
 * always Math.random (which never returns >= 1, the only way the loop could
 * finish without an item's cumulative weight bringing r to <= 0).
 */
export function weightedPick(items, weights, rng = Math.random) {
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
    // lastSeenAt is unconditionally set by every path that can reach
    // TIER.MASTERED (markKnown and reviewWord both stamp it), so no `?? 0`
    // fallback is needed here.
    masteredNotDue.sort((a, b) => states[a.id].lastSeenAt - states[b.id].lastSeenAt);
    return masteredNotDue[0];
  }

  // No due words at this point (the due.length > 0 branch above always
  // returns), so canIntroduceNew here would already have been true and
  // returned above too -- this is the "cap reached, but nothing else is
  // available either" fallback: introduce a new word anyway rather than
  // stall, ignoring the cap just this once.
  if (brandNew.length > 0) {
    return brandNew[Math.floor(rng() * brandNew.length)];
  }

  if (masteredNotDue.length > 0) {
    masteredNotDue.sort((a, b) => states[a.id].lastSeenAt - states[b.id].lastSeenAt);
    return masteredNotDue[0];
  }

  // Fallback: nothing due, nothing new, nothing mastered-not-due -- just
  // pick the least-recently-seen candidate. Reaching this point requires
  // brandNew.length === 0 (the unconditional check above always returns
  // otherwise), so every remaining candidate has timesSeen > 0 and
  // therefore a real lastSeenAt (reviewWord and markKnown both stamp it
  // unconditionally) -- no `?? 0` fallback needed.
  const sorted = [...candidates].sort(
    (a, b) => states[a.id].lastSeenAt - states[b.id].lastSeenAt
  );
  return sorted[0];
}
