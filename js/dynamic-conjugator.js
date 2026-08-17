// Generates verb-conjugation word entries at runtime, using
// @jirimracek/conjugate-esp (MIT) -- a real runtime dependency, bundled by
// the build step (see scripts/build.mjs) -- rather than a hand-picked,
// pre-baked list. This is deliberately lazy/per-verb (see expandVerb()):
// conjugating a verb takes a few milliseconds, but conjugating all ~1,000
// verb infinitives in the deck up front takes several *seconds*, which
// would freeze the UI on page load (worse on a phone). Conjugating one
// verb the moment it's actually encountered keeps that cost imperceptible
// and spread out over normal play instead.
//
// Word ids are derived from Spanish text the same way as every other word
// (see slugify.js) -- that's what lets a conjugation generated in one
// session reattach to progress saved under that same id in an earlier
// session, even though nothing about *when* it was generated is recorded
// anywhere. See js/game.js's `expandVerb` for how this hooks into the pool.

import { Conjugator } from '@jirimracek/conjugate-esp';
import { slugify } from './slugify.js';
import { maxLevel } from './level.js';

const PERSON_INDEX = { yo: 0, 'tú': 1, 'él/ella': 2, nosotros: 3, ellos: 5 };

// [conjugator tense key, mood, our tense label, CEFR level] -- all 5 simple
// indicative tenses the engine exposes (IndicativoSubSimpleKey in its
// types), not a hand-picked subset. Levels follow the order Spanish
// courses typically introduce these tenses in (present first, preterite
// once past tense begins, imperfect/future/conditional as grammar gets
// more advanced) -- a conjugated card's own level is the max of this and
// its verb's level (see expandVerb), so e.g. a common A1 verb's
// *conditional* form is still gated at B1/B2.
const TENSES = [
  ['Presente', 'Indicativo', 'present tense', 'A1'],
  ['PreteritoIndefinido', 'Indicativo', 'preterite (past)', 'A2'],
  ['PreteritoImperfecto', 'Indicativo', 'imperfect (past)', 'B1'],
  ['FuturoImperfecto', 'Indicativo', 'future', 'B1'],
  ['CondicionalSimple', 'Indicativo', 'conditional', 'B2'],
];

// Spanish tenses whose yo and él/ella forms are always spelled identically
// (both end in unstressed -a/-ía with no person marker) -- imperfect and
// conditional. Handled by merging those two persons into one explicitly
// labeled card instead of generating two that would collide on id anyway.
const YO_ELLA_MERGED_TENSES = new Set(['PreteritoImperfecto', 'CondicionalSimple']);

// English present-tense 3rd-person-singular is irregular for a handful of
// very common verbs; everything else follows the regular spelling rules
// below.
const THIRD_PERSON_OVERRIDES = { be: 'is', have: 'has', go: 'goes', do: 'does' };

function thirdPersonSingular(bareFirstWord) {
  const lower = bareFirstWord.toLowerCase();
  if (THIRD_PERSON_OVERRIDES[lower]) return THIRD_PERSON_OVERRIDES[lower];
  if (/[sxz]$|[cs]h$/i.test(bareFirstWord)) return bareFirstWord + 'es';
  if (/[^aeiou]y$/i.test(bareFirstWord)) return bareFirstWord.slice(0, -1) + 'ies';
  return bareFirstWord + 's';
}

/**
 * Build an English gloss for one person of one tense, from the verb's own
 * dictionary infinitive gloss (e.g. "to speak", "to be able to", "to look
 * at"). Preterite uses "did VERB" and imperfect uses "used to VERB" --
 * both sidestep needing an irregular-English-past-tense table, which
 * isn't feasible to hand-maintain for hundreds of verbs; present tense
 * still reads naturally since only 3rd-person needs any inflection at all.
 */
