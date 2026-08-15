import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from '../js/slugify.js';

test('lowercases and joins words with hyphens', () => {
  assert.equal(slugify('Hola Mundo'), 'hola-mundo');
});

test('keeps accented letters rather than stripping them', () => {
  assert.equal(slugify('¿Cómo estás?'), 'cómo-estás');
});

test('trims leading and trailing punctuation instead of leaving dangling hyphens', () => {
  assert.equal(slugify('¡hola!'), 'hola');
  assert.equal(slugify('...leading and trailing...'), 'leading-and-trailing');
});

test('collapses runs of non-alphanumeric characters into a single hyphen', () => {
  assert.equal(slugify('a,  b -- c'), 'a-b-c');
});
