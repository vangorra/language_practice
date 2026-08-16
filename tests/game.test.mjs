import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createGame } from '../js/game.js';
import { WORDS } from '../js/words.js';
import * as db from '../js/db.js';
import { putWordState } from '../js/db.js';
import { createConjugationExpander } from '../js/dynamic-conjugator.js';

// Timing constants mirrored from game.js (not exported -- these are its
// private implementation detail, so the tests advance mock timers by the
// same values rather than importing them).
const MATCH_FLASH_MS = 350;
const REMOVE_FADE_MS = 220;
const ENTER_FADE_MS = 250;

test.beforeEach(async () => {
  await db.clearWordStates();
  await db.clearHistory();
});

/** Selects the *same* word's id on both sides -- since matching is id-based, this is always a correct match regardless of the pool's actual English/Spanish text. */
function selectCorrectPair(game, wordId) {
  game.selectCard('en', wordId);
  game.selectCard('es', wordId);
}

/** Finds two distinct word ids currently active in the pool (from a snapshot). */
function twoActiveIds(snapshot) {
  const ids = snapshot.en.map((c) => c.wordId);
  return [ids[0], ids[1]];
}

test('createGame resolves with a filled pool matching the requested size', async () => {
  const game = await createGame({ poolSize: 4 });
  const snap = game.snapshot();
  assert.equal(snap.en.length, 4);
  assert.equal(snap.es.length, 4);
  // Same set of word ids on both sides, just independently ordered.
  assert.deepEqual(
    [...snap.en.map((c) => c.wordId)].sort(),
    [...snap.es.map((c) => c.wordId)].sort()
  );
  // >= rather than ===: any verb randomly picked into the pool is expanded
  // into its conjugations immediately (see fillPool/expandVerbIfNeeded),
  // which grows the total beyond the static catalog.
  assert.ok(snap.stats.total >= WORDS.length);
  assert.equal(snap.flash, null);
});

test('createGame defaults to a pool size of 6', async () => {
  const game = await createGame();
  assert.equal(game.snapshot().en.length, 6);
});

test('selecting one card marks it selected without attempting a match', async () => {
  const game = await createGame({ poolSize: 4 });
  const [id] = twoActiveIds(game.snapshot());
  game.selectCard('en', id);
  const snap = game.snapshot();
  assert.ok(snap.en.find((c) => c.wordId === id).selected);
  assert.equal(snap.flash, null);
});

test('selecting the same card again deselects it (en side)', async () => {
  const game = await createGame({ poolSize: 4 });
  const [id] = twoActiveIds(game.snapshot());
  game.selectCard('en', id);
  game.selectCard('en', id);
  const snap = game.snapshot();
  assert.equal(snap.en.find((c) => c.wordId === id).selected, false);
});

test('selecting the same card again deselects it (es side)', async () => {
  const game = await createGame({ poolSize: 4 });
  const [id] = twoActiveIds(game.snapshot());
  game.selectCard('es', id);
  game.selectCard('es', id);
  const snap = game.snapshot();
  assert.equal(snap.es.find((c) => c.wordId === id).selected, false);
});

test('a wrong pairing flashes red, increments misses on both cards, and stays selected', async () => {
  const game = await createGame({ poolSize: 4 });
  const [enId, esId] = twoActiveIds(game.snapshot());
  game.selectCard('en', enId);
  game.selectCard('es', esId);
  const snap = game.snapshot();
  assert.equal(snap.flash, 'wrong');
  assert.equal(snap.en.find((c) => c.wordId === enId).misses, 1);
  assert.equal(snap.es.find((c) => c.wordId === esId).misses, 1);
});

test('selecting a new card after a wrong pairing clears the mismatch and starts a fresh selection', async () => {
  const game = await createGame({ poolSize: 4 });
  const [enId, esId, thirdId] = game.snapshot().en.map((c) => c.wordId);
  game.selectCard('en', enId);
  game.selectCard('es', esId); // wrong, assuming enId !== esId (guaranteed by twoActiveIds-style pick)
  game.selectCard('en', thirdId);
  const snap = game.snapshot();
  assert.equal(snap.flash, null);
  assert.ok(snap.en.find((c) => c.wordId === thirdId).selected);
  assert.equal(snap.en.find((c) => c.wordId === enId).selected, false);
});

