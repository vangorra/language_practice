# Spanish Vocab Matcher

A small, dependency-free matching game for building Spanish vocabulary.
English words sit in the left column, Spanish words in the right column;
tap a word in each column to try to pair them up. Correct pairs are
replaced with new words drawn from a spaced-repetition scheduler that
prioritizes words you're struggling with, trickles in new ones, and
occasionally rechecks words you already know well.

The deck (3,100+ entries) isn't limited to single words — it also
includes hundreds of short common phrases ("where is the bathroom?" →
"¿dónde está el baño?") and verb conjugations (present tense for ~43
verbs, preterite for ~15, imperfect for 8), where the Spanish card shows
the actual conjugated form (e.g. "hablas") rather than just the
infinitive. English cards that could be confused with another sense of
the same word — "to be" (ser vs. estar), "derecha" (direction vs.
political right-wing), a conjugation's verb/person — show a small
subheading under the main text for context.

About 900 of the non-verb entries were imported from a real
frequency-ranked Spanish corpus + Wiktionary rather than hand-typed (see
"Credits" below) — hand-authoring thousands of word pairs by hand risks
typos and isn't how you'd want a reference vocabulary built anyway. The
verb conjugations are generated and cross-checked against an independent
open-source conjugation engine rather than typed from memory, for the
same reason.

Three tabs:

- **Practice** — the matching board itself.
- **Word List** — every word you've encountered (or the whole deck, via
  a toggle), as a sortable/filterable/paginated table with per-word
  stats, plus a quick "mark known" / "reset" action per row.
- **Stats** — your day streak, longest streak, a 30-day bar chart of
  reviews, and overall totals/accuracy.

Press and hold any card to open a small menu for marking that word
"already known" (jumps it straight to mastered-scale spacing, skipping
the usual ramp-up — handy for words you already know from elsewhere) or
resetting it back to fresh/new.

## Running it

No build step, no npm dependencies. Either:

- Open `index.html` directly in a browser, or
- Serve the folder so ES module imports resolve over `http://` (some
  browsers block `file://` module imports):

  ```sh
  npx serve .
  # or
  python3 -m http.server 8000
  ```

Then visit the printed URL. Works well on a phone browser too — the
layout is responsive, and long-press works with touch.

Progress is saved to **IndexedDB** in your browser (one record per word,
not one giant blob — see "Why IndexedDB" below), so it persists across
reloads but is local to that browser/device.

## How the scheduling works

Each word tracks a small SM-2-style state: an ease factor, a review
interval, and a due date. It's the same family of algorithm apps like
Anki use, adapted so a "review" happens automatically whenever the word
gets matched in a round — no separate self-rating step:

- **New words** graduate through two quick learning steps (1 minute,
  then 10 minutes) before joining the day-scale review schedule. Only a
  couple of never-seen words are ever in the active pool at once, so
  learning stays gradual.
- **Struggling words** (mismatched a few times before finally matching)
  get demoted to a short interval, so they resurface again soon.
- **Words you know well** get longer and longer intervals between
  appearances, but never fully disappear — a small chance of an early
  "mastery check" keeps well-known words from silently going stale.
- **Words you mark "known"** via the card long-press jump straight to a
  long, mastered-scale interval instead of going through the normal
  ramp-up — for vocabulary you already know from elsewhere and don't
  want to re-earn from scratch.
- Whichever due word is most overdue is weighted highest when the game
  picks what fills an emptied slot.

Word tiers (New → Learning → Familiar → Mastered), shown in the stats
bar and the Word List table, are a display bucketing of each word's
current interval (or the manual "known" override) — there's no separate
scoring system underneath.

## Why IndexedDB

The word list is meant to grow into the thousands, and every match only
ever changes one word's state. Re-serializing and rewriting a single
giant `localStorage` blob (as an earlier version of this app did) on
every match doesn't scale well, especially on a phone. IndexedDB stores
one record per word, so a write only ever touches the row that actually
changed, and the Word List table only ever renders the current page (50
rows) rather than the whole deck — sorting/filtering a couple thousand
rows and re-rendering a page is comfortably sub-150ms even for a large
deck. If IndexedDB isn't available at all, the app falls back to an
in-memory store so it still runs for the session, just without
persistence.

## Project layout

