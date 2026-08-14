import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey,
  parseDateKey,
  computeStreak,
  computeLongestStreak,
  lastNDaysSeries,
  totals,
  addReviewToRecord,
} from '../js/history.js';

function daysAgo(n, base = new Date(2026, 0, 31)) {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() - n);
}

test('dateKey / parseDateKey round-trip', () => {
  const d = new Date(2026, 2, 5); // March 5, 2026
  const key = dateKey(d);
  assert.equal(key, '2026-03-05');
  const parsed = parseDateKey(key);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 2);
  assert.equal(parsed.getDate(), 5);
});

test('computeStreak counts consecutive days ending today when today has activity', () => {
  const today = daysAgo(0);
  const history = {
    [dateKey(daysAgo(0, today))]: { reviews: 5 },
    [dateKey(daysAgo(1, today))]: { reviews: 3 },
    [dateKey(daysAgo(2, today))]: { reviews: 1 },
    [dateKey(daysAgo(4, today))]: { reviews: 1 }, // gap at day 3 breaks it
  };
  assert.equal(computeStreak(history, today), 3);
});

test('computeStreak does not reset just because today has no activity yet', () => {
  const today = daysAgo(0);
  const history = {
    [dateKey(daysAgo(1, today))]: { reviews: 2 },
    [dateKey(daysAgo(2, today))]: { reviews: 2 },
  };
  assert.equal(computeStreak(history, today), 2);
});

test('computeStreak is 0 once a full day has been missed', () => {
  const today = daysAgo(0);
  const history = {
    [dateKey(daysAgo(2, today))]: { reviews: 2 },
  };
  assert.equal(computeStreak(history, today), 0);
});

test('computeLongestStreak finds the best run even if it is not the current one', () => {
  const today = daysAgo(0);
  const history = {
    [dateKey(daysAgo(10, today))]: { reviews: 1 },
    [dateKey(daysAgo(9, today))]: { reviews: 1 },
    [dateKey(daysAgo(8, today))]: { reviews: 1 },
    [dateKey(daysAgo(7, today))]: { reviews: 1 },
    [dateKey(daysAgo(0, today))]: { reviews: 1 }, // isolated, current streak of 1
  };
  assert.equal(computeLongestStreak(history), 4);
  assert.equal(computeStreak(history, today), 1);
});

test('computeLongestStreak is 0 for an empty history', () => {
  assert.equal(computeLongestStreak({}), 0);
});

test('lastNDaysSeries zero-fills days with no record and stays in order', () => {
  const today = daysAgo(0);
  const history = {
    [dateKey(daysAgo(0, today))]: { reviews: 4, clean: 3, retried: 1, lapsed: 0, newWords: 1 },
  };
  const series = lastNDaysSeries(history, 3, today);
  assert.equal(series.length, 3);
  assert.equal(series[0].reviews, 0);
  assert.equal(series[1].reviews, 0);
  assert.equal(series[2].reviews, 4);
  assert.equal(series[2].date, dateKey(today));
});

test('totals sums across every recorded day and computes accuracy', () => {
  const history = {
    '2026-01-01': { reviews: 3, clean: 2, retried: 1, lapsed: 0, newWords: 2 },
    '2026-01-02': { reviews: 2, clean: 1, retried: 0, lapsed: 1, newWords: 0 },
  };
  const t = totals(history);
  assert.equal(t.reviews, 5);
  assert.equal(t.clean, 3);
  assert.equal(t.retried, 1);
  assert.equal(t.lapsed, 1);
  assert.equal(t.newWords, 2);
  assert.equal(t.accuracy, 3 / 5);
});

test('totals reports null accuracy when there are no reviews yet', () => {
  assert.equal(totals({}).accuracy, null);
});

test('addReviewToRecord accumulates without mutating the input', () => {
  const day1 = addReviewToRecord(undefined, 'clean', true);
  assert.deepEqual(day1, { reviews: 1, clean: 1, retried: 0, lapsed: 0, newWords: 1 });

  const day2 = addReviewToRecord(day1, 'retried', false);
  assert.deepEqual(day2, { reviews: 2, clean: 1, retried: 1, lapsed: 0, newWords: 1 });
  // original untouched
  assert.deepEqual(day1, { reviews: 1, clean: 1, retried: 0, lapsed: 0, newWords: 1 });
});
