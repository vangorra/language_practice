import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import * as db from '../js/db.js';
import { WORDS } from '../js/words.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(path.join(__dirname, '../index.html'), 'utf8');

const MATCH_FLASH_MS = 350;
const REMOVE_FADE_MS = 220;
const ENTER_FADE_MS = 250;
const FULL_CYCLE_MS = MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS + 30; // small buffer

test.beforeEach(async () => {
  await db.clearWordStates();
  await db.clearHistory();
});

let instanceCounter = 0;

/**
 * Sets up a fresh jsdom document (the real index.html) as the global DOM,
 * then imports a cache-busted instance of main.js against it -- main.js
 * captures its element references and calls main() as side effects of
 * being imported, so both a fresh DOM *and* a fresh module instance are
 * needed per test.
 */
/** globalThis.navigator is a built-in getter-only accessor in modern Node, so a plain assignment throws -- defineProperty overrides it instead. */
function setGlobal(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

async function setupMain({ confirmReturns = true, serviceWorker = null, withVibrate = false } = {}) {
  const dom = new JSDOM(HTML, { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;
  setGlobal('window', window);
  setGlobal('document', window.document);
  setGlobal('navigator', window.navigator);
  setGlobal('requestAnimationFrame', window.requestAnimationFrame.bind(window));
  window.confirm = () => confirmReturns;
  if (withVibrate) window.navigator.vibrate = () => {};
  if (serviceWorker) window.navigator.serviceWorker = serviceWorker;

  await import(`../js/main.js?instance=${instanceCounter++}`);
  await waitForBoardRender();
  return window;
}

async function waitForBoardRender() {
  // Polls via setImmediate rather than setTimeout: a couple of tests mock
  // *just* setTimeout (see MATCH_FLASH_MS/etc.) to drive game.js's match
  // animation phases deterministically, and this helper still needs to
  // resolve for real (waiting on createGame's IndexedDB hydration) even
  // while that mock is active.
  for (let i = 0; i < 200; i++) {
    if (document.getElementById('en-column').children.length > 0) return;
    await new Promise((r) => setImmediate(r));
  }
  throw new Error('main.js never rendered the practice board in time');
}

async function flush(ms = 10) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Reads an en-column button's underlying word from the static WORDS list, via its rendered text. */
function wordForEnButton(btn) {
  const text = btn.querySelector('.card-main').textContent;
  const context = btn.querySelector('.card-context')?.textContent;
  return WORDS.find((w) => w.en === text && (context ? w.context === context : !w.context));
}

/** Finds the es-column button whose text matches the given word's `es` field. */
function esButtonFor(word) {
  return [...document.getElementById('es-column').children].find(
    (btn) => btn.querySelector('.card-main').textContent === word.es
  );
}

function firePointer(el, type, opts = {}) {
  el.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', ...opts }));
}

// ---------------------------------------------------------------------------
// Initial render / practice board
// ---------------------------------------------------------------------------

test('renders the practice board with the default pool size and a populated stats bar', async () => {
  await setupMain();
  assert.equal(document.getElementById('en-column').children.length, 6);
  assert.equal(document.getElementById('es-column').children.length, 6);
  // 4 tier chips + a total chip.
  assert.equal(document.getElementById('stats').children.length, 5);
  assert.match(document.getElementById('stats').textContent, /Total: \d+/);
});

test('a long piece of text gets the long-text class', async () => {
  await setupMain();
  // Only ~0.3% of the vocabulary is long enough to trigger this, so a
  // single small random pool isn't a reliable way to hit it -- grow the
  // pool and re-roll it a handful of times instead, deterministically
  // reaching a long-text card without needing the whole ~5800-word deck
  // active at once (which, per game.js, is far too slow to construct).
  const select = document.getElementById('pool-size');
  select.add(new window.Option('60', '60'));
  select.value = '60';
  select.dispatchEvent(new window.Event('change'));
  await flush();

  let found = false;
  for (let i = 0; i < 40 && !found; i++) {
    const cards = [...document.getElementById('en-column').children, ...document.getElementById('es-column').children];
    found = cards.some((b) => b.querySelector('.card-main').textContent.length > 24 && b.classList.contains('long-text'));
    if (found) break;
    document.getElementById('reset-btn').click();
    await flush(80);
  }
  assert.ok(found, 'expected at least one long-text card within a reasonable number of pool draws');
});

test('clicking selects a card; clicking it again deselects it', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  assert.ok(!enBtn.classList.contains('selected'));
  enBtn.click();
  assert.ok(document.getElementById('en-column').children[0].classList.contains('selected'));
});

test('a correct match flashes green and vibrates once; a second, different match clears both after the fade cycle', async (t) => {
  const win = await setupMain({ withVibrate: true });
  const vibrateCalls = [];
  t.mock.method(win.navigator, 'vibrate', (pattern) => vibrateCalls.push(pattern));

  const enButtons = [...document.getElementById('en-column').children];
  const wordA = wordForEnButton(enButtons[0]);
  const wordB = wordForEnButton(enButtons[1]);

  enButtons[0].click();
  esButtonFor(wordA).click();
  await flush();

  const matchedBtn = [...document.getElementById('en-column').children].find((b) =>
    b.querySelector('.card-main').textContent === wordA.en
  );
  assert.ok(matchedBtn.classList.contains('correct'), 'first confirmation locks in green');
  assert.equal(vibrateCalls.length, 1, 'vibrates once for the correct match');
  assert.deepEqual(vibrateCalls[0], 35);

  // A second, different pair triggers the batch clear.
  document.getElementById('en-column').children[1].click();
  esButtonFor(wordB).click();
  await flush(FULL_CYCLE_MS);

  const stillThere = [...document.getElementById('en-column').children].some(
    (b) => b.querySelector('.card-main').textContent === wordA.en
  );
  assert.ok(!stillThere, 'both confirmed pairs were replaced after the fade cycle');
});

test('a wrong pairing flashes red and vibrates the wrong pattern once, not repeatedly', async (t) => {
  const win = await setupMain({ withVibrate: true });
  const vibrateCalls = [];
  t.mock.method(win.navigator, 'vibrate', (pattern) => vibrateCalls.push(pattern));

  const enButtons = [...document.getElementById('en-column').children];
  const wordA = wordForEnButton(enButtons[0]);
  const wordB = wordForEnButton(enButtons[1]);

  enButtons[0].click();
  esButtonFor(wordB).click(); // mismatched on purpose
  await flush();

  const enBtn = [...document.getElementById('en-column').children].find(
    (b) => b.querySelector('.card-main').textContent === wordA.en
  );
  assert.ok(enBtn.classList.contains('wrong'));
  assert.equal(vibrateCalls.length, 1);
  assert.deepEqual(vibrateCalls[0], [40, 70, 40]);
});

test('without the Vibration API, match/mismatch outcomes are silent rather than throwing', async () => {
  await setupMain({ withVibrate: false });
  assert.ok(!('vibrate' in navigator));
  const enButtons = [...document.getElementById('en-column').children];
  const wordA = wordForEnButton(enButtons[0]);
  assert.doesNotThrow(() => {
    enButtons[0].click();
    esButtonFor(wordA).click();
  });
});

// ---------------------------------------------------------------------------
// Long-press card menu
// ---------------------------------------------------------------------------

test('a long press opens the card menu with the word title and both action buttons', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  const word = wordForEnButton(enBtn);

  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600); // longer than LONG_PRESS_MS

  const menu = document.getElementById('card-menu');
  assert.equal(menu.hidden, false);
  assert.ok(menu.querySelector('.card-menu-title').textContent.includes(word.en));
  assert.ok(menu.querySelector('.card-menu-title').textContent.includes(word.es));
  const items = [...menu.querySelectorAll('.card-menu-item')];
  assert.equal(items.length, 3); // known, needs-practice, cancel
});

