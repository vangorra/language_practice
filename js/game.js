import { WORDS } from './words.js';
import { createWordState, reviewWord, tierOf, pickNextWord, markKnown, markNeedsPractice, TIER } from './srs.js';
import { getAllWordStates, putWordState, clearWordStates, getHistoryAll, putHistoryDay, clearHistory } from './db.js';
import { dateKey, addReviewToRecord, computeStreak, computeLongestStreak, lastNDaysSeries, totals } from './history.js';
import { createConjugationExpander } from './dynamic-conjugator.js';
import { LEVELS } from './level.js';

const MATCH_FLASH_MS = 350; // green highlight, before the fade-out starts
const REMOVE_FADE_MS = 220; // fade-out duration for a just-matched card
const ENTER_FADE_MS = 250; // fade-in duration for the card that replaces it
const HISTORY_CHART_DAYS = 30;
// A correct match doesn't clear right away -- it turns green and *locks*
// (see selectCard: a matched card can't be selected or deselected anymore)
// while play continues elsewhere, and stays that way until this many
// distinct pairs are confirmed. Only then do all of them fade out and get
// replaced together. Without this, a lucky or brute-forced guess (or just
// spamming one already-known pair) got full credit the instant it landed;
// now the player has to move on and confirm a *different* pair too before
// anything actually clears, which is much less exploitable while still
// costing a knowledgeable player nothing but one extra correct match. See
// attemptMatch/resolveMatches.
const MATCHES_NEEDED = 2;

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

  /** @type {{wordId:string, misses:number, matched?:boolean}[]} */
  let enColumn = [];
  /** @type {{wordId:string, misses:number, matched?:boolean}[]} */
  let esColumn = [];
  let selectedEnId = null;
  let selectedEsId = null;
  /** Correct pairs confirmed (green, locked) but not yet cleared -- see MATCHES_NEEDED. @type {{enId:string, esId:string, misses:number}[]} */
  let pendingConfirmed = [];

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

  /**
   * @param {Set<string>} [excludeIds] - ids to keep out of the pool even
   *   though they're no longer active -- e.g. a word just removed via
   *   markWordKnown/markWordNeedsPractice a moment ago, which would
   *   otherwise be free to get picked right back into its own now-empty
   *   slot (most easily triggered by srs.js's "mastery check" pick, which
   *   is happy to immediately re-select the sole not-yet-due mastered
   *   word -- exactly what a just-marked-known word now is).
   */
  function fillPool(excludeIds) {
    while (enColumn.length < poolSize) {
      const ids = activeIds();
      if (excludeIds) for (const id of excludeIds) ids.add(id);
      const word = pickNextWord(allWords, states, ids);
      /* c8 ignore start -- only reachable once the entire deck (every
         static word plus every conjugation of every verb, ~29,000
         candidates) is simultaneously active; confirmed by direct
         measurement to take 15+ seconds to even construct, so
         deliberately left untested. */
      if (!word) break;
      /* c8 ignore stop */
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
    // A confirmed (green) card is locked -- done, waiting for a second
    // pair to also be confirmed before anything clears (see
    // MATCHES_NEEDED) -- so it can't be selected *or* deselected anymore.
    const card = (side === 'en' ? enColumn : esColumn).find((c) => c.wordId === wordId);
    if (card?.matched) return;

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
      // Correct match: mark the two cards `matched` (green, and now locked
      // -- see selectCard) and clear the selection immediately -- unlike a
      // wrong pair, there's nothing left for the player to act on here, so
      // nothing should be left occupying selectedEnId/selectedEsId and
      // blocking their next pick while this pair waits. Queue it in
      // pendingConfirmed rather than resolving it right away: nothing
      // actually clears until MATCHES_NEEDED distinct pairs are confirmed
      // (see the constant's comment for why), however long that takes --
      // this one just sits there green until then.
      const enCard = enColumn.find((c) => c.wordId === enId);
      const esCard = esColumn.find((c) => c.wordId === esId);
      const misses = Math.max(enCard?.misses ?? 0, esCard?.misses ?? 0);
      if (enCard) enCard.matched = true;
      if (esCard) esCard.matched = true;
      selectedEnId = null;
      selectedEsId = null;
      pendingConfirmed.push({ enId, esId, misses });
      emit();

      if (pendingConfirmed.length >= MATCHES_NEEDED) {
        const batch = pendingConfirmed;
        pendingConfirmed = [];
        setTimeout(() => resolveMatches(batch), MATCH_FLASH_MS);
      }
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

  /** Once MATCHES_NEEDED pairs are confirmed: record each one's review, then start fading all of them out together. */
  function resolveMatches(batch) {
    for (const { enId, esId, misses } of batch) {
      const wasNewWord = states[enId].timesSeen === 0;
      states[enId] = reviewWord(states[enId], misses);
      putWordState(enId, states[enId]).catch((err) => console.warn('Failed to save word state', err));
      recordHistory(bucketFromMisses(misses), wasNewWord);

      const enCard = enColumn.find((c) => c.wordId === enId);
      const esCard = esColumn.find((c) => c.wordId === esId);
      if (enCard) {
        delete enCard.matched;
        enCard.removing = true;
      }
      if (esCard) {
        delete esCard.matched;
        esCard.removing = true;
      }
    }
    emit();

    setTimeout(() => swapInReplacements(batch), REMOVE_FADE_MS);
  }

  /** Swap every faded-out slot in the batch for a freshly picked word, in place, and let each fade in. */
  function swapInReplacements(batch) {
    const entered = [];
    for (const { enId, esId } of batch) {
      const enIdx = enColumn.findIndex((c) => c.wordId === enId);
      const esIdx = esColumn.findIndex((c) => c.wordId === esId);

      // enId and esId are always the same word (a pendingConfirmed entry is
      // only ever created from a *correct* match, where they're required to
      // be equal), and removeWord always takes a word out of both columns
      // together -- so enIdx and esIdx can only ever be "both found" or
      // "both -1", never split. This is the real, reachable case: the word
      // was already removed via a different path (e.g. markWordKnown from
      // the long-press menu) between this batch being scheduled and this
      // phase actually running -- see the matching test. Nothing left here
      // to replace.
      if (enIdx === -1) continue;

      // activeIds() reads the live columns, so it naturally (a) still
      // includes enId itself, at this point still sitting in its old,
      // not-yet-overwritten slot -- keeping it from picking itself as its
      // own replacement (see fillPool's doc comment for why that's a real
      // failure mode, not just theoretical) -- and (b) already reflects
      // any words swapped in by earlier iterations of this same batch.
      const nextWord = pickNextWord(allWords, states, activeIds());
      /* c8 ignore start -- only reachable once the entire deck (every
         static word plus every conjugation of every verb, ~29,000
         candidates) is simultaneously active; confirmed by direct
         measurement to take 15+ seconds to even construct, let alone
         assert against, so this is deliberately left untested rather
         than paying that cost on every test run. Deck exhausted: fall
         back to just shrinking the pool by this one slot. */
      if (!nextWord) {
        enColumn.splice(enIdx, 1);
        esColumn.splice(esIdx, 1);
        continue;
      }
      /* c8 ignore stop */

      enColumn[enIdx] = { wordId: nextWord.id, misses: 0, entering: true };
      esColumn[esIdx] = { wordId: nextWord.id, misses: 0, entering: true };
      expandVerbIfNeeded(nextWord);
      entered.push(nextWord.id);
    }

    emit();

    for (const wordId of entered) {
      setTimeout(() => clearEntering(wordId), ENTER_FADE_MS);
    }
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
    // If this word was sitting confirmed-but-pending (green, waiting on a
    // second pair -- see MATCHES_NEEDED), drop it from the queue too: it's
    // about to be removed outright via a completely different path (the
    // long-press menu, not a match), so there's nothing left to resolve it
    // against.
    pendingConfirmed = pendingConfirmed.filter((p) => p.enId !== wordId);
    removeWord(wordId);
    // Exclude wordId itself from its own replacement -- see fillPool's
    // doc comment for why this isn't just a theoretical concern.
    fillPool(new Set([wordId]));
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

  /**
   * Per-CEFR-level introduction progress, plus the current "frontier"
   * level -- the lowest level that still has un-introduced (never-seen)
   * words, matching the same notion pickNextWord uses to prioritize new
   * words (see srs.js's lowestLevelAmong). Once a level's words are all
   * introduced at least once, the frontier moves on to the next one.
   */
  function getLevelProgress() {
    const byLevel = {};
    for (const level of LEVELS) byLevel[level] = { total: 0, introduced: 0 };
    for (const w of allWords) {
      const bucket = byLevel[w.level];
      bucket.total++;
      if (states[w.id].timesSeen > 0) bucket.introduced++;
    }
    /* c8 ignore start -- the `?? LEVELS.at(-1)` fallback only fires once
       every level, C2 included, is fully introduced -- i.e. the entire
       multi-thousand-word deck (every static word plus every conjugation
       of every verb) has been seen at least once. Same order of magnitude
       as fillPool/swapInReplacements' "deck exhausted" cases above,
       deliberately left untested for the same reason. */
    const currentLevel = LEVELS.find((level) => byLevel[level].introduced < byLevel[level].total) ?? LEVELS.at(-1);
    /* c8 ignore stop */
    return { currentLevel, byLevel };
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
    pendingConfirmed = [];
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
    getLevelProgress,
  };
}

function hydrateStates(saved) {
  const states = {};
  for (const w of WORDS) {
    states[w.id] = saved[w.id] ? { ...createWordState(), ...saved[w.id] } : createWordState();
  }
  return states;
}
