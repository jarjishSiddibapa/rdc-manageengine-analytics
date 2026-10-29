// Turnaround figures arrive from the API as whole calendar minutes. These helpers render them the
// same way everywhere (cards, tables, Excel) so "2d 6h" in one place is never "2.3 days" in another.

const DAY = 24 * 60;

export function formatDuration(minutes) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return '-';
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  if (m < DAY) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  let d = Math.floor(m / DAY);
  let h = Math.round((m % DAY) / 60);
  // 23h 40m rounds to 24h, which is the next day, not "24h".
  if (h === 24) { d += 1; h = 0; }
  if (d >= 30) return `${d}d`;
  return h ? `${d}d ${h}h` : `${d}d`;
}

// Decimal days, for sorting columns and spreadsheets.
export function toDays(minutes, digits = 2) {
  if (minutes === null || minutes === undefined) return null;
  return Number((minutes / DAY).toFixed(digits));
}

export function formatPct(value) {
  return value === null || value === undefined ? '-' : `${value}%`;
}

// Null-safe comparator for antd column sorters: rows without a value always sort last.
export function compareNullable(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : -1;
  if (b === null || b === undefined) return 1;
  return a - b;
}