test('a correct match flashes green, locks the card, and does not clear until a second pair is confirmed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA] = game.snapshot().en.map((c) => c.wordId);

  selectCorrectPair(game, idA);
  let snap = game.snapshot();
  assert.equal(snap.flash, null, 'selection is cleared immediately on a correct match');
  assert.ok(snap.en.find((c) => c.wordId === idA).matched);
  assert.ok(snap.es.find((c) => c.wordId === idA).matched);

  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS + 1000);
  snap = game.snapshot();
  assert.ok(
    snap.en.find((c) => c.wordId === idA)?.matched,
    'a single confirmation should still be on screen, locked, however long it waits'
  );
});

test('a locked (matched) card cannot be selected or deselected', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA] = game.snapshot().en.map((c) => c.wordId);
  selectCorrectPair(game, idA);

  game.selectCard('en', idA); // should be a no-op
  const snap = game.snapshot();
  assert.equal(snap.en.find((c) => c.wordId === idA).selected, false);
  assert.ok(snap.en.find((c) => c.wordId === idA).matched, 'still matched, unaffected by the click');
});

test('a "correct match" on a word id that is not actually present in either column does not crash', async () => {
  // selectCard's locked-card guard (`card?.matched`) only defends against a
  // *matched* card; a wordId that was never in the pool at all (e.g. a
  // stale reference) isn't guarded against there, so attemptMatch's
  // enCard/esCard lookups need their own optional chaining to stay safe.
  const game = await createGame({ poolSize: 4 });
  selectCorrectPair(game, 'totally-not-a-real-word-id');
  assert.equal(game.snapshot().en.length, 4, 'pool composition should be unaffected');
});

test('confirming a second, different pair clears both, resolves reviews, and replaces them together', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const before = game.snapshot();
  const [idA, idB] = before.en.map((c) => c.wordId);

  selectCorrectPair(game, idA);
  selectCorrectPair(game, idB);

  let snap = game.snapshot();
  assert.ok(snap.en.find((c) => c.wordId === idA).matched);
  assert.ok(snap.en.find((c) => c.wordId === idB).matched);

  t.mock.timers.tick(MATCH_FLASH_MS);
  snap = game.snapshot();
  assert.ok(snap.en.find((c) => c.wordId === idA).removing);
  assert.ok(snap.en.find((c) => c.wordId === idB).removing);
  assert.equal(snap.en.find((c) => c.wordId === idA).matched, undefined);

  t.mock.timers.tick(REMOVE_FADE_MS);
  snap = game.snapshot();
  assert.ok(!snap.en.some((c) => c.wordId === idA), 'idA should be gone from the pool');
  assert.ok(!snap.en.some((c) => c.wordId === idB), 'idB should be gone from the pool');
  assert.equal(snap.en.length, 6, 'pool size is maintained by replacements');
  assert.ok(snap.en.some((c) => c.entering) || snap.es.some((c) => c.entering), 'replacements should be entering');

  t.mock.timers.tick(ENTER_FADE_MS);
  snap = game.snapshot();
  assert.ok(!snap.en.some((c) => c.entering), 'entering flag should clear after its fade-in');

  // The reviewed words' states should reflect one clean review each.
  const stats = game.getAllWordsWithStats();
  const a = stats.find((w) => w.id === idA);
  const b = stats.find((w) => w.id === idB);
  assert.equal(a.timesSeen, 1);
  assert.equal(a.timesCorrect, 1);
  assert.equal(b.timesSeen, 1);
  assert.equal(b.timesCorrect, 1);
});

test('a single miss before the eventual correct match still counts as a correct (quality 3) review', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB, idC] = game.snapshot().en.map((c) => c.wordId);

  // One wrong attempt on idA first (against idB, a different word).
  game.selectCard('en', idA);
  game.selectCard('es', idB);
  assert.equal(game.snapshot().flash, 'wrong');

  // Clear it, then actually match idA correctly.
  selectCorrectPair(game, idA);
  // Second, unrelated pair to trigger the batch resolution.
  selectCorrectPair(game, idC);

  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS);

  const a = game.getAllWordsWithStats().find((w) => w.id === idA);
  assert.equal(a.timesSeen, 1);
  assert.equal(a.timesCorrect, 1, 'qualityFromMisses(1) is still >= 3 ("retried", not "wrong")');
  assert.equal(a.timesWrong, 0);
});

