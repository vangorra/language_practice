import { WORDS } from './words.js';
import { createWordState, reviewWord, tierOf, pickNextWord, TIER } from './srs.js';
import { loadProgress, saveProgress, clearProgress } from './storage.js';

const WORDS_BY_ID = new Map(WORDS.map((w) => [w.id, w]));
const MISMATCH_FLASH_MS = 500;
const MATCH_FLASH_MS = 350;

export function createGame({ poolSize = 6, onChange = () => {} } = {}) {
  const states = hydrateStates(loadProgress());

  /** @type {{wordId:number, misses:number}[]} */
  let enColumn = [];
  /** @type {{wordId:number, misses:number}[]} */
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

  function stats() {
    const counts = { [TIER.NEW]: 0, [TIER.LEARNING]: 0, [TIER.FAMILIAR]: 0, [TIER.MASTERED]: 0 };
    for (const w of WORDS) counts[tierOf(states[w.id])]++;
    return { total: WORDS.length, counts };
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
      stats: stats(),
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
        states[enId] = reviewWord(states[enId], misses);
        saveProgress(states);

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

  function reset() {
    clearProgress();
    for (const id of Object.keys(states)) delete states[id];
    Object.assign(states, hydrateStates({}));
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

  return { selectCard, snapshot, reset, setPoolSize, emit };
}

function hydrateStates(saved) {
  const states = {};
  for (const w of WORDS) {
    states[w.id] = saved[w.id] ? { ...createWordState(), ...saved[w.id] } : createWordState();
  }
  return states;
}
