// CEFR (Common European Framework of Reference for Languages) level
// helpers -- the A1-C2 scale used worldwide to describe language
// proficiency and to sequence what vocabulary/grammar gets introduced
// when. See README's "How leveling works" section for the full picture.
//
// This is deliberately an *approximation*: the canonical word-by-word
// inventory for Spanish (Instituto Cervantes' Plan Curricular) is
// copyrighted reference material, not something to embed here. Instead,
// level is derived from a word's position in the deck, using published
// cumulative-vocabulary-size benchmarks per level -- frequency correlates
// strongly with CEFR level (that's essentially how those benchmark
// figures are derived in the first place). Good enough to sequence a
// learning game; not a substitute for a certified curriculum.

export const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Cumulative word count at which each level "fills up", roughly matching
 * published CEFR vocabulary-size benchmarks (A1 ~500 words, A2 ~900-1000
 * cumulative, B1 ~1850-2000 cumulative); B2/C1/C2 extrapolate the same
 * growth pattern, since published benchmarks get sparse past B1. */
const LEVEL_CEILINGS = [500, 1000, 2000, 3500, 5000, Infinity];

/** @returns {string} the CEFR level for the word at this position in an otherwise-unleveled deck. */
export function levelForPosition(index) {
  // LEVEL_CEILINGS' last entry is Infinity, so this always finds a match.
  return LEVELS[LEVEL_CEILINGS.findIndex((ceiling) => index < ceiling)];
}

/** @returns {number} comparable rank, lower = more beginner. */
export function levelRank(level) {
  return LEVELS.indexOf(level);
}

/** @returns {string} whichever of the two levels is more advanced. */
export function maxLevel(a, b) {
  return levelRank(a) >= levelRank(b) ? a : b;
}