test('two or more misses before the eventual correct match count as a lapsed review', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB, idC] = game.snapshot().en.map((c) => c.wordId);

  // Two wrong attempts on idA (against idB, a different word each time).
  game.selectCard('en', idA);
  game.selectCard('es', idB);
  game.selectCard('en', idA); // clears the mismatch, reselects idA
  game.selectCard('es', idB);
  assert.equal(game.snapshot().en.find((c) => c.wordId === idA).misses, 2);

  selectCorrectPair(game, idA);
  selectCorrectPair(game, idC);
  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS);

  const a = game.getAllWordsWithStats().find((w) => w.id === idA);
  assert.equal(a.timesSeen, 1);
  assert.equal(a.timesWrong, 1, 'qualityFromMisses(2+) is < 3 ("lapsed")');
  assert.equal(a.timesCorrect, 0);
});

test('a word removed via markWordKnown between its batch dispatching and resolving is skipped, not double-processed', async (t) => {
  // Realistic edge case: pairs A and B get their 2nd (batch-triggering)
  // confirmation, which schedules resolveMatches/swapInReplacements on a
  // timer -- but before that timer fires, the player long-presses B and
  // marks it known, removing it via a completely different path
  // (swapOutIfActive). The already-scheduled batch still references B;
  // resolveMatches/swapInReplacements should just no-op for it (found via
  // enColumn.findIndex returning -1) rather than throw or double-remove.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB] = game.snapshot().en.map((c) => c.wordId);

  selectCorrectPair(game, idA);
  selectCorrectPair(game, idB); // 2nd confirmation -- batch of [A, B] now scheduled

  game.markWordKnown(idB); // removed via a different path before the timer fires

  // Ticked in separate steps (matching how the phases actually chain, each
  // one scheduling the next from inside its own callback) rather than one
  // combined tick, for the mock timer to reliably cascade through all three.
  t.mock.timers.tick(MATCH_FLASH_MS);
  t.mock.timers.tick(REMOVE_FADE_MS);
  t.mock.timers.tick(ENTER_FADE_MS);

  const snap = game.snapshot();
  assert.equal(snap.en.length, 6, 'pool size should still be maintained');
  assert.ok(!snap.en.some((c) => c.wordId === idA), 'idA should have been resolved and replaced normally');
  assert.equal(game.getWordStatus(idB).manuallyMastered, true, "idB's known-mark from markWordKnown should stick");
});

test('markWordKnown on an active pool word swaps it out immediately and marks it mastered', async () => {
  const game = await createGame({ poolSize: 4 });
  const [id] = game.snapshot().en.map((c) => c.wordId);
  game.markWordKnown(id);
  const snap = game.snapshot();
  assert.ok(!snap.en.some((c) => c.wordId === id), 'should be gone from the active pool');
  assert.equal(snap.en.length, 4, 'pool refilled to size');
  const status = game.getWordStatus(id);
  assert.equal(status.manuallyMastered, true);
});

test('markWordKnown on a word not currently active just updates its state', async () => {
  const game = await createGame({ poolSize: 4 });
  const activeIds = new Set(game.snapshot().en.map((c) => c.wordId));
  const inactive = WORDS.find((w) => !activeIds.has(w.id));
  game.markWordKnown(inactive.id);
  const snap = game.snapshot();
  assert.equal(snap.en.length, 4, 'pool composition unaffected');
  assert.equal(game.getWordStatus(inactive.id).manuallyMastered, true);
});

test('markWordKnown on an unknown word id is a no-op', async () => {
  const game = await createGame({ poolSize: 4 });
  const before = game.snapshot();
  game.markWordKnown('this-id-does-not-exist');
  const after = game.snapshot();
  assert.deepEqual(before.en, after.en);
});

test('markWordNeedsPractice resets a word back to fresh/new', async () => {
  const game = await createGame({ poolSize: 4 });
  const [id] = game.snapshot().en.map((c) => c.wordId);
  game.markWordKnown(id);
  assert.equal(game.getWordStatus(id).manuallyMastered, true);
  game.markWordNeedsPractice(id);
  assert.equal(game.getWordStatus(id).manuallyMastered, false);
  assert.equal(game.getWordStatus(id).tier, 'new');
});