```
index.html          Page shell / layout (Practice / Word List / Stats tabs)
styles.css           All styling
js/words.js          Hand-curated word/phrase/conjugation entries (merges in words-imported.js)
js/words-imported.js Auto-generated frequency-sourced vocabulary (see scripts/import_vocab.py)
js/srs.js            Pure scheduling logic (SM-2 variant, "mark known", pool selection)
js/history.js        Pure streak/chart-data helpers over the daily review log
js/db.js             IndexedDB persistence (per-word states + daily history)
js/game.js           Game state machine (pool, selection, match handling, history recording)
js/main.js           DOM wiring / rendering (tabs, table, chart, long-press menu)
tests/srs.test.mjs   Unit tests for the scheduler
tests/history.test.mjs  Unit tests for streak/chart-data helpers
scripts/import_vocab.py         ETL: frequency data + Wiktionary glosses -> words-imported.js
scripts/validate_conjugations.mjs  Checks every conjugation card against an independent engine
```

## Tests

The scheduling and history logic is pure and unit-tested with Node's
built-in test runner (no dependencies to install):

```sh
node --test tests/srs.test.mjs tests/history.test.mjs
```

(Running `node --test tests/` as a bare directory can hit an unrelated
module-resolution quirk in some Node versions — pointing at the files
directly, as above, always works.)

Every conjugation card's Spanish form is also cross-checked against an
independent conjugation engine (see "Credits"):

```sh
npm install @jirimracek/conjugate-esp   # one-off, not a runtime dependency
node scripts/validate_conjugations.mjs
```

## Credits

The hand-curated vocabulary and this app's code are original to this
project. Two pieces of content were generated from open third-party
sources rather than typed by hand, specifically because hand-typing them
carries real risk of typos/errors at this scale:

- **~900 vocabulary entries** in `js/words-imported.js` come from
  [doozan/spanish_data](https://github.com/doozan/spanish_data)
  (CC-BY-SA), a frequency-ranked Spanish word list combined with English
  glosses. That project itself combines:
  - [Wiktionary](https://en.wiktionary.org) (CC-BY-SA) — the English
    glosses for each Spanish word
  - [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
    (MIT) — the underlying word-frequency ranking, derived from
    OpenSubtitles

  See `scripts/import_vocab.py` for exactly how words were selected and
  cleaned (frequency rank, deduped against the hand-curated deck, with
  archaic/regional/vulgar senses filtered out).

- **Conjugated verb forms** (313 cards across present, preterite, and
  imperfect tense) are generated and/or cross-checked with
  [@jirimracek/conjugate-esp](https://github.com/jirimracek/conjugate-esp)
  (MIT), an independent Spanish conjugation engine — see
  `scripts/validate_conjugations.mjs`.

Neither of these is a runtime dependency of the app itself — they were
used offline to generate/verify static data now committed as plain JS,
so the app you actually run stays dependency-free. Per CC-BY-SA, any
redistribution of `js/words-imported.js` (or a derivative of it) should
carry forward this same attribution.

## Extending

- **Add words, phrases, or conjugations**: append entries to `RAW_WORDS`
  in `js/words.js`. Each entry needs `en`, `es`, and `category`; `context`
  is an optional subheading shown under the English card only (use it to
  disambiguate a word with more than one sense, or to tag a conjugation's
  verb/person), and `type` (`'word' | 'phrase' | 'conjugation'`) is purely
  informational. Keep every `es` value unique across the whole list — a
  word's id is derived from it, and the module throws at load time if two
  entries collide, which is usually a sign the two senses should be
  merged into one entry with a "sense A / sense B" label and a
  clarifying `context` (there are plenty of examples of this in the file
  — Spanish has a lot of genuine homographs). `en` values *can* repeat as
  long as the entries have different `context`, since that's what lets a
  player tell them apart if both land in the pool at once (e.g. "to be"
  / ser vs. "to be" / estar). The `conjugationSet(contextLabel, forms,
  tense?)` helper builds a full set of per-person entries for one verb in
  a few lines — see the "Verb conjugations" and "Preterite" sections for
  examples of present and past tense. When adding a new verb's
  conjugations, get the Spanish forms from `conjugate-esp` (see
  "Credits") rather than typing them from memory, and add the verb to
  `KNOWN_VERBS` in `scripts/validate_conjugations.mjs` so it stays
  covered by the validation script.
- **Import more frequency-ranked vocabulary**: re-run
  `scripts/import_vocab.py --target N` (see its docstring for the fetch
  commands) to pull more words than are currently in
  `js/words-imported.js` — it automatically skips anything already in
  the deck, hand-curated or previously imported.
- **Tune the scheduler**: `js/srs.js` exposes the learning-step lengths,
  ease-factor bounds, mastery threshold, manual-known interval, and the
  pool-selection weights (new-word cap, new-word chance, mastery-check
  chance) as named constants/options.
- **Change pool size**: the "Cards on screen" control in the footer
  adjusts it live; the default is 6 pairs.
- **Tune the Word List table**: page size, default sort, and filters live
  as constants/state at the top of the "Word List tab" section of
  `js/main.js`.
