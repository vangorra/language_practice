import { WORDS } from './words.js';
import { createWordState, reviewWord, tierOf, pickNextWord, markKnown, markNeedsPractice, TIER } from './srs.js';
import { getAllWordStates, putWordState, clearWordStates, getHistoryAll, putHistoryDay, clearHistory } from './db.js';
import { dateKey, addReviewToRecord, computeStreak, computeLongestStreak, lastNDaysSeries, totals } from './history.js';

const WORDS_BY_ID = new Map(WORDS.map((w) => [w.id, w]));
const MISMATCH_FLASH_MS = 500;
const MATCH_FLASH_MS = 350;
const HISTORY_CHART_DAYS = 30;

/** @param {number} misses */
function bucketFromMisses(misses) {
  if (misses <= 0) return 'clean';
  if (misses === 1) return 'retried';
  return 'lapsed';
}

/**
 * Async because it hydrates per-word progress from IndexedDB before the
 * pool can be filled. Callers should `await createGame(...)`.
 */
export async function createGame({ poolSize = 6, onChange = () => {} } = {}) {
  const [savedStates, savedHistory] = await Promise.all([getAllWordStates(), getHistoryAll()]);

  const states = hydrateStates(savedStates);
  const historyByDate = { ...savedHistory };

  /** @type {{wordId:string, misses:number}[]} */
  let enColumn = [];
  /** @type {{wordId:string, misses:number}[]} */
  let esColumn = [];
  let selectedEnId = null;
  let selectedEsId = null;
  let lockInput = false; // brief lock during flash animations

  function activeIds() {
    return new Set(enColumn.map((c) => c.wordId));
  }

  function fillPool() {
    while (enColumn.length < poolSize) {
      const word = pickNextWord(WORDS, states, activeIds());
      if (!word) break;
      insertRandom(enColumn, { wordId: word.id, misses: 0 });
      insertRandom(esColumn, { wordId: word.id, misses: 0 });
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
    for (const w of WORDS) counts[tierOf(states[w.id])]++;
    return counts;
  }

  function currentFlash() {
    if (!lockInput || selectedEnId == null || selectedEsId == null) return null;
    return selectedEnId === selectedEsId ? 'correct' : 'wrong';
  }

  function snapshot() {
    const flash = currentFlash();
    return {
      en: enColumn.map((c) => ({ ...c, word: WORDS_BY_ID.get(c.wordId), selected: c.wordId === selectedEnId })),
      es: esColumn.map((c) => ({ ...c, word: WORDS_BY_ID.get(c.wordId), selected: c.wordId === selectedEsId })),
      locked: lockInput,
      flash,
      stats: { total: WORDS.length, counts: tierCounts() },
    };
  }

  function emit() {
    onChange(snapshot());
  }

  /** @param {'en'|'es'} side */
  function selectCard(side, wordId) {
    if (lockInput) return;

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
      // Correct match.
      lockInput = true;
      emit(); // let the UI show the "correct" flash briefly before removal
      setTimeout(() => {
        const enCard = enColumn.find((c) => c.wordId === enId);
        const esCard = esColumn.find((c) => c.wordId === esId);
        const misses = Math.max(enCard?.misses ?? 0, esCard?.misses ?? 0);
        const wasNewWord = states[enId].timesSeen === 0;

        states[enId] = reviewWord(states[enId], misses);
        putWordState(enId, states[enId]).catch((err) => console.warn('Failed to save word state', err));
        recordHistory(bucketFromMisses(misses), wasNewWord);

        removeWord(enId);
        selectedEnId = null;
        selectedEsId = null;
        lockInput = false;
        fillPool();
        emit();
      }, MATCH_FLASH_MS);
      return;
    }

    // Wrong pairing: both involved cards take a "miss" for this appearance.
    lockInput = true;
    const enCard = enColumn.find((c) => c.wordId === enId);
    const esCard = esColumn.find((c) => c.wordId === esId);
    if (enCard) enCard.misses += 1;
    if (esCard) esCard.misses += 1;
    emit();
    setTimeout(() => {
      selectedEnId = null;
      selectedEsId = null;
      lockInput = false;
      emit();
    }, MISMATCH_FLASH_MS);
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
    return WORDS.map((w) => {
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
    return WORDS_BY_ID.get(wordId) ?? null;
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
