const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-03" -> "Mar '26"
export function monthLabel(key) {
  const [y, m] = String(key).split('-').map(Number);
  return m ? `${MONTHS[m - 1]} '${String(y).slice(2)}` : String(key);
}

// "2026-03-02" -> "2 Mar"
export function dayLabel(key) {
  const [, m, d] = String(key).split('-').map(Number);
  return m ? `${d} ${MONTHS[m - 1]}` : String(key);
}

export const MINUTES_PER_DAY = 1440;

// Minutes -> decimal days (2 places), or null.
export const toDays = minutes => (minutes === null || minutes === undefined ? null : Math.round((minutes / MINUTES_PER_DAY) * 100) / 100);

export const dayAxis = v => `${v}d`;

// Percentage change of `mine` against `team`, as a delta for a KPI tile. `lowerIsBetter` for times.
export function compare(mine, team, { lowerIsBetter = false, unit = '%', digits = 0 } = {}) {
  if (mine === null || mine === undefined || team === null || team === undefined || !team) return null;
  const diff = ((mine - team) / team) * 100;
  if (Math.abs(diff) < 1) return { text: 'same as team', tone: 'flat' };
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  const word = lowerIsBetter ? (diff < 0 ? 'faster' : 'slower') : (diff > 0 ? 'higher' : 'lower');
  return { text: `${Math.abs(diff).toFixed(digits)}${unit} ${word} than team`, tone: better ? 'good' : 'bad' };
}
