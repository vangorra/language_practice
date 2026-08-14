import { createGame } from './game.js';
import { TIER } from './srs.js';

const enColumnEl = document.getElementById('en-column');
const esColumnEl = document.getElementById('es-column');
const statsEl = document.getElementById('stats');
const resetBtn = document.getElementById('reset-btn');
const poolSizeSelect = document.getElementById('pool-size');

const tabButtons = [...document.querySelectorAll('.tab-btn')];
const panels = {
  practice: document.getElementById('panel-practice'),
  words: document.getElementById('panel-words'),
  stats: document.getElementById('panel-stats'),
};

const wordSearchEl = document.getElementById('word-search');
const tierFilterEl = document.getElementById('tier-filter');
const seenOnlyEl = document.getElementById('seen-only');
const wordTableBody = document.getElementById('word-table-body');
const pageInfoEl = document.getElementById('page-info');
const pagePrevBtn = document.getElementById('page-prev');
const pageNextBtn = document.getElementById('page-next');
const tableHeaders = [...document.querySelectorAll('#word-table th[data-sort]')];

const streakCurrentEl = document.getElementById('streak-current');
const streakLongestEl = document.getElementById('streak-longest');
const chartContainerEl = document.getElementById('chart-container');
const statsGridEl = document.getElementById('stats-grid');

const cardMenuEl = document.getElementById('card-menu');

const TIER_LABELS = {
  [TIER.NEW]: 'New',
  [TIER.LEARNING]: 'Learning',
  [TIER.FAMILIAR]: 'Familiar',
  [TIER.MASTERED]: 'Mastered',
};
const TIER_ORDER = [TIER.NEW, TIER.LEARNING, TIER.FAMILIAR, TIER.MASTERED];

// ---------------------------------------------------------------------------
// Practice board
// ---------------------------------------------------------------------------

const LONG_TEXT_THRESHOLD = 24; // chars; longer phrases get a smaller font
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_CANCEL_PX = 10;

let game; // assigned once createGame() resolves, in main()

function cardClass(card, flash) {
  const classes = ['card'];
  // A card mid-match-resolution (see game.js resolveMatch/swapInReplacement)
  // takes priority over the normal selected/flash styling: it's already
  // been deselected by that point, and is instead fading out (still
  // showing the match it just won) or fading in as its replacement.
  if (card.removing) classes.push('card-removing');
  else if (card.entering) classes.push('card-entering');
  else if (card.selected) {
    if (flash === 'correct') classes.push('correct');
    else if (flash === 'wrong') classes.push('wrong');
    else classes.push('selected');
  }
  return classes.join(' ');
}

/** Wires up press-and-hold detection on a card button; calls onLongPress(wordId) once the hold clears the threshold. */
function attachLongPress(btn, wordId, onLongPress) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  btn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    fired = false;
    clearTimer();
    timer = setTimeout(() => {
      fired = true;
      onLongPress(wordId, btn);
    }, LONG_PRESS_MS);
  });
  btn.addEventListener('pointermove', (e) => {
    if (!timer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > LONG_PRESS_MOVE_CANCEL_PX) clearTimer();
  });
  btn.addEventListener('pointerup', clearTimer);
  btn.addEventListener('pointerleave', clearTimer);
  btn.addEventListener('pointercancel', clearTimer);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // A long press still ends in a click (both mouse and touch fire one on
  // release) — swallow just that one so it doesn't also register as a
  // normal tap-to-select.
  btn.addEventListener('click', (e) => {
    if (fired) {
      e.preventDefault();
      e.stopPropagation();
      fired = false;
    }
  });
}