function englishGloss(infinitiveGloss, person, tenseKey) {
  const bare = infinitiveGloss.replace(/^to\s+/i, '').trim();
  const [firstWord, ...rest] = bare.split(' ');
  const restStr = rest.length ? ` ${rest.join(' ')}` : '';

  if (tenseKey === 'Presente') {
    if (person === 'él/ella') return `he/she ${thirdPersonSingular(firstWord)}${restStr}`;
    const subject = { yo: 'I', 'tú': 'you', nosotros: 'we', ellos: 'they' }[person];
    return `${subject} ${bare}`;
  }
  if (tenseKey === 'PreteritoIndefinido') {
    const subject = { yo: 'I', 'tú': 'you', 'él/ella': 'he/she', nosotros: 'we', ellos: 'they' }[person];
    return `${subject} did ${bare}`;
  }
  if (tenseKey === 'FuturoImperfecto') {
    const subject = { yo: 'I', 'tú': 'you', 'él/ella': 'he/she', nosotros: 'we', ellos: 'they' }[person];
    return `${subject} will ${bare}`;
  }
  // Imperfect and conditional: yo and él/ella are always spelled identically
  // in Spanish (see YO_ELLA_MERGED_TENSES / the merged 'yo / él/ella' person
  // below), so the English gloss covers both explicitly.
  if (person === 'yo / él/ella') {
    return tenseKey === 'CondicionalSimple' ? `I/he/she would ${bare}` : `I/he/she used to ${bare}`;
  }
  const subject = { 'tú': 'you', nosotros: 'we', ellos: 'they' }[person];
  return tenseKey === 'CondicionalSimple' ? `${subject} would ${bare}` : `${subject} used to ${bare}`;
}

/**
 * @param {Set<string>} usedIds - mutated in place as entries are accepted;
 *   seed with every id already in play (static words + anything already
 *   generated) so collisions -- both the couple of systematic Spanish
 *   grammar overlaps (imperfect yo==él/ella for every verb; -ar/-ir
 *   preterite nosotros==present nosotros) and any incidental cross-verb
 *   homograph -- are resolved the same way: first writer wins, later
 *   duplicates are silently skipped rather than producing two colliding
 *   or ambiguous cards.
 */
export function createConjugationExpander(usedIds) {
  const conjugator = new Conjugator();

  /** @returns {object[]} newly-created conjugation entries for this verb (already merged into usedIds) */
  function expandVerb(verbWord) {
    let result;
    try {
      result = conjugator.conjugateSync(verbWord.es);
    } catch {
      return [];
    }
    if (!Array.isArray(result) || result.length === 0) return [];
    const entry = result.find((r) => !r.info.defective) || result[0];

    const infinitiveGloss = verbWord.en;
    const created = [];

    for (const [tenseKey, mood, tenseLabel, tenseLevel] of TENSES) {
      const forms = entry.conjugation?.[mood]?.[tenseKey];
      if (!forms || forms.length < 6) continue;

      const persons = YO_ELLA_MERGED_TENSES.has(tenseKey)
        ? [['yo / él/ella', 0], ['tú', 1], ['nosotros', 3], ['ellos', 5]]
        : [['yo', PERSON_INDEX.yo], ['tú', PERSON_INDEX['tú']], ['él/ella', PERSON_INDEX['él/ella']], ['nosotros', PERSON_INDEX.nosotros], ['ellos', PERSON_INDEX.ellos]];

      for (const [person, idx] of persons) {
        const es = forms[idx];
        if (!es) continue;
        const id = slugify(es);
        if (usedIds.has(id)) continue;
        usedIds.add(id);

        created.push({
          id,
          en: englishGloss(infinitiveGloss, person, tenseKey),
          es,
          category: 'verbs',
          type: 'conjugation',
          level: maxLevel(verbWord.level, tenseLevel),
          context: `${verbWord.es} (${infinitiveGloss}) · ${person} · ${tenseLabel}`,
        });
      }
    }

    return created;
  }

  return { expandVerb };
}
