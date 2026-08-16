# Spanish Vocab Matcher

**Play it live: https://vangorra.github.io/language_practice/**

A matching game for building Spanish vocabulary. English words sit in the
left column, Spanish words in the right column; tap a word in each column
to try to pair them up. Correct pairs are replaced with new words drawn
from a spaced-repetition scheduler that prioritizes words you're
struggling with, trickles in new ones, and occasionally rechecks words
you already know well.

The deck (5,800+ static entries, before conjugations) isn't limited to
single words — it also includes hundreds of short common phrases ("where
is the bathroom?" → "¿dónde está el baño?"). On top of that, **every one
of the ~1,090 verbs in the deck gets all 5 simple indicative tense
conjugations (present, preterite, imperfect, future, conditional)
generated live**, the moment you first encounter that verb — not a
hand-picked subset of verbs or tenses. English cards that could be confused with
another sense of the same word — "to be" (ser vs. estar), "derecha"
(direction vs. political right-wing) — show a small subheading under the
main text for context.

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

On a phone, a match or mismatch also gives distinct haptic feedback — a
short tick for a correct match, a firmer double-buzz for a wrong one (see
`vibrateFor` in `js/main.js`) — via the Vibration API. Android Chrome/
Firefox support this; iOS Safari has never implemented the Vibration API
at all, so it's silently a no-op there rather than an error.

## Installing it as an app

This is an installable PWA: on Android Chrome, an "Install app" / "Add to
Home Screen" prompt shows up automatically (or is available from the
browser menu), and it launches full-screen with no browser chrome from
then on. On iOS Safari, use Share → Add to Home Screen — iOS doesn't use
the web manifest for this, so it relies on the `apple-touch-icon` and
`apple-mobile-web-app-*` meta tags in `index.html` instead. See `manifest.webmanifest`, `sw.js`, and the icons under `icons/` — the
icon files are copied into `dist/` as-is by `scripts/build.mjs`, but
`sw.js` gets a build id spliced into its cache name at build time (see
its own comment for why).

## Running it

This app has a real npm dependency (see "How conjugations work" below),
so it needs a build step — the days of "just open `index.html`" ended
once conjugation happens live instead of being pre-baked. Local dev:

```sh
npm install
npm run build      # bundles everything (including the conjugation
                    # engine) into dist/
npx serve dist      # or: python3 -m http.server 8000 --directory dist
```

Then visit the printed URL. Works well on a phone browser too — the
layout is responsive, long-press works with touch, matches/mismatches
vibrate, and it's installable (see "Installing it as an app" above).

**Live version**: https://vangorra.github.io/language_practice/ — pushes
to `main` build and deploy there automatically (see
`.github/workflows/deploy.yml`). If you fork this, GitHub Pages needs to
be turned on once, by a repo admin, at *Settings → Pages → Source:
GitHub Actions* — that one checkbox can't be flipped from a workflow
file or from here.

Progress is saved to **IndexedDB** in your browser (one record per word,
not one giant blob — see "Why IndexedDB" below), so it persists across
reloads but is local to that browser/device. Installing as an app doesn't
change this: it's still the same browser storage under the hood, just
launched without browser chrome.

## How conjugations work

