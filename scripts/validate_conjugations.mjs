#!/usr/bin/env node
// Validates every conjugation entry in js/words.js against an independent,
// MIT-licensed Spanish conjugation engine (@jirimracek/conjugate-esp), so
// the Spanish side of every conjugation card is checked by something other
// than "I typed it carefully."
//
// Not a runtime dependency of the app -- install it just to run this:
//   npm install @jirimracek/conjugate-esp
//   node scripts/validate_conjugations.mjs
//
// Exits non-zero (and prints every mismatch) if anything doesn't match.

import { Conjugator } from '@jirimracek/conjugate-esp';
import { WORDS } from '../js/words.js';

const c = new Conjugator();
const PERSON_IDX = { yo: 0, 'tú': 1, 'él/ella': 2, nosotros: 3, ellos: 5, 'yo / él/ella': 0 };
const TENSE_MAP = {
  'present tense': ['Indicativo', 'Presente'],
  'preterite (past)': ['Indicativo', 'PreteritoIndefinido'],
  'imperfect (past)': ['Indicativo', 'PreteritoImperfecto'],
};

// Every infinitive currently used by a conjugationSet(...) call in words.js.
// Update this list when adding conjugations for a new verb.
const KNOWN_VERBS = [
  'ser', 'estar', 'tener', 'hablar', 'comer', 'ir', 'querer', 'poder', 'hacer',
  'decir', 'poner', 'salir', 'venir', 'dar', 'ver', 'saber', 'vivir', 'pensar',
  'creer', 'deber', 'dejar', 'pasar', 'sentir', 'esperar', 'encontrar', 'volver',
  'llamar', 'parecer', 'tomar', 'llegar', 'seguir', 'conocer', 'buscar', 'perder',
  'entender', 'trabajar', 'empezar', 'traer', 'cambiar', 'jugar', 'leer', 'dormir',
  'llevar',
];

function extractVerb(label) {
  for (const v of [...KNOWN_VERBS].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${v}\\b`).test(label)) return v;
  }
  return null;
}

const conjugations = WORDS.filter((w) => w.type === 'conjugation');
let checked = 0;
let mismatches = 0;
const cache = new Map();

for (const w of conjugations) {
  const parts = w.context.split(' · ');
  const tenseKey = parts[parts.length - 1];
  const person = parts[parts.length - 2];
  const label = parts.slice(0, parts.length - 2).join(' · ');
  const [mood, tense] = TENSE_MAP[tenseKey] || [];
  if (!mood) {
    console.log('UNKNOWN TENSE:', w.context);
    continue;
  }

  const verb = extractVerb(label);
  if (!verb) {
    console.log('COULD NOT EXTRACT VERB from label:', label);
    continue;
  }

  if (!cache.has(verb)) {
    try {
      cache.set(verb, c.conjugateSync(verb));
    } catch (err) {
      console.log('CONJUGATE ERROR for', verb, err.message);
      continue;
    }
  }
  const result = cache.get(verb);
  if (!Array.isArray(result) || result.length === 0) {
    console.log('BAD RESULT for', verb);
    continue;
  }
  const entry = result.find((r) => !r.info.defective) || result[0];
  const forms = entry?.conjugation?.[mood]?.[tense];
  if (!forms) {
    console.log('NO FORMS for', verb, mood, tense);
    continue;
  }

  const idx = PERSON_IDX[person];
  if (idx === undefined) {
    console.log('UNKNOWN PERSON:', person);
    continue;
  }
  const expected = forms[idx];
  checked++;
  if (expected !== w.es) {
    mismatches++;
    console.log(
      `MISMATCH: verb=${verb} tense=${tenseKey} person=${person} | ours="${w.es}" vs library="${expected}" | en="${w.en}"`
    );
  }
}

console.log(`checked: ${checked} | mismatches: ${mismatches}`);
process.exit(mismatches > 0 ? 1 : 0);
