# Spanish Vocab Matcher

A small, dependency-free matching game for building Spanish vocabulary.
English words sit in the left column, Spanish words in the right column;
click a word in each column to try to pair them up. Correct pairs are
replaced with new words drawn from a spaced-repetition scheduler that
prioritizes words you're struggling with, trickles in new ones, and
occasionally rechecks words you already know well.

The deck isn't limited to single words — it also includes short common
phrases ("where is the bathroom?" → "¿dónde está el baño?") and present-tense
verb conjugations, where the Spanish card shows the actual conjugated form
(e.g. "hablas") rather than just the infinitive. English cards that could be
confused with another sense of the same word — "to be" (ser vs. estar), or a
conjugation's verb/person — show a small subheading under the main text for
context.

## Running it

No build step, no dependencies. Either:

- Open `index.html` directly in a browser, or
- Serve the folder so ES module imports resolve over `http://` (some
  browsers block `file://` module imports):

  ```sh
  npx serve .
  # or
  python3 -m http.server 8000
  ```

Then visit the printed URL.

Progress is saved to `localStorage` in your browser, so it persists
across reloads but is local to that browser/device.

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
- Whichever due word is most overdue is weighted highest when the game
  picks what fills an emptied slot.

Word tiers (New → Learning → Familiar → Mastered), shown in the stats
bar, are just a display bucketing of each word's current interval —
there's no separate scoring system underneath.

## Project layout

```
index.html         Page shell / layout
styles.css          All styling
js/words.js         Starter word list (English/Spanish pairs + category)
js/srs.js           Pure scheduling logic (SM-2 variant + pool selection)
js/storage.js       localStorage read/write helpers
js/game.js          Game state machine (pool, selection, match handling)
js/main.js          DOM wiring / rendering
tests/srs.test.mjs  Unit tests for the scheduler (Node's built-in test runner)
```

## Tests

The scheduling logic is pure and unit-tested with Node's built-in test
runner (no dependencies to install):

```sh
node --test tests/
```

## Extending

- **Add words, phrases, or conjugations**: append entries to `RAW_WORDS`
  in `js/words.js`. Each entry needs `en`, `es`, and `category`; `context`
  is an optional subheading shown under the English card only (use it to
  disambiguate a word with more than one sense, or to tag a conjugation's
  verb/person), and `type` (`'word' | 'phrase' | 'conjugation'`) is purely
  informational. Keep every `es` value unique across the whole list — a
  word's id is derived from it. `en` values *can* repeat as long as the
  entries have different `context`, since that's what lets a player tell
  them apart if both land in the pool at once (e.g. "to be" / ser vs.
  "to be" / estar). The `conjugationSet(...)` helper builds a full set of
  present-tense person entries for one verb in a few lines — see the
  "Verb conjugations" section for examples.
- **Tune the scheduler**: `js/srs.js` exposes the learning-step lengths,
  ease-factor bounds, mastery threshold, and the pool-selection weights
  (new-word cap, new-word chance, mastery-check chance) as named
  constants/options.
- **Change pool size**: the "Cards on screen" control in the footer
  adjusts it live; the default is 6 pairs.