Rather than hand-picking a few dozen verbs to pre-conjugate, every verb
infinitive in the deck (curated or imported, ~1,090 of them) can be
conjugated across all 5 simple indicative tenses the underlying engine
exposes — present, preterite, imperfect, future, and conditional — for
yo/tú/él-ella/nosotros/ellos. That uses
[@jirimracek/conjugate-esp](https://github.com/jirimracek/conjugate-esp)
(MIT), a real runtime dependency bundled into the app by `npm run build`
(`scripts/build.mjs`, via esbuild) — not something used once offline and
thrown away.

**Conjugating one verb takes a few milliseconds; conjugating all ~1,090
verbs up front would take several seconds and freeze the page on load**
(worse on a phone). So `js/game.js` does it lazily: the moment a verb
infinitive is picked into the practice pool, `js/dynamic-conjugator.js`
conjugates just that verb and adds its forms to the pool of candidate
cards. A returning session re-expands every verb you've already reviewed
before, so their conjugations (and your progress on them) are available
immediately rather than only after you happen to see that verb again.

**The tricky part** is identifying a conjugated form consistently enough
that your progress on it survives across sessions, without ever having
declared it anywhere in `words.js`. The answer is that it doesn't need
special handling: every word's id — static or dynamically generated — is
just `slugify(spanishText)` (see `js/slugify.js`). Conjugating "hablar"
tonight produces a card with es `"hablas"` and id `"hablas"`; conjugating
it again next week produces the exact same id, so IndexedDB's saved
progress for that id reattaches automatically. Nothing needs to track
*when* or *in which session* a word was generated.

The other real wrinkle is collisions, both systematic and incidental:
Spanish's imperfect *and* conditional tenses both spell "yo" and
"él/ella" identically for every verb (both end in an unstressed -a/-ía
with no person marker), and -ar/-ir verbs spell their preterite and
present "nosotros" forms identically — plus any two different verbs can
incidentally land on the same conjugated form. `dynamic-conjugator.js`
resolves all of
these the same way: a shared `usedIds` set seeded with every id already
in play, first writer wins, later duplicates for the same Spanish text
are silently skipped rather than producing two colliding or ambiguous
cards. See `tests/dynamic-conjugator.test.mjs`.

`scripts/validate_conjugations.mjs` independently checks specific
verb/tense/person combinations against the same engine — useful when
debugging a particular form, separate from the collision tests above.

## How the scheduling works

A correct match doesn't clear right away — it turns green and **locks**
(you can't select or deselect it anymore) while you keep playing, and
stays that way until a **second, different** pair is also confirmed —
then both clear and get replaced together. This is mostly about making
a lucky or brute-forced guess (or just spamming one pair you already
know) much less rewarding: a single correct click no longer gets
instant, full credit, and you can't just keep re-matching the same easy
pair for "wins" once it's locked — you have to move on to something
else. Any wrong attempts along the way still count toward that
appearance's miss total (see below) regardless.

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

## How leveling works

Every word (and every conjugated form) is tagged with a
[CEFR level](https://en.wikipedia.org/wiki/Common_European_Framework_of_Reference_for_Languages)
(A1 → C2) — the standard scale language courses and exams use to
describe "what stage this vocabulary/grammar belongs to." New words are
introduced lowest-level-first: the game won't hand you a B1 word while
there are still un-introduced A1 words around, the same way a real
course sequences its units.

**Assigning the level.** The canonical word-by-word CEFR inventory for
Spanish (Instituto Cervantes' *Plan Curricular*) is copyrighted reference
material, not something to embed here. Instead, `js/level.js` derives a
level from a word's position in the deck, using published
cumulative-vocabulary-size benchmarks per level (A1 ≈ 500 words, A2 ≈
900-1,000 cumulative, B1 ≈ 1,850-2,000 cumulative — B2/C1/C2 extrapolate
the same growth pattern past that). `js/words.js`'s `RAW_WORDS` is
hand-curated for common/basic coverage first (greetings, numbers,
pronouns, and core verbs all land in its early sections), so it
naturally fills out the lower levels; the frequency-ranked
`RAW_IMPORTED_WORDS` continues the same ladder afterward. This is an
*approximation* — good enough to sequence a learning game, not a
substitute for a certified curriculum — and any entry can still set its
own `level` explicitly to override the computed default.

**Leveling grammar, not just vocabulary.** A conjugated form's level is
the *more advanced* of its verb's own level and its tense's level (see
`js/dynamic-conjugator.js`) — present tense floors at A1, preterite at
A2, imperfect/future at B1, conditional at B2, matching the order Spanish
courses typically introduce these. So even a common A1 verb's
*conditional* form is still gated at B2: knowing an infinitive doesn't
mean every one of its conjugations is introduced at once.

**Soft, not hard, gating.** This only affects which *new* word gets
introduced next (see `pickNextWord` in `js/srs.js`) — it never blocks
reviewing an already-active or due word regardless of level, and once a
level's new words run out, the next level opens up automatically. The
Practice tab shows a small progress indicator for the current level
(`game.js`'s `getLevelProgress()`), and the Word List table has a Level
column and filter alongside the existing Tier one.

## Why IndexedDB

The word list runs into the thousands (more once conjugations are
generated), and every match only ever changes one word's state.
Re-serializing and rewriting a single giant `localStorage` blob (as an
earlier version of this app did) on every match doesn't scale well,
especially on a phone. IndexedDB stores one record per word, so a write
only ever touches the row that actually changed, and the Word List table
only ever renders the current page (50 rows) rather than the whole deck
— sorting/filtering thousands of rows and re-rendering a page is
comfortably sub-150ms even at this scale. If IndexedDB isn't available
at all, the app falls back to an in-memory store so it still runs for
the session, just without persistence.

## Project layout

```
index.html               Page shell / layout (Practice / Word List / Stats tabs)
styles.css                All styling
manifest.webmanifest      PWA manifest (installable "Add to Home Screen")
sw.js                     App-shell service worker (see "Installing it as an app")
icons/                    App icons (any + maskable + Apple touch icon)
js/words.js               Hand-curated word/phrase entries (merges in words-imported.js)
js/words-imported.js      Auto-generated frequency-sourced vocabulary (see scripts/import_vocab.py)
js/slugify.js             Shared id-from-Spanish-text scheme (static AND dynamic entries)
js/dynamic-conjugator.js  Generates verb conjugations at runtime (see "How conjugations work")
js/srs.js                 Pure scheduling logic (SM-2 variant, "mark known", pool selection)
js/level.js               Pure CEFR level helpers (see "How leveling works")
js/history.js             Pure streak/chart-data helpers over the daily review log
js/format.js              Pure display-formatting helpers for the Word List table
js/db.js                  IndexedDB persistence (per-word states + daily history)
js/game.js                Game state machine (pool, selection, match handling, verb expansion)
js/main.js                DOM wiring / rendering (tabs, table, chart, long-press menu)
scripts/build.mjs                  esbuild bundling -> dist/ (see "Running it")
scripts/import_vocab.py            ETL: frequency data + Wiktionary glosses -> words-imported.js
scripts/validate_conjugations.mjs  Spot-checks a verb/tense/person against the conjugation engine
tests/srs.test.mjs                 Unit tests for the scheduler
tests/level.test.mjs               Unit tests for the CEFR level helpers
tests/history.test.mjs             Unit tests for streak/chart-data helpers
tests/dynamic-conjugator.test.mjs  Unit tests for runtime conjugation + collision handling
tests/format.test.mjs              Unit tests for the Word List's display-formatting helpers
tests/slugify.test.mjs             Unit tests for the shared id-from-Spanish-text scheme
tests/words.test.mjs               Unit tests for the vocabulary list's shape + duplicate-id check
tests/db.test.mjs                  Unit tests for IndexedDB persistence (incl. in-memory fallback)
tests/game.test.mjs                Unit tests for the game state machine
tests/main.test.mjs                DOM-driven integration tests for main.js (via jsdom)
.c8rc.json                         Coverage tool config + enforced thresholds (see "Tests")
.github/workflows/deploy.yml       Build + deploy dist/ to GitHub Pages on push
```

## Tests

```sh
npm test              # run the full suite
npm run test:coverage # run it with coverage, enforcing the thresholds below
```

`npm test` runs `node --test` over every file in `tests/` (no build
needed — these import the source files directly, and
`@jirimracek/conjugate-esp` resolves fine under plain Node since it's a
real `node_modules` dependency). `tests/db.test.mjs` and
`tests/game.test.mjs` use `fake-indexeddb` to exercise real IndexedDB
semantics without a browser; `tests/main.test.mjs` uses `jsdom` to drive
the actual `index.html` DOM.

`npm run test:coverage` wraps the same run in [c8](https://github.com/bcoe/c8)
and enforces a **98% minimum across branches, lines, statements, and
functions** (see `.c8rc.json`) — CI runs this, not plain `npm test`, so a
coverage regression fails the build. `js/words-imported.js` (auto-generated
data, no logic of its own) is excluded from the count; everything else
under `js/` is measured. A handful of individual branches are annotated
`/* c8 ignore */` with a comment explaining why — each one is either
provably unreachable (e.g. a code path only possible once the *entire*
~29,000-entry deck, including every verb conjugation, is simultaneously
active) or a defensive guard against an invariant nothing in the codebase
can currently violate.

## Credits

The hand-curated vocabulary and this app's code are original to this
project. Two pieces of content lean on open third-party sources rather
than being typed by hand, specifically because hand-typing them at this
scale carries real risk of typos/errors:

- **~3,900 vocabulary entries** in `js/words-imported.js` come from
  [doozan/spanish_data](https://github.com/doozan/spanish_data)
  (CC-BY-SA), a frequency-ranked Spanish word list combined with English
  glosses. That project itself combines:
  - [Wiktionary](https://en.wiktionary.org) (CC-BY-SA) — the English
    glosses for each Spanish word
  - [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords)
    (MIT) — the underlying word-frequency ranking, derived from
    OpenSubtitles

  See `scripts/import_vocab.py` for exactly how words were selected and
  cleaned (frequency rank, deduped against the hand-curated deck —
  including article-stripped and English-gloss dedup, so an imported
  bare "pollo" doesn't double up against a hand-curated "el pollo" — with
  archaic/regional/vulgar/dated senses filtered out).

- **Every verb conjugation** is generated at runtime by
  [@jirimracek/conjugate-esp](https://github.com/jirimracek/conjugate-esp)
  (MIT), a real bundled dependency — see "How conjugations work" above.

Per CC-BY-SA, any redistribution of `js/words-imported.js` (or a
derivative of it) should carry forward this same attribution.

## Extending

- **Add words or phrases**: append entries to `RAW_WORDS` in
  `js/words.js`. Each entry needs `en`, `es`, and `category`; `context`
  is an optional subheading shown under the English card only (use it to
  disambiguate a word with more than one sense); `type`
  (`'word' | 'phrase'`) is purely informational. Keep every `es` value
  unique across the whole list — a word's id is derived from it (see
  `js/slugify.js`), and the module throws at load time if two entries
  collide, which is usually a sign the two senses should be merged into
  one entry with a "sense A / sense B" label and a clarifying `context`
  (there are plenty of examples of this in the file — Spanish has a lot
  of genuine homographs). `en` values *can* repeat as long as the
  entries have different `context` (e.g. "to be" / ser vs. "to be" /
  estar). **A verb infinitive's `en` must start with "to "** — the
  dynamic conjugator strips that prefix to build every person's gloss.
- **Import more frequency-ranked vocabulary**: re-run
  `scripts/import_vocab.py --target N` (see its docstring for the fetch
  commands) to pull more words than are currently in
  `js/words-imported.js` — it automatically skips anything already in
  the deck, hand-curated or previously imported.
- **Add more tenses/persons to conjugations**: edit the `TENSES`
  array and the person-index maps in `js/dynamic-conjugator.js`. No
  static data to regenerate — it applies to every verb in the deck
  immediately.
- **Tune the scheduler**: `js/srs.js` exposes the learning-step lengths,
  ease-factor bounds, mastery threshold, manual-known interval, and the
  pool-selection weights (new-word cap, new-word chance, mastery-check
  chance) as named constants/options.
- **Change pool size**: the "Cards on screen" control in the footer
  adjusts it live; the default is 6 pairs.
- **Tune the Word List table**: page size, default sort, and filters live
  as constants/state at the top of the "Word List tab" section of
  `js/main.js`.