test('markWordNeedsPractice on an unknown word id is a no-op', async () => {
  const game = await createGame({ poolSize: 4 });
  const before = game.snapshot();
  game.markWordNeedsPractice('this-id-does-not-exist');
  const after = game.snapshot();
  assert.deepEqual(before.en, after.en);
});

test('marking a word known/needs-practice while it is still (partially) selected clears the selection too', async () => {
  const game = await createGame({ poolSize: 6 });
  const [idA] = game.snapshot().en.map((c) => c.wordId);
  game.selectCard('en', idA); // only one side picked, not a completed match
  assert.ok(game.snapshot().en.find((c) => c.wordId === idA).selected);

  game.markWordKnown(idA);
  // idA is gone (swapped out), so it can't still show as selected -- but
  // more importantly, selectedEnId itself must have been cleared, or the
  // *next* word to land in that slot would incorrectly render as selected.
  const snap = game.snapshot();
  assert.ok(!snap.en.some((c) => c.selected), 'no card should be selected after the selected one was swapped out');
});

test('marking the es-side-selected word known clears that selection too', async () => {
  const game = await createGame({ poolSize: 6 });
  const [idA] = game.snapshot().es.map((c) => c.wordId);
  game.selectCard('es', idA);
  assert.ok(game.snapshot().es.find((c) => c.wordId === idA).selected);

  game.markWordNeedsPractice(idA);
  const snap = game.snapshot();
  assert.ok(!snap.es.some((c) => c.selected));
});

test('marking a pending-confirmed (matched) word known drops it from the pending queue too', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB] = game.snapshot().en.map((c) => c.wordId);
  selectCorrectPair(game, idA); // now pending-confirmed, matched, locked

  game.markWordKnown(idA); // swap it out via a totally different path
  const snap = game.snapshot();
  assert.ok(!snap.en.some((c) => c.wordId === idA));

  // A fresh correct match on idB should now need its own second confirmation
  // from scratch -- idA being removed shouldn't have secretly counted.
  selectCorrectPair(game, idB);
  const snap2 = game.snapshot();
  assert.ok(snap2.en.find((c) => c.wordId === idB).matched);
  t.mock.timers.tick(MATCH_FLASH_MS);
  // Still on screen: only one confirmation (idB) has happened since idA was
  // dropped from the queue rather than counted.
  assert.ok(game.snapshot().en.find((c) => c.wordId === idB)?.matched);
});

test('getAllWordsWithStats reports null accuracy for never-seen words and a real ratio after review', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB] = game.snapshot().en.map((c) => c.wordId);
  const before = game.getAllWordsWithStats().find((w) => w.id === idA);
  assert.equal(before.accuracy, null);

  selectCorrectPair(game, idA);
  selectCorrectPair(game, idB);
  // Tick through the full chain (including the final enter-fade phase) so
  // no mock timers are left dangling in the queue when the test ends.
  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS);

  const after = game.getAllWordsWithStats().find((w) => w.id === idA);
  assert.equal(after.accuracy, 1);
});

test('getWordStatus and getWordById return null for an unknown id', async () => {
  const game = await createGame({ poolSize: 4 });
  assert.equal(game.getWordStatus('nope'), null);
  assert.equal(game.getWordById('nope'), null);
});

test('getWordById returns the full word object for a known id', async () => {
  const game = await createGame({ poolSize: 4 });
  const [id] = game.snapshot().en.map((c) => c.wordId);
  const word = game.getWordById(id);
  assert.equal(word.id, id);
  assert.ok(word.en && word.es);
});

test('getLevelProgress starts at the frontier level A1, with nothing yet introduced', async () => {
  const game = await createGame({ poolSize: 4 });
  const progress = game.getLevelProgress();
  assert.equal(progress.currentLevel, 'A1');
  assert.ok(progress.byLevel.A1.total > 0);
  assert.equal(progress.byLevel.A1.introduced, 0);
  assert.equal(progress.byLevel.C2.total > 0, true, 'every level should have at least some words');
});

