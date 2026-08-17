import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, levelForPosition, levelRank, maxLevel } from '../js/level.js';

test('LEVELS is the CEFR scale in ascending order', () => {
  assert.deepEqual(LEVELS, ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
});

test('levelForPosition returns each level in order as position increases', () => {
  assert.equal(levelForPosition(0), 'A1');
  assert.equal(levelForPosition(499), 'A1');
  assert.equal(levelForPosition(500), 'A2');
  assert.equal(levelForPosition(999), 'A2');
  assert.equal(levelForPosition(1000), 'B1');
  assert.equal(levelForPosition(1999), 'B1');
  assert.equal(levelForPosition(2000), 'B2');
  assert.equal(levelForPosition(3499), 'B2');
  assert.equal(levelForPosition(3500), 'C1');
  assert.equal(levelForPosition(4999), 'C1');
  assert.equal(levelForPosition(5000), 'C2');
  assert.equal(levelForPosition(1_000_000), 'C2', 'the deck can grow arbitrarily large and still resolves to the top level');
});

test('levelRank orders levels from most beginner (0) to most advanced', () => {
  assert.equal(levelRank('A1'), 0);
  assert.equal(levelRank('C2'), 5);
  assert.ok(levelRank('B1') < levelRank('B2'));
});

test('maxLevel returns whichever of the two levels is more advanced', () => {
  assert.equal(maxLevel('A1', 'B2'), 'B2');
  assert.equal(maxLevel('B2', 'A1'), 'B2');
  assert.equal(maxLevel('A1', 'A1'), 'A1');
});