function renderColumn(container, cards, side, flash, onPick) {
  container.innerHTML = '';
  for (const card of cards) {
    const text = side === 'en' ? card.word.en : card.word.es;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cardClass(card, flash);
    if (text.length > LONG_TEXT_THRESHOLD) btn.classList.add('long-text');

    const main = document.createElement('span');
    main.className = 'card-main';
    main.textContent = text;
    btn.appendChild(main);

    // Context is a short subheading shown only on the English side —
    // it disambiguates words with multiple senses (e.g. "to be" -> ser
    // vs. estar) and labels which verb/person a conjugated form belongs
    // to. The Spanish side never gets this: for conjugations, the actual
    // conjugated word *is* the content on that side.
    if (side === 'en' && card.word.context) {
      const sub = document.createElement('span');
      sub.className = 'card-context';
      sub.textContent = card.word.context;
      btn.appendChild(sub);
    }

    btn.addEventListener('click', () => onPick(side, card.wordId));
    attachLongPress(btn, card.wordId, openCardMenu);
    container.appendChild(btn);
  }
}

function renderStatsBar(stats) {
  statsEl.innerHTML = '';
  for (const tier of TIER_ORDER) {
    const chip = document.createElement('span');
    chip.className = `stat-chip stat-${tier}`;
    chip.textContent = `${TIER_LABELS[tier]}: ${stats.counts[tier]}`;
    statsEl.appendChild(chip);
  }
  const total = document.createElement('span');
  total.className = 'stat-chip stat-total';
  total.textContent = `Total: ${stats.total}`;
  statsEl.appendChild(total);
}

function renderPractice(snapshot) {
  renderColumn(enColumnEl, snapshot.en, 'en', snapshot.flash, (side, id) => game.selectCard(side, id));
  renderColumn(esColumnEl, snapshot.es, 'es', snapshot.flash, (side, id) => game.selectCard(side, id));
  renderStatsBar(snapshot.stats);
}

// ---------------------------------------------------------------------------
// Long-press card menu
// ---------------------------------------------------------------------------

let closeMenuListener = null;

function closeCardMenu() {
  cardMenuEl.hidden = true;
  cardMenuEl.innerHTML = '';
  if (closeMenuListener) {
    document.removeEventListener('pointerdown', closeMenuListener, true);
    window.removeEventListener('scroll', closeMenuListener, true);
    document.removeEventListener('keydown', closeMenuListener, true);
    closeMenuListener = null;
  }
}

