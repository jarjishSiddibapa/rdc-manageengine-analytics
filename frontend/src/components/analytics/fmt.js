import dayjs from 'dayjs';

export const fmtInt = v => (v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : Number(v).toLocaleString());

// 1,234 stays whole; 12,345 -> 12.3k; 1,200,000 -> 1.2M (axis ticks and bar labels).
export function compact(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const a = Math.abs(n);
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  return Number.isInteger(n) ? n.toLocaleString() : String(+n.toFixed(1));
}

export const truncate = (text, max) => { const s = String(text ?? ''); return s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s; };

// Greedy word wrap into at most `maxLines` lines of about `maxChars`; the last line is shortened with an ellipsis if text is left over.
export function wrapText(text, maxChars, maxLines = 2) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length <= maxChars || !line) line = next; else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(' ')}`;
    return kept.map(l => truncate(l, maxChars));
  }
  return lines.map(l => truncate(l, maxChars));
}

export const dateTime = v => (v ? dayjs(v).format('DD-MMM-YYYY hh:mm A') : '-');
export const dateOnly = v => (v ? dayjs(v).format('DD-MMM-YYYY') : '-');

// 'YYYY-MM' rows with gaps -> one row for every month between the first and last, so a time axis is never squeezed.
export function fillMonths(rows, make) {
  if (!rows || rows.length < 2) return rows || [];
  const byKey = new Map(rows.map(r => [r.key, r]));
  const out = [];
  let [y, m] = rows[0].key.split('-').map(Number);
  const [ly, lm] = rows[rows.length - 1].key.split('-').map(Number);
  let guard = 0;
  while ((y < ly || (y === ly && m <= lm)) && guard++ < 600) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(byKey.get(key) || make(key));
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// Relative time for the SR timeline ("3 days ago").
export function ago(value) {
  if (!value) return '';
  const mins = dayjs().diff(dayjs(value), 'minute');
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 45) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30.4);
  if (months < 18) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

// A "nice" axis for values from 0 to `max`: round steps (1, 2, 2.5, 5, 10 x a power of ten) and the top tick at or above the data.
export function niceTicks(max, count = 4, integer = false) {
  const top = Number(max);
  if (!Number.isFinite(top) || top <= 0) return { max: 1, ticks: [0, 1] };
  const raw = top / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const base = (integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]).find(m => m * pow >= raw - 1e-9) * pow;
  const step = integer ? Math.max(1, Math.round(base)) : base;
  const n = Math.ceil(top / step - 1e-9);
  const ticks = Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(6));
  return { max: ticks[ticks.length - 1], ticks };
}

// Round tick values between `a` and `b` (a zoomed numeric axis), about `count` of them.
export function rangeTicks(a, b, count = 5) {
  const span = b - a;
  if (!(span > 0)) return [a];
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find(m => m * pow >= raw - 1e-9) * pow;
  const out = [];
  for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
