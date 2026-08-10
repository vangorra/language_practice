// Persistence for per-word SRS progress, backed by localStorage.
// Kept as tiny wrapper functions so game logic never touches
// localStorage directly and stays testable without a DOM.

const STORAGE_KEY = 'spanish-vocab-matcher:progress:v1';

export function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn('Could not load saved progress, starting fresh.', err);
    return {};
  }
}

export function saveProgress(statesByWordId) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(statesByWordId));
  } catch (err) {
    console.warn('Could not save progress.', err);
  }
}

export function clearProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.warn('Could not clear progress.', err);
  }
}
