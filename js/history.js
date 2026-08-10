// Pure helpers over the daily history log (see js/db.js for how it's
// persisted). Kept dependency-free and DOM-free so streak/chart math can
// be unit tested directly with node:test.
//
// A history record for one day looks like:
//   { reviews, clean, retried, lapsed, newWords }
// where reviews = clean + retried + lapsed (every completed match that
// day), split out by how clean the match was (see js/srs.js's quality
// buckets), plus how many never-before-seen words were introduced.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Local (not UTC) 'YYYY-MM-DD' key for a date — day boundaries should match the player's actual day. */
export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Inverse of dateKey: a local Date at midnight for that day. */
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function reviewsOn(historyByDate, key) {
  return historyByDate[key]?.reviews ?? 0;
}

/**
 * Current streak: consecutive days with at least one review, walking
 * backward from today. If today has no activity yet, we start counting
 * from yesterday instead — otherwise the streak would look "broken" every
 * single morning before the player has had a chance to practice.
 */
export function computeStreak(historyByDate, today = new Date()) {
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (reviewsOn(historyByDate, dateKey(cursor)) === 0) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (reviewsOn(historyByDate, dateKey(cursor)) > 0) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Longest streak ever recorded, independent of whether it's still active. */
export function computeLongestStreak(historyByDate) {
  const activeDates = Object.keys(historyByDate)
    .filter((key) => reviewsOn(historyByDate, key) > 0)
    .sort();
  if (activeDates.length === 0) return 0;

  let longest = 1;
  let current = 1;
  for (let i = 1; i < activeDates.length; i++) {
    const diffDays = Math.round(
      (parseDateKey(activeDates[i]) - parseDateKey(activeDates[i - 1])) / MS_PER_DAY
    );
    current = diffDays === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }
  return longest;
}

/** Ordered array of daily records for the last `n` days, ending today (inclusive), zero-filled for gaps. */
export function lastNDaysSeries(historyByDate, n, today = new Date()) {
  const series = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dateKey(d);
    const rec = historyByDate[key] ?? {};
    series.push({
      date: key,
      reviews: rec.reviews ?? 0,
      clean: rec.clean ?? 0,
      retried: rec.retried ?? 0,
      lapsed: rec.lapsed ?? 0,
      newWords: rec.newWords ?? 0,
    });
  }
  return series;
}

/** All-time totals, summed across every recorded day. */
export function totals(historyByDate) {
  let reviews = 0;
  let clean = 0;
  let retried = 0;
  let lapsed = 0;
  let newWords = 0;
  for (const rec of Object.values(historyByDate)) {
    reviews += rec.reviews ?? 0;
    clean += rec.clean ?? 0;
    retried += rec.retried ?? 0;
    lapsed += rec.lapsed ?? 0;
    newWords += rec.newWords ?? 0;
  }
  return { reviews, clean, retried, lapsed, newWords, accuracy: reviews > 0 ? clean / reviews : null };
}

/**
 * Merge one completed match's outcome into a day's record (returns a new
 * record; doesn't mutate the input).
 *
 * @param {object|undefined} record - existing record for the day, if any
 * @param {'clean'|'retried'|'lapsed'} bucket - how the match went
 * @param {boolean} isNewWord - true if this was the word's first-ever review
 */
export function addReviewToRecord(record, bucket, isNewWord) {
  const base = { reviews: 0, clean: 0, retried: 0, lapsed: 0, newWords: 0, ...record };
  return {
    ...base,
    reviews: base.reviews + 1,
    [bucket]: base[bucket] + 1,
    newWords: base.newWords + (isNewWord ? 1 : 0),
  };
}
