// Small display-formatting helpers for the Word List table (js/main.js).
// Pulled out into their own pure, DOM-free module so their branches (lots
// of them, for a handful of tiny functions) are directly unit-testable
// without needing a full jsdom setup -- the same reasoning that already
// keeps srs.js/history.js separate from the DOM-glue code in main.js.

/** SRS interval, in minutes, as a compact human string ("45m" / "3h" / "2d"). */
export function formatInterval(intervalMin) {
  if (!intervalMin) return '—';
  if (intervalMin < 60) return `${Math.round(intervalMin)}m`;
  if (intervalMin < 24 * 60) return `${Math.round(intervalMin / 60)}h`;
  return `${Math.round(intervalMin / (24 * 60))}d`;
}

/**
 * A timestamp relative to now, as a compact human string.
 * @param {number|null} ts
 * @param {{future: boolean}} opts - whether ts is expected to be in the
 *   future (a due date) or the past (a last-seen date); changes both the
 *   "never happened" label and the direction of the relative phrase.
 */
export function formatRelative(ts, { future }) {
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

/** Review accuracy (0-1) as a rounded percentage string, or an em-dash if never reviewed. */
export function formatAccuracy(accuracy) {
  return accuracy == null ? '—' : `${Math.round(accuracy * 100)}%`;
}