test('a menu that would overflow the bottom of the viewport flips to appear above the card instead', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  const menu = document.getElementById('card-menu');

  // jsdom's layout engine always reports zeroed rects, which never
  // overflows -- stub both elements' rects for this one test to force the
  // "would overflow the bottom" branch.
  enBtn.getBoundingClientRect = () => ({ top: 700, bottom: 720, left: 10, right: 100, width: 90, height: 20 });
  menu.getBoundingClientRect = () => ({ top: 0, bottom: 100, left: 0, right: 150, width: 150, height: 100 });

  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);

  assert.equal(menu.hidden, false);
  const top = parseFloat(menu.style.top);
  // Flipped above the anchor (anchorRect.top - menuRect.height - 6 = 700 -
  // 100 - 6 = 594), not below it (anchorRect.bottom + 6 = 726).
  assert.equal(top, 594);
});

test('the click that follows a completed long press is swallowed, not treated as a separate tap-select', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];

  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600); // longer than LONG_PRESS_MS -- the long press has now fired
  firePointer(enBtn, 'pointerup', { clientX: 10, clientY: 10 });
  // Both mouse and touch fire a click on release, real browsers included --
  // attachLongPress's click handler must swallow this one.
  const clickEvent = new window.MouseEvent('click', { bubbles: true, cancelable: true });
  const dispatchResult = enBtn.dispatchEvent(clickEvent);

  assert.equal(dispatchResult, false, 'preventDefault was called, so dispatchEvent returns false');
  assert.equal(document.getElementById('card-menu').hidden, false, 'the menu opened by the long press stays open');
  assert.ok(
    !document.getElementById('en-column').children[0].classList.contains('selected'),
    'the swallowed click must not also register as a normal select'
  );
});