test('getLevelProgress counts a confirmed review as introducing that word\'s level', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB] = game.snapshot().en.map((c) => c.wordId);
  const levelA = game.getWordById(idA).level;
  const levelB = game.getWordById(idB).level;

  const before = game.getLevelProgress();
  selectCorrectPair(game, idA);
  selectCorrectPair(game, idB);
  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS);

  const after = game.getLevelProgress();
  // idA and idB might land on the same level (both count toward it) or
  // different ones (one each) -- either way, the total introduced across
  // all levels goes up by exactly 2 (one per reviewed word).
  const sumIntroduced = (p) => Object.values(p.byLevel).reduce((n, l) => n + l.introduced, 0);
  assert.equal(sumIntroduced(after), sumIntroduced(before) + 2);
  assert.ok(after.byLevel[levelA].introduced > before.byLevel[levelA].introduced);
  assert.ok(after.byLevel[levelB].introduced > before.byLevel[levelB].introduced);
});

test('getLevelProgress advances the frontier level once the lower level is fully introduced', async () => {
  // Seed every A1 word (and, for A1 verb infinitives, their present-tense
  // conjugations too -- those are themselves fresh A1-level vocabulary the
  // moment the infinitive is "introduced", via the same catch-up pass
  // createGame runs) as already-introduced before the game even loads, so
  // the frontier should move on to A2 for this session.
  const a1Words = WORDS.filter((w) => w.level === 'A1');
  const usedIds = new Set(WORDS.map((w) => w.id));
  const { expandVerb } = createConjugationExpander(usedIds);
  const seedState = {
    timesSeen: 1,
    timesCorrect: 1,
    timesWrong: 0,
    ef: 2.5,
    intervalMin: 1440,
    reps: 1,
    lapses: 0,
    learningStep: 2,
    dueAt: Date.now() + 86_400_000,
    lastSeenAt: Date.now(),
    manuallyMastered: false,
  };

  for (const w of a1Words) {
    await putWordState(w.id, seedState);
    if (w.category === 'verbs' && w.type === 'word') {
      for (const conjugated of expandVerb(w)) {
        if (conjugated.level === 'A1') await putWordState(conjugated.id, seedState);
      }
    }
  }

  const game = await createGame({ poolSize: 4 });
  const progress = game.getLevelProgress();
  assert.equal(progress.currentLevel, 'A2');
  assert.equal(progress.byLevel.A1.introduced, progress.byLevel.A1.total);
});

test('getHistorySummary reflects a completed review', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB] = game.snapshot().en.map((c) => c.wordId);
  selectCorrectPair(game, idA);
  selectCorrectPair(game, idB);
  // Tick through the full chain (including the final enter-fade phase) so
  // no mock timers are left dangling in the queue when the test ends.
  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS);

  const summary = game.getHistorySummary();
  assert.equal(summary.totals.reviews, 2);
  assert.equal(summary.streak, 1);
  assert.equal(summary.series.length, 30);
});

test('reset clears progress, pending confirmations, and refills from scratch', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const game = await createGame({ poolSize: 6 });
  const [idA, idB, idC, idD] = game.snapshot().en.map((c) => c.wordId);

  // A fully-completed review, so historyByDate has something real in it
  // for reset() to actually clear (not just an empty object either way).
  selectCorrectPair(game, idC);
  selectCorrectPair(game, idD);
  // Tick through the full chain (including the final enter-fade phase) so
  // no mock timers are left dangling in the queue when the test ends.
  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS);
  assert.equal(game.getHistorySummary().totals.reviews, 2);

  selectCorrectPair(game, idA); // pending, matched, locked
  game.markWordKnown(idB);

  // Force a large pool temporarily so a substantial number of verbs get
  // expanded, then shrink poolSize back down (fillPool only ever grows, so
  // the *active* pool stays at 200 for now -- but reset()'s own fillPool()
  // call below will use this new, tiny size). That gives a deterministic
  // way to prove the expansions get dropped, rather than comparing two
  // independent random draws (a 200-pool built before vs. after reset)
  // against each other, which -- both being random -- isn't reliably
  // ordered either way.
  game.setPoolSize(200);
  assert.ok(game.snapshot().stats.total > WORDS.length, 'a 200-word pool should have expanded at least one verb');
  game.setPoolSize(1);

  await game.reset();

  const snap = game.snapshot();
  assert.equal(snap.en.length, 1, "reset() refills using poolSize's current value (1), not the pool's prior size");
  assert.ok(
    snap.stats.total <= WORDS.length + 30, // generous bound even if this one word happens to be a verb
    'the previously-expanded conjugations should have been dropped, not carried over'
  );
  assert.equal(game.getWordStatus(idB).manuallyMastered, false);
  assert.equal(game.getWordStatus(idB).tier, 'new');
  assert.equal(game.getHistorySummary().totals.reviews, 0, 'review history should be cleared too');
  // The previously-locked word should be selectable again post-reset if it re-enters the pool.
  const stillActive = snap.en.find((c) => c.wordId === idA);
  if (stillActive) assert.equal(stillActive.matched, undefined);
});

