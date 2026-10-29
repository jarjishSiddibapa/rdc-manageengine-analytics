// Small helpers so every data table sorts and searches the same way.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Sorters for antd columns. Blank values always sort as "smallest", so they group together at one end.
export const textSorter = key => (a, b) => collator.compare(String(a[key] ?? ''), String(b[key] ?? ''));
export const numberSorter = key => (a, b) => (Number(a[key]) || 0) - (Number(b[key]) || 0);
export const dateSorter = key => (a, b) => (new Date(a[key] || 0).getTime() || 0) - (new Date(b[key] || 0).getTime() || 0);

// True when every word typed appears somewhere in the given values (case-insensitive).
export function matchesSearch(query, ...values) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = values.map(v => String(v ?? '')).join(' ').toLowerCase();
  return words.every(w => haystack.includes(w));
}

// antd column `filters` built from the distinct values actually present in the data.
export function filtersFrom(rows, key, label = v => v) {
  return [...new Set(rows.map(r => r[key]).filter(v => v !== null && v !== undefined && v !== ''))]
    .sort((a, b) => collator.compare(String(a), String(b)))
    .map(v => ({ text: label(v), value: v }));
}