test('moving the pointer past the cancel threshold aborts the long press', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  firePointer(enBtn, 'pointermove', { clientX: 100, clientY: 100 });
  await flush(600);
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('a pointermove with no press in flight is a no-op (not just a small enough move to ignore)', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  // No prior pointerdown on this button -- attachLongPress's `timer` is
  // still null, so this move should be ignored outright rather than
  // measured against the cancel threshold.
  assert.doesNotThrow(() => firePointer(enBtn, 'pointermove', { clientX: 999, clientY: 999 }));
  await flush(600);
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('releasing before the threshold cancels the long press and registers as a normal click instead', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  firePointer(enBtn, 'pointerup', { clientX: 10, clientY: 10 });
  enBtn.click(); // real browsers fire a click after a normal tap's pointerdown/up; jsdom doesn't synthesize it
  await flush(600);
  assert.equal(document.getElementById('card-menu').hidden, true);
  // The click synchronously triggers a re-render (selectCard -> onChange),
  // which rebuilds the column -- re-query rather than reuse the now-stale
  // detached `enBtn` reference.
  assert.ok(
    document.getElementById('en-column').children[0].classList.contains('selected'),
    'the quick tap still registers as a normal select'
  );
});

test('a non-mouse-primary-button pointerdown does not start a long press', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10, pointerType: 'mouse', button: 2 });
  await flush(600);
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('"Mark as known" closes the menu and marks the word known', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);

  const knownBtn = document.querySelectorAll('.card-menu-item')[0];
  assert.ok(!knownBtn.disabled);
  knownBtn.click();
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('re-opening the menu for an already-known word shows it as active/disabled', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);
  document.querySelectorAll('.card-menu-item')[0].click(); // mark known

  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);
  const knownBtn = document.querySelectorAll('.card-menu-item')[0];
  assert.ok(knownBtn.disabled);
  assert.ok(knownBtn.classList.contains('active'));
  assert.match(knownBtn.textContent, /Marked as known/);
});

test('"Needs practice" resets the word and closes the menu', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);
  const practiceBtn = document.querySelectorAll('.card-menu-item')[1];
  practiceBtn.click();
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('"Cancel" closes the menu without changing anything', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);
  document.querySelector('.card-menu-cancel').click();
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('clicking outside the open menu closes it; clicking inside it does not', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);

  const menu = document.getElementById('card-menu');
  menu.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(menu.hidden, false, 'a pointerdown inside the menu does not close it');

  document.body.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
  assert.equal(menu.hidden, true, 'a pointerdown outside the menu closes it');
});