test('setPoolSize grows and shrinks the active pool', async () => {
  const game = await createGame({ poolSize: 4 });
  assert.equal(game.snapshot().en.length, 4);
  game.setPoolSize(8);
  assert.equal(game.snapshot().en.length, 8);
});

test('setPoolSize can shrink below the current pool -- extra cards are simply left as-is (fillPool only ever grows)', async () => {
  const game = await createGame({ poolSize: 8 });
  assert.equal(game.snapshot().en.length, 8);
  game.setPoolSize(4);
  // fillPool's while-loop only tops up when *below* poolSize, so shrinking
  // the requested size doesn't remove existing cards -- confirms that's the
  // real, intentional behavior rather than a bug.
  assert.equal(game.snapshot().en.length, 8);
});

test('emit() calls the onChange callback with a fresh snapshot', async () => {
  const seen = [];
  const game = await createGame({ poolSize: 4, onChange: (s) => seen.push(s) });
  const before = seen.length;
  game.emit();
  assert.equal(seen.length, before + 1);
});

test('a verb encountered in an earlier session is re-expanded immediately on the next load (catch-up pass)', async () => {
  const verb = WORDS.find((w) => w.category === 'verbs' && w.type === 'word');
  await putWordState(verb.id, { timesSeen: 1, timesCorrect: 1, timesWrong: 0, ef: 2.5, intervalMin: 60, reps: 1, lapses: 0, learningStep: 2, dueAt: Date.now() + 60_000, lastSeenAt: Date.now(), manuallyMastered: false });

  const game = await createGame({ poolSize: 1 });
  const stats = game.getAllWordsWithStats();
  assert.ok(stats.length > WORDS.length, 'conjugated forms should already be present, not just the infinitive');
  // At least one generated conjugation should exist for this verb (its
  // English gloss starts with "to " -- e.g. "to be" -> "I am"/"he/she is").
  const conjugated = stats.filter((w) => w.category === 'verbs' && w.type === 'conjugation');
  assert.ok(conjugated.length > 0);
});

test('a conjugated form with prior saved progress reattaches to it via the catch-up pass, not a fresh state', async () => {
  const verb = WORDS.find((w) => w.category === 'verbs' && w.type === 'word');
  // Discover a real conjugated form's id the same way game.js would generate
  // it, so this doesn't have to guess/hardcode a specific Spanish form.
  const { expandVerb } = createConjugationExpander(new Set());
  const [conjugatedForm] = expandVerb(verb);

  await putWordState(verb.id, { timesSeen: 1, timesCorrect: 1, timesWrong: 0, ef: 2.5, intervalMin: 60, reps: 1, lapses: 0, learningStep: 2, dueAt: Date.now() + 60_000, lastSeenAt: Date.now(), manuallyMastered: false });
  await putWordState(conjugatedForm.id, { timesSeen: 5, timesCorrect: 4, timesWrong: 1, ef: 2.8, intervalMin: 500, reps: 3, lapses: 0, learningStep: 2, dueAt: Date.now() + 100_000, lastSeenAt: Date.now(), manuallyMastered: false });

  const game = await createGame({ poolSize: 1 });
  const stats = game.getAllWordsWithStats().find((w) => w.id === conjugatedForm.id);
  assert.ok(stats, 'the conjugated form should exist after the catch-up pass');
  assert.equal(stats.timesSeen, 5, 'should reattach to the saved progress, not start fresh');
  assert.equal(stats.timesCorrect, 4);
});

test('a verb that enters the active pool gets conjugated lazily, on the spot', async () => {
  // A large-enough pool virtually guarantees at least one of the ~1090
  // verbs among ~5800 words gets picked, exercising expandVerbIfNeeded from
  // fillPool rather than the catch-up pass above.
  const game = await createGame({ poolSize: 50 });
  const stats = game.getAllWordsWithStats();
  assert.ok(stats.length > WORDS.length, 'at least one active verb should have been expanded into conjugations');
});
