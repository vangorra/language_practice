// Shared by js/words.js (static entries) and js/dynamic-conjugator.js
// (runtime-generated entries) so both sides derive word ids the exact same
// way -- that's what lets a lazily-generated conjugation reattach to
// progress saved under the same id in an earlier session.

/** Deliberately keeps accented letters rather than stripping them down to
 * plain ASCII -- these ids are just internal object keys, never shown or
 * used as DOM/URL identifiers, and stripping accents would collide
 * distinct words that differ only by accent (e.g. the pronoun "you" vs.
 * the possessive "your"). */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}