function openCardMenu(wordId, anchorEl) {
  closeCardMenu();
  const word = game.getWordById(wordId);
  const status = game.getWordStatus(wordId);
  if (!word || !status) return;

  cardMenuEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'card-menu-title';
  title.textContent = `${word.en} → ${word.es}`;
  cardMenuEl.appendChild(title);

  const knownBtn = document.createElement('button');
  knownBtn.type = 'button';
  knownBtn.className = 'card-menu-item';
  if (status.manuallyMastered) knownBtn.classList.add('active');
  knownBtn.textContent = status.manuallyMastered ? '✓ Marked as known' : '✓ Mark as known';
  knownBtn.disabled = status.manuallyMastered;
  knownBtn.addEventListener('click', () => {
    game.markWordKnown(wordId);
    closeCardMenu();
  });

  const practiceBtn = document.createElement('button');
  practiceBtn.type = 'button';
  practiceBtn.className = 'card-menu-item';
  practiceBtn.textContent = '↺ Needs practice (reset)';
  practiceBtn.addEventListener('click', () => {
    game.markWordNeedsPractice(wordId);
    closeCardMenu();
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'card-menu-item card-menu-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeCardMenu);

  cardMenuEl.append(knownBtn, practiceBtn, cancelBtn);

  cardMenuEl.style.visibility = 'hidden';
  cardMenuEl.hidden = false;
  requestAnimationFrame(() => {
    const anchorRect = anchorEl.getBoundingClientRect();
    const menuRect = cardMenuEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchorRect.bottom + 6;
    if (top + menuRect.height > vh - 8) top = anchorRect.top - menuRect.height - 6;
    top = Math.max(8, Math.min(top, vh - menuRect.height - 8));

    let left = anchorRect.left;
    left = Math.max(8, Math.min(left, vw - menuRect.width - 8));

    cardMenuEl.style.top = `${top}px`;
    cardMenuEl.style.left = `${left}px`;
    cardMenuEl.style.visibility = 'visible';
  });

  closeMenuListener = (e) => {
    if (e.type === 'pointerdown' && cardMenuEl.contains(e.target)) return;
    if (e.type === 'keydown' && e.key !== 'Escape') return;
    closeCardMenu();
  };
  document.addEventListener('pointerdown', closeMenuListener, true);
  window.addEventListener('scroll', closeMenuListener, true);
  document.addEventListener('keydown', closeMenuListener, true);
}

// ---------------------------------------------------------------------------
// Word List tab
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
let wordListCache = [];
let sortKey = 'lastSeenAt';
let sortDir = 'desc';
let page = 0;

const TEXT_SORT_KEYS = new Set(['en', 'es', 'category', 'tier']);

function formatInterval(intervalMin) {
  if (!intervalMin) return '—';
  if (intervalMin < 60) return `${Math.round(intervalMin)}m`;
  if (intervalMin < 24 * 60) return `${Math.round(intervalMin / 60)}h`;
  return `${Math.round(intervalMin / (24 * 60))}d`;
}

function formatRelative(ts, { future }) {
  if (ts == null) return future ? '—' : 'never';
  const diffMs = future ? ts - Date.now() : Date.now() - ts;
  if (future && diffMs <= 0) return 'due now';
  if (!future && diffMs < 60_000) return 'just now';
  const minutes = Math.round(diffMs / 60_000);
  const hours = Math.round(diffMs / 3_600_000);
  const days = Math.round(diffMs / 86_400_000);
  let amount;
  if (minutes < 60) amount = `${minutes}m`;
  else if (hours < 24) amount = `${hours}h`;
  else amount = `${days}d`;
  return future ? `in ${amount}` : `${amount} ago`;
}

function formatAccuracy(accuracy) {
  return accuracy == null ? '—' : `${Math.round(accuracy * 100)}%`;
}

function refreshWordList() {
  wordListCache = game.getAllWordsWithStats();
  renderWordTable();
}

function getFilteredSortedWords() {
  const search = wordSearchEl.value.trim().toLowerCase();
  const tier = tierFilterEl.value;
  const seenOnly = seenOnlyEl.checked;

  let rows = wordListCache;
  if (seenOnly) rows = rows.filter((w) => w.timesSeen > 0);
  if (tier !== 'all') rows = rows.filter((w) => w.tier === tier);
  if (search) {
    rows = rows.filter(
      (w) => w.en.toLowerCase().includes(search) || w.es.toLowerCase().includes(search)
    );
  }

  const dir = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1; // unseen/never-due rows sort to the bottom regardless of direction
    if (bv == null) return -1;
    if (typeof av === 'string') return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
}

function renderWordTable() {
  const rows = getFilteredSortedWords();
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.min(page, totalPages - 1);
  const start = page * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  wordTableBody.innerHTML = '';
  for (const w of pageRows) {
    const tr = document.createElement('tr');
    const cells = [
      w.en,
      w.es,
      w.category,
      TIER_LABELS[w.tier] ?? w.tier,
      String(w.timesSeen),
      formatAccuracy(w.accuracy),
      formatInterval(w.intervalMin),
      formatRelative(w.dueAt, { future: true }),
      formatRelative(w.lastSeenAt, { future: false }),
    ];
    for (const value of cells) {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    }

    const actionTd = document.createElement('td');
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'table-action-btn';
    actionBtn.textContent = w.manuallyMastered ? 'Reset' : 'Mark known';
    actionBtn.addEventListener('click', () => {
      if (w.manuallyMastered) game.markWordNeedsPractice(w.id);
      else game.markWordKnown(w.id);
      refreshWordList();
    });
    actionTd.appendChild(actionBtn);
    tr.appendChild(actionTd);

    wordTableBody.appendChild(tr);
  }

  const shownEnd = rows.length === 0 ? 0 : start + pageRows.length;
  pageInfoEl.textContent = `${rows.length === 0 ? 0 : start + 1}–${shownEnd} of ${rows.length}`;
  pagePrevBtn.disabled = page === 0;
  pageNextBtn.disabled = page >= totalPages - 1;

  for (const th of tableHeaders) {
    th.classList.toggle('sorted-asc', th.dataset.sort === sortKey && sortDir === 'asc');
    th.classList.toggle('sorted-desc', th.dataset.sort === sortKey && sortDir === 'desc');
  }
}

for (const th of tableHeaders) {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey = key;
      sortDir = TEXT_SORT_KEYS.has(key) ? 'asc' : 'desc';
    }
    renderWordTable();
  });
}