test('pressing Escape closes the open menu; other keys do not', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);

  const menu = document.getElementById('card-menu');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  assert.equal(menu.hidden, false);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(menu.hidden, true);
});

test('scrolling closes the open menu', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);
  window.dispatchEvent(new window.Event('scroll'));
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('switching tabs closes any open card menu', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 });
  await flush(600);
  assert.equal(document.getElementById('card-menu').hidden, false);

  document.querySelector('.tab-btn[data-tab="words"]').click();
  assert.equal(document.getElementById('card-menu').hidden, true);
});

test('a render elsewhere (e.g. a match resolving) cancels a still-pending long press rather than firing it late', async () => {
  await setupMain();
  const enBtn = document.getElementById('en-column').children[0];
  const other = wordForEnButton(document.getElementById('en-column').children[1]);
  firePointer(enBtn, 'pointerdown', { clientX: 10, clientY: 10 }); // press started, not yet 500ms

  // A totally unrelated selection triggers a re-render of the column,
  // tearing down and rebuilding every button -- including the one being
  // pressed.
  document.getElementById('en-column').children[1].click();
  esButtonFor(other) && esButtonFor(other).click();

  await flush(600); // long past LONG_PRESS_MS
  assert.equal(document.getElementById('card-menu').hidden, true, 'the stale press never fired against a detached button');
});

// ---------------------------------------------------------------------------
// Word List tab
// ---------------------------------------------------------------------------

test('the Word List tab is empty by default (seen-only checked) until a word has been reviewed', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  assert.equal(document.getElementById('word-table-body').children.length, 0);
  assert.equal(document.getElementById('page-info').textContent, '0–0 of 0');
});

test('unchecking "seen only" shows the full deck, sorted, filterable, and paginated', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  document.getElementById('seen-only').checked = false;
  document.getElementById('seen-only').dispatchEvent(new window.Event('change'));

  const body = document.getElementById('word-table-body');
  assert.ok(body.children.length > 0);
  assert.ok(body.children.length <= 50, 'page size caps rows shown');
  assert.match(document.getElementById('page-info').textContent, /^1–\d+ of \d+$/);

  // Every action button should say "Mark known" (nothing manually mastered yet).
  const firstActionBtn = body.children[0].querySelector('.table-action-btn');
  assert.equal(firstActionBtn.textContent, 'Mark known');
});

test('the search box filters by English or Spanish text and resets to page 1', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  document.getElementById('seen-only').checked = false;
  document.getElementById('seen-only').dispatchEvent(new window.Event('change'));

  document.getElementById('page-next').click(); // move off page 1 first, if possible
  document.getElementById('word-search').value = 'hola';
  document.getElementById('word-search').dispatchEvent(new window.Event('input'));

  const body = document.getElementById('word-table-body');
  assert.ok(body.children.length >= 1);
  for (const row of body.children) {
    const en = row.children[0].textContent.toLowerCase();
    const es = row.children[1].textContent.toLowerCase();
    assert.ok(en.includes('hola') || es.includes('hola'));
  }
  assert.match(document.getElementById('page-info').textContent, /^1–/);
});

test('the tier filter narrows rows to the selected tier and resets to page 1', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  document.getElementById('seen-only').checked = false;
  document.getElementById('seen-only').dispatchEvent(new window.Event('change'));

  document.getElementById('tier-filter').value = 'new';
  document.getElementById('tier-filter').dispatchEvent(new window.Event('change'));

  const body = document.getElementById('word-table-body');
  for (const row of body.children) {
    assert.equal(row.children[3].textContent, 'New');
  }
});

