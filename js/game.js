import { WORDS } from './words.js';
import { createWordState, reviewWord, tierOf, pickNextWord, markKnown, markNeedsPractice, TIER } from './srs.js';
import { getAllWordStates, putWordState, clearWordStates, getHistoryAll, putHistoryDay, clearHistory } from './db.js';
import { dateKey, addReviewToRecord, computeStreak, computeLongestStreak, lastNDaysSeries, totals } from './history.js';
import { createConjugationExpander } from './dynamic-conjugator.js';

const MATCH_FLASH_MS = 350; // green highlight, before the fade-out starts
const REMOVE_FADE_MS = 220; // fade-out duration for a just-matched card
const ENTER_FADE_MS = 250; // fade-in duration for the card that replaces it
const HISTORY_CHART_DAYS = 30;

/** @param {number} misses */
function bucketFromMisses(misses) {
  if (misses <= 0) return 'clean';
  if (misses === 1) return 'retried';
  return 'lapsed';
}

function isVerbInfinitive(w) {
  return w.category === 'verbs' && w.type === 'word';
}

/**
 * Async because it hydrates per-word progress from IndexedDB before the
 * pool can be filled. Callers should `await createGame(...)`.
 */
export async function createGame({ poolSize = 6, onChange = () => {} } = {}) {
  const [savedStates, savedHistory] = await Promise.all([getAllWordStates(), getHistoryAll()]);

  const states = hydrateStates(savedStates);
  const historyByDate = { ...savedHistory };

  // `allWords` starts as the static catalog and grows as verb conjugations
  // get generated (see expandVerbIfNeeded). Conjugating one verb takes a
  // few milliseconds; conjugating every verb in the deck up front would
  // take several *seconds* and freeze the UI on load (worse on a phone),
  // so this happens lazily, spread across normal play, instead. See
  // js/dynamic-conjugator.js for why this doesn't jeopardize per-word
  // stats/persistence: ids are still derived from Spanish text, so a
  // conjugation generated this session lands on the exact same id a
  // previous (or future) session would generate for it.
  let allWords = [...WORDS];
  let wordsById = new Map(allWords.map((w) => [w.id, w]));
  const usedIds = new Set(allWords.map((w) => w.id));
  const expandedVerbEs = new Set();
  const { expandVerb } = createConjugationExpander(usedIds);

  /** @type {{wordId:string, misses:number}[]} */
  let enColumn = [];
  /** @type {{wordId:string, misses:number}[]} */
  let esColumn = [];
  let selectedEnId = null;
  let selectedEsId = null;

  function expandVerbIfNeeded(word) {
    if (!isVerbInfinitive(word) || expandedVerbEs.has(word.es)) return;
    expandedVerbEs.add(word.es);
    const newEntries = expandVerb(word);
    for (const entry of newEntries) {
      allWords.push(entry);
      wordsById.set(entry.id, entry);
      states[entry.id] = savedStates[entry.id]
        ? { ...createWordState(), ...savedStates[entry.id] }
        : createWordState();
    }
  }

  // Catch-up pass: a verb encountered in an earlier session should have
  // its conjugations available immediately (both so returning progress on
  // them reattaches right away, and so the scheduler can pick them without
  // waiting for that verb to be re-introduced into the pool).
  for (const word of WORDS) {
    if (isVerbInfinitive(word) && states[word.id]?.timesSeen > 0) {
      expandVerbIfNeeded(word);
    }
  }

  function activeIds() {
    return new Set(enColumn.map((c) => c.wordId));
  }

  function activeIdsExcluding(excludeId) {
    const ids = activeIds();
    ids.delete(excludeId);
    return ids;
  }

  function fillPool() {
    while (enColumn.length < poolSize) {
      const word = pickNextWord(allWords, states, activeIds());
      if (!word) break;
      insertRandom(enColumn, { wordId: word.id, misses: 0 });
      insertRandom(esColumn, { wordId: word.id, misses: 0 });
      expandVerbIfNeeded(word);
    }
  }

  function insertRandom(arr, item) {
    const idx = Math.floor(Math.random() * (arr.length + 1));
    arr.splice(idx, 0, item);
  }

  function removeWord(wordId) {
    enColumn = enColumn.filter((c) => c.wordId !== wordId);
    esColumn = esColumn.filter((c) => c.wordId !== wordId);
  }

  function recordHistory(bucket, isNewWord, now = new Date()) {
    const key = dateKey(now);
    const updated = addReviewToRecord(historyByDate[key], bucket, isNewWord);
    historyByDate[key] = updated;
    putHistoryDay(key, updated).catch((err) => console.warn('Failed to save history', err));
  }

  function tierCounts() {
    const counts = { [TIER.NEW]: 0, [TIER.LEARNING]: 0, [TIER.FAMILIAR]: 0, [TIER.MASTERED]: 0 };
    for (const w of allWords) counts[tierOf(states[w.id])]++;
    return counts;
  }

  // A correct match clears the selection immediately (see attemptMatch) so
  // the player can start their next pick right away rather than being
  // blocked until the fade/replace animation finishes -- its green flash is
  // driven by the `matched` flag on the specific cards instead (see
  // cardClass in main.js). So by the time both ids are non-null here, they
  // can only be a wrong pair: left selected on purpose, both ids staying
  // set for as long as the player leaves them there, so the red flash
  // persists until their *next* selection clears it (see selectCard)
  // rather than reverting on a fixed timer.
  function currentFlash() {
    if (selectedEnId == null || selectedEsId == null) return null;
    return 'wrong';
  }

  function snapshot() {
    const flash = currentFlash();
    return {
      en: enColumn.map((c) => ({ ...c, word: wordsById.get(c.wordId), selected: c.wordId === selectedEnId })),
      es: esColumn.map((c) => ({ ...c, word: wordsById.get(c.wordId), selected: c.wordId === selectedEsId })),
      flash,
      stats: { total: allWords.length, counts: tierCounts() },
    };
  }

  function emit() {
    onChange(snapshot());
  }

  /** @param {'en'|'es'} side */
  function selectCard(side, wordId) {
    // A wrong pair stays on screen in red (see currentFlash) until the
    // player's next selection anywhere -- that click's first job is to
    // clear it back to normal, *then* register itself as a fresh, single
    // selection (not to also try completing a pairing against the
    // just-cleared other side).
    if (selectedEnId != null && selectedEsId != null && selectedEnId !== selectedEsId) {
      selectedEnId = null;
      selectedEsId = null;
    }

    if (side === 'en') {
      if (selectedEnId === wordId) {
        selectedEnId = null;
        emit();
        return;
      }
      selectedEnId = wordId;
    } else {
      if (selectedEsId === wordId) {
        selectedEsId = null;
        emit();
        return;
      }
      selectedEsId = wordId;
    }

    if (selectedEnId != null && selectedEsId != null) {
      attemptMatch();
    } else {
      emit();
    }
  }

  function attemptMatch() {
    const enId = selectedEnId;
    const esId = selectedEsId;

    if (enId === esId) {
      // Correct match: mark the two cards `matched` (green flash, via
      // cardClass in main.js) and clear the selection immediately -- unlike
      // a wrong pair, there's nothing left for the player to act on here,
      // so nothing should be left occupying selectedEnId/selectedEsId and
      // blocking their next pick while the fade/replace animation plays
      // out. Then: fade the two matched cards out in place, then swap in a
      // replacement (fading it in) at those exact same board positions.
      // Every other card's index never changes, so it never has to shift
      // to fill a gap -- see resolveMatch below.
      const enCard = enColumn.find((c) => c.wordId === enId);
      const esCard = esColumn.find((c) => c.wordId === esId);
      if (enCard) enCard.matched = true;
      if (esCard) esCard.matched = true;
      selectedEnId = null;
      selectedEsId = null;
      emit();
      setTimeout(() => resolveMatch(enId, esId), MATCH_FLASH_MS);
      return;
    }

    // Wrong pairing: both involved cards take a "miss" for this appearance,
    // then stay selected (and red, via currentFlash) with input left
    // unlocked -- the player's next selection is what clears it back to
    // normal (see selectCard), not a timer.
    const enCard = enColumn.find((c) => c.wordId === enId);
    const esCard = esColumn.find((c) => c.wordId === esId);
    if (enCard) enCard.misses += 1;
    if (esCard) esCard.misses += 1;
    emit();
  }

  /** Phase 2 of a correct match: record the review, then start the fade-out. */
  function resolveMatch(enId, esId) {
    const enCard = enColumn.find((c) => c.wordId === enId);
    const esCard = esColumn.find((c) => c.wordId === esId);
    const misses = Math.max(enCard?.misses ?? 0, esCard?.misses ?? 0);
    const wasNewWord = states[enId].timesSeen === 0;

    states[enId] = reviewWord(states[enId], misses);
    putWordState(enId, states[enId]).catch((err) => console.warn('Failed to save word state', err));
    recordHistory(bucketFromMisses(misses), wasNewWord);

    if (enCard) {
      delete enCard.matched;
      enCard.removing = true;
    }
    if (esCard) {
      delete esCard.matched;
      esCard.removing = true;
    }
    emit();

    setTimeout(() => swapInReplacement(enId, esId), REMOVE_FADE_MS);
  }

  /** Phase 3: swap the faded-out slot for a freshly picked word, in place, and let it fade in. */
  function swapInReplacement(enId, esId) {
    const enIdx = enColumn.findIndex((c) => c.wordId === enId);
    const esIdx = esColumn.findIndex((c) => c.wordId === esId);
    const nextWord = pickNextWord(allWords, states, activeIdsExcluding(enId));

    if (enIdx === -1 || esIdx === -1 || !nextWord) {
      // Nothing to replace it with (deck exhausted) -- fall back to just
      // shrinking the pool by this one slot.
      if (enIdx !== -1) enColumn.splice(enIdx, 1);
      if (esIdx !== -1) esColumn.splice(esIdx, 1);
    } else {
      enColumn[enIdx] = { wordId: nextWord.id, misses: 0, entering: true };
      esColumn[esIdx] = { wordId: nextWord.id, misses: 0, entering: true };
      expandVerbIfNeeded(nextWord);
    }

    emit();

    if (nextWord) setTimeout(() => clearEntering(nextWord.id), ENTER_FADE_MS);
  }

  /** Phase 4: drop the transient "entering" flag once its fade-in has played, so an unrelated re-render later doesn't replay it. */
  function clearEntering(wordId) {
    const enCard = enColumn.find((c) => c.wordId === wordId);
    const esCard = esColumn.find((c) => c.wordId === wordId);
    if (enCard) delete enCard.entering;
    if (esCard) delete esCard.entering;
    emit();
  }

  /**
   * "I already know this" — long-press menu action. Jumps the word
   * straight to mastered-scale spacing instead of making the player earn
   * it through the normal ramp-up. If the word is currently on screen, it
   * gets swapped out immediately (this isn't a "review", so it doesn't
   * touch the mismatch/history bookkeeping).
   */
  function markWordKnown(wordId) {
    if (!states[wordId]) return;
    states[wordId] = markKnown(states[wordId]);
    putWordState(wordId, states[wordId]).catch((err) => console.warn('Failed to save word state', err));
    swapOutIfActive(wordId);
  }

  /** Undo a "known" mark (or just reset a struggling word) back to a fresh, never-seen state. */
  function markWordNeedsPractice(wordId) {
    if (!states[wordId]) return;
    states[wordId] = markNeedsPractice();
    putWordState(wordId, states[wordId]).catch((err) => console.warn('Failed to save word state', err));
    swapOutIfActive(wordId);
  }

  function swapOutIfActive(wordId) {
    if (!activeIds().has(wordId)) {
      emit();
      return;
    }
    if (selectedEnId === wordId) selectedEnId = null;
    if (selectedEsId === wordId) selectedEsId = null;
    removeWord(wordId);
    fillPool();
    emit();
  }

  /** Every word plus its current stats, for the Word List table. Cheap enough to call on demand even at a few thousand words. */
  function getAllWordsWithStats() {
    return allWords.map((w) => {
      const s = states[w.id];
      return {
        ...w,
        tier: tierOf(s),
        timesSeen: s.timesSeen,
        timesCorrect: s.timesCorrect,
        timesWrong: s.timesWrong,
        accuracy: s.timesSeen > 0 ? s.timesCorrect / s.timesSeen : null,
        ef: s.ef,
        intervalMin: s.intervalMin,
        dueAt: s.dueAt,
        lastSeenAt: s.lastSeenAt,
        manuallyMastered: s.manuallyMastered,
      };
    });
  }

  /** Lightweight lookup for the long-press menu — avoids rebuilding the full table array just to check one word. */
  function getWordStatus(wordId) {
    const s = states[wordId];
    if (!s) return null;
    return { tier: tierOf(s), manuallyMastered: s.manuallyMastered };
  }

  function getWordById(wordId) {
    return wordsById.get(wordId) ?? null;
  }

  /** Streak/accuracy/chart data for the Stats view. */
  function getHistorySummary(now = new Date()) {
    return {
      streak: computeStreak(historyByDate, now),
      longestStreak: computeLongestStreak(historyByDate),
      totals: totals(historyByDate),
      series: lastNDaysSeries(historyByDate, HISTORY_CHART_DAYS, now),
    };
  }

  async function reset() {
    await Promise.all([clearWordStates(), clearHistory()]);
    for (const id of Object.keys(states)) delete states[id];
    Object.assign(states, hydrateStates({}));
    for (const key of Object.keys(historyByDate)) delete historyByDate[key];

    // Drop every dynamically-generated conjugation and go back to just the
    // static catalog, so a full reset really does start from scratch.
    allWords = [...WORDS];
    wordsById = new Map(allWords.map((w) => [w.id, w]));
    usedIds.clear();
    for (const w of allWords) usedIds.add(w.id);
    expandedVerbEs.clear();

    enColumn = [];
    esColumn = [];
    selectedEnId = null;
    selectedEsId = null;
    fillPool();
    emit();
  }

  function setPoolSize(n) {
    poolSize = n;
    fillPool();
    emit();
  }

  fillPool();

  return {
    selectCard,
    snapshot,
    reset,
    setPoolSize,
    emit,
    markWordKnown,
    markWordNeedsPractice,
    getAllWordsWithStats,
    getHistorySummary,
    getWordStatus,
    getWordById,
  };
}

function hydrateStates(saved) {
  const states = {};
  for (const w of WORDS) {
    states[w.id] = saved[w.id] ? { ...createWordState(), ...saved[w.id] } : createWordState();
  }
  return states;
}