wordSearchEl.addEventListener('input', () => {
  page = 0;
  renderWordTable();
});
tierFilterEl.addEventListener('change', () => {
  page = 0;
  renderWordTable();
});
seenOnlyEl.addEventListener('change', () => {
  page = 0;
  renderWordTable();
});
pagePrevBtn.addEventListener('click', () => {
  page = Math.max(0, page - 1);
  renderWordTable();
});
pageNextBtn.addEventListener('click', () => {
  page += 1;
  renderWordTable();
});

// ---------------------------------------------------------------------------
// Stats tab
// ---------------------------------------------------------------------------

function buildChartSvg(series) {
  const width = 600;
  const height = 140;
  const gap = 2;
  const barWidth = width / series.length - gap;
  const max = Math.max(1, ...series.map((d) => d.reviews));

  const bars = series
    .map((d, i) => {
      const h = Math.max(d.reviews > 0 ? 2 : 0, Math.round((d.reviews / max) * (height - 4)));
      const x = (i * (barWidth + gap)).toFixed(2);
      const y = height - h;
      return `<rect x="${x}" y="${y}" width="${barWidth.toFixed(2)}" height="${h}" rx="2" class="chart-bar"><title>${d.date}: ${d.reviews} review${d.reviews === 1 ? '' : 's'}</title></rect>`;
    })
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Reviews per day for the last ${series.length} days">${bars}</svg>`;
}

function renderStats() {
  const summary = game.getHistorySummary();
  const practiceStats = game.snapshot().stats;

  streakCurrentEl.textContent = String(summary.streak);
  streakLongestEl.textContent = String(summary.longestStreak);

  chartContainerEl.innerHTML = buildChartSvg(summary.series);
  const rangeLabel = document.createElement('div');
  rangeLabel.className = 'chart-range-label';
  rangeLabel.innerHTML = `<span>${summary.series[0].date}</span><span>${summary.series[summary.series.length - 1].date}</span>`;
  chartContainerEl.appendChild(rangeLabel);

  const items = [
    ['Total reviews', String(summary.totals.reviews)],
    ['Overall accuracy', summary.totals.accuracy == null ? '—' : `${Math.round(summary.totals.accuracy * 100)}%`],
    ['New words introduced', String(summary.totals.newWords)],
    ['New', String(practiceStats.counts[TIER.NEW])],
    ['Learning', String(practiceStats.counts[TIER.LEARNING])],
    ['Familiar', String(practiceStats.counts[TIER.FAMILIAR])],
    ['Mastered', String(practiceStats.counts[TIER.MASTERED])],
    ['Total words in deck', String(practiceStats.total)],
  ];
  statsGridEl.innerHTML = '';
  for (const [label, value] of items) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    statsGridEl.append(dt, dd);
  }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

for (const btn of tabButtons) {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    for (const b of tabButtons) b.setAttribute('aria-pressed', String(b === btn));
    for (const [key, panel] of Object.entries(panels)) panel.hidden = key !== tab;
    closeCardMenu();
    if (tab === 'words') refreshWordList();
    if (tab === 'stats') renderStats();
  });
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

async function main() {
  game = await createGame({ poolSize: Number(poolSizeSelect.value), onChange: renderPractice });
  renderPractice(game.snapshot());

  resetBtn.addEventListener('click', async () => {
    if (window.confirm('Reset all progress? This cannot be undone.')) {
      await game.reset();
    }
  });

  poolSizeSelect.addEventListener('change', () => {
    game.setPoolSize(Number(poolSizeSelect.value));
  });
}

main();
