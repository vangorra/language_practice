import { createGame } from './game.js';
import { TIER } from './srs.js';

const enColumnEl = document.getElementById('en-column');
const esColumnEl = document.getElementById('es-column');
const statsEl = document.getElementById('stats');
const resetBtn = document.getElementById('reset-btn');
const poolSizeSelect = document.getElementById('pool-size');

const TIER_LABELS = {
  [TIER.NEW]: 'New',
  [TIER.LEARNING]: 'Learning',
  [TIER.FAMILIAR]: 'Familiar',
  [TIER.MASTERED]: 'Mastered',
};
const TIER_ORDER = [TIER.NEW, TIER.LEARNING, TIER.FAMILIAR, TIER.MASTERED];

function cardClass(card, flash) {
  const classes = ['card'];
  if (card.selected) {
    if (flash === 'correct') classes.push('correct');
    else if (flash === 'wrong') classes.push('wrong');
    else classes.push('selected');
  }
  return classes.join(' ');
}

function renderColumn(container, cards, side, flash, onPick) {
  container.innerHTML = '';
  for (const card of cards) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cardClass(card, flash);
    btn.textContent = side === 'en' ? card.word.en : card.word.es;
    btn.addEventListener('click', () => onPick(side, card.wordId));
    container.appendChild(btn);
  }
}

function renderStats(stats) {
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

function render(snapshot) {
  renderColumn(enColumnEl, snapshot.en, 'en', snapshot.flash, (side, id) => game.selectCard(side, id));
  renderColumn(esColumnEl, snapshot.es, 'es', snapshot.flash, (side, id) => game.selectCard(side, id));
  renderStats(snapshot.stats);
}

const game = createGame({ poolSize: Number(poolSizeSelect.value), onChange: render });
render(game.snapshot());

resetBtn.addEventListener('click', () => {
  if (window.confirm('Reset all progress? This cannot be undone.')) {
    game.reset();
  }
});

poolSizeSelect.addEventListener('change', () => {
  game.setPoolSize(Number(poolSizeSelect.value));
});