test('clicking a column header sorts by it (ascending first for text columns)', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  document.getElementById('seen-only').checked = false;
  document.getElementById('seen-only').dispatchEvent(new window.Event('change'));

  const enHeader = document.querySelector('#word-table th[data-sort="en"]');
  enHeader.click();
  assert.ok(enHeader.classList.contains('sorted-asc'));
  const firstPage = [...document.getElementById('word-table-body').children].map((r) => r.children[0].textContent);
  const sorted = [...firstPage].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(firstPage, sorted);

  enHeader.click(); // clicking the same header again flips direction
  assert.ok(enHeader.classList.contains('sorted-desc'));

  const timesSeenHeader = document.querySelector('#word-table th[data-sort="timesSeen"]');
  timesSeenHeader.click(); // a numeric column defaults to descending
  assert.ok(timesSeenHeader.classList.contains('sorted-desc'));
  assert.ok(!enHeader.classList.contains('sorted-asc') && !enHeader.classList.contains('sorted-desc'));
});

test('rows with a null sort value (never-seen words\' lastSeenAt) sort to the bottom regardless of direction', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  document.getElementById('seen-only').checked = false;
  document.getElementById('seen-only').dispatchEvent(new window.Event('change'));

  // Mark a few words known first, so the lastSeenAt column has a mix of
  // null (every other word) and non-null (these) values scattered through
  // a large array -- with *every* row null, the sort comparator would only
  // ever compare null against null; with just one non-null row, a stable
  // sort's merge order can still avoid ever comparing it as the *first*
  // argument against a null second argument.
  const body = document.getElementById('word-table-body');
  for (let i = 0; i < 5; i++) body.children[i].querySelector('.table-action-btn').click();

  const lastSeenHeader = document.querySelector('#word-table th[data-sort="lastSeenAt"]');
  lastSeenHeader.click(); // desc first (numeric default)
  const lastRowDesc = [...document.getElementById('word-table-body').children].at(-1);
  assert.equal(lastRowDesc.children[8].textContent, 'never', 'never-seen words (null lastSeenAt) sort last even descending');

  lastSeenHeader.click(); // asc
  const lastRowAsc = [...document.getElementById('word-table-body').children].at(-1);
  assert.equal(lastRowAsc.children[8].textContent, 'never', 'and still last ascending');
});

test('pagination: next/prev buttons move pages and disable at the ends', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  document.getElementById('seen-only').checked = false;
  document.getElementById('seen-only').dispatchEvent(new window.Event('change'));

  const prevBtn = document.getElementById('page-prev');
  const nextBtn = document.getElementById('page-next');
  assert.ok(prevBtn.disabled, 'no previous page from page 1');
  assert.ok(!nextBtn.disabled, 'there are enough words for more than one page');

  nextBtn.click();
  assert.ok(!prevBtn.disabled);
  assert.match(document.getElementById('page-info').textContent, /^51–/);

  prevBtn.click();
  assert.match(document.getElementById('page-info').textContent, /^1–/);
});

test('the row action button marks a word known, and reflects "Reset" afterward on refresh', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="words"]').click();
  document.getElementById('seen-only').checked = false;
  document.getElementById('seen-only').dispatchEvent(new window.Event('change'));

  const firstRow = document.getElementById('word-table-body').children[0];
  const enText = firstRow.children[0].textContent;
  firstRow.querySelector('.table-action-btn').click();

  // The table refreshes in place; find the same word again by its English text.
  const updatedRow = [...document.getElementById('word-table-body').children].find(
    (r) => r.children[0].textContent === enText
  );
  assert.ok(updatedRow, 'the marked word is still listed (seen-only is unchecked)');
  assert.equal(updatedRow.querySelector('.table-action-btn').textContent, 'Reset');

  updatedRow.querySelector('.table-action-btn').click();
  const resetRow = [...document.getElementById('word-table-body').children].find(
    (r) => r.children[0].textContent === enText
  );
  assert.equal(resetRow.querySelector('.table-action-btn').textContent, 'Mark known');
});

// ---------------------------------------------------------------------------
// Stats tab
// ---------------------------------------------------------------------------

