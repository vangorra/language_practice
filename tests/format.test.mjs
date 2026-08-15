import test from 'node:test';
import assert from 'node:assert/strict';
import { formatInterval, formatRelative, formatAccuracy } from '../js/format.js';

test('formatInterval: falsy (0/null/undefined) intervals show an em-dash', () => {
  assert.equal(formatInterval(0), '—');
  assert.equal(formatInterval(null), '—');
  assert.equal(formatInterval(undefined), '—');
});

test('formatInterval: under an hour is shown in minutes', () => {
  assert.equal(formatInterval(45), '45m');
  assert.equal(formatInterval(1), '1m');
});

test('formatInterval: under a day is shown in hours', () => {
  assert.equal(formatInterval(60), '1h');
  assert.equal(formatInterval(600), '10h');
});

test('formatInterval: a day or more is shown in days', () => {
  assert.equal(formatInterval(24 * 60), '1d');
  assert.equal(formatInterval(10 * 24 * 60), '10d');
});

test('formatRelative: null timestamp shows "—" for a future (due) date, "never" for a past one', () => {
  assert.equal(formatRelative(null, { future: true }), '—');
  assert.equal(formatRelative(null, { future: false }), 'never');
});

test('formatRelative: a future timestamp already in the past reads "due now"', () => {
  assert.equal(formatRelative(Date.now() - 1000, { future: true }), 'due now');
});

test('formatRelative: a past timestamp under a minute ago reads "just now"', () => {
  assert.equal(formatRelative(Date.now() - 500, { future: false }), 'just now');
});

test('formatRelative: minutes/hours/days scaling, future direction ("in Xm/h/d")', () => {
  assert.equal(formatRelative(Date.now() + 5 * 60_000, { future: true }), 'in 5m');
  assert.equal(formatRelative(Date.now() + 5 * 3_600_000, { future: true }), 'in 5h');
  assert.equal(formatRelative(Date.now() + 5 * 86_400_000, { future: true }), 'in 5d');
});

test('formatRelative: minutes/hours/days scaling, past direction ("Xm/h/d ago")', () => {
  assert.equal(formatRelative(Date.now() - 5 * 60_000, { future: false }), '5m ago');
  assert.equal(formatRelative(Date.now() - 5 * 3_600_000, { future: false }), '5h ago');
  assert.equal(formatRelative(Date.now() - 5 * 86_400_000, { future: false }), '5d ago');
});

test('formatAccuracy: null shows an em-dash, otherwise a rounded percentage', () => {
  assert.equal(formatAccuracy(null), '—');
  assert.equal(formatAccuracy(0.5), '50%');
  assert.equal(formatAccuracy(1), '100%');
  assert.equal(formatAccuracy(0.333), '33%');
});