test('the chart bar tooltip pluralizes "review(s)" correctly for exactly one vs. more than one', async () => {
  // MATCHES_NEEDED means a real playthrough only ever records reviews in
  // pairs, so a day with exactly 1 is never produced by normal play --
  // seed it directly (a legitimate value the rendering code still has to
  // handle correctly regardless of how it arose).
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  await db.putHistoryDay(`${y}-${m}-${d}`, { reviews: 1, clean: 1, retried: 0, lapsed: 0, newWords: 1 });

  await setupMain();
  document.querySelector('.tab-btn[data-tab="stats"]').click();

  const svg = document.getElementById('chart-container').querySelector('svg');
  const titles = [...svg.querySelectorAll('title')].map((t) => t.textContent);
  assert.ok(titles.some((t) => t.endsWith('1 review')), 'singular for exactly one review');
});

test('the Stats tab renders a streak, a 30-bar chart, and a totals grid', async () => {
  await setupMain();
  document.querySelector('.tab-btn[data-tab="stats"]').click();

  assert.equal(document.getElementById('streak-current').textContent, '0');
  assert.equal(document.getElementById('streak-longest').textContent, '0');

  const svg = document.getElementById('chart-container').querySelector('svg');
  assert.ok(svg);
  assert.equal(svg.querySelectorAll('rect').length, 30);
  assert.ok(document.querySelector('.chart-range-label'));

  const dts = [...document.getElementById('stats-grid').querySelectorAll('dt')].map((d) => d.textContent);
  assert.deepEqual(dts, [
    'Total reviews',
    'Overall accuracy',
    'New words introduced',
    'New',
    'Learning',
    'Familiar',
    'Mastered',
    'Total words in deck',
  ]);
});

test('a completed review shows up in the stats totals and streak', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await setupMain();

  const enButtons = [...document.getElementById('en-column').children];
  const wordA = wordForEnButton(enButtons[0]);
  const wordB = wordForEnButton(enButtons[1]);
  enButtons[0].click();
  esButtonFor(wordA).click();
  document.getElementById('en-column').children[1].click();
  esButtonFor(wordB).click();
  t.mock.timers.tick(MATCH_FLASH_MS + REMOVE_FADE_MS + ENTER_FADE_MS);

  document.querySelector('.tab-btn[data-tab="stats"]').click();
  assert.equal(document.getElementById('streak-current').textContent, '1');
  const items = [...document.getElementById('stats-grid').querySelectorAll('dd')];
  assert.equal(items[0].textContent, '2', 'two reviews recorded');
});

// ---------------------------------------------------------------------------
// Controls: reset button, pool size
// ---------------------------------------------------------------------------

test('reset button does nothing if the confirm dialog is declined', async () => {
  await setupMain({ confirmReturns: false });
  const before = document.getElementById('en-column').innerHTML;
  document.getElementById('reset-btn').click();
  await flush();
  assert.equal(document.getElementById('en-column').innerHTML, before);
});

test('reset button clears and refills the board if confirmed', async () => {
  await setupMain({ confirmReturns: true });
  document.getElementById('reset-btn').click();
  await flush(50);
  assert.equal(document.getElementById('en-column').children.length, 6);
});

test('changing the pool size grows the active board', async () => {
  await setupMain();
  const select = document.getElementById('pool-size');
  select.value = '10';
  select.dispatchEvent(new window.Event('change'));
  assert.equal(document.getElementById('en-column').children.length, 10);
});

// ---------------------------------------------------------------------------
// Service worker registration
// ---------------------------------------------------------------------------

test('without service worker support, registration is skipped silently', async () => {
  const win = await setupMain();
  assert.ok(!('serviceWorker' in win.navigator));
});

test('with service worker support, registration happens on window load', async () => {
  let registered = false;
  const win = await setupMain({
    serviceWorker: {
      register: (...args) => {
        registered = args;
        return Promise.resolve();
      },
    },
  });
  win.dispatchEvent(new win.Event('load'));
  await flush();
  assert.deepEqual(registered, ['sw.js']);
});

test('a failed service worker registration is caught, not thrown', async () => {
  const win = await setupMain({ serviceWorker: { register: () => Promise.reject(new Error('nope')) } });
  assert.doesNotThrow(() => win.dispatchEvent(new win.Event('load')));
  await flush();
});
