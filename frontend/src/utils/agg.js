import { useMemo } from 'react';
import { AGGREGATIONS, useFilters } from '../context/Filters';

// The figure shown first for every time ("Average" by default, or "Median"), chosen with the switch at the top of the page.
// The server sends both for each group (avg_minutes / median_minutes, avg_first_response_minutes / median_first_response_minutes ...);
// `pick(row)` reads the chosen one, `other(row)` the other, and `both(row, fmt)` words them with the chosen one first.
export function useAgg() {
  const { agg } = useFilters();
  return useMemo(() => {
    const avg = agg === 'average';
    const p = avg ? 'avg' : 'median';
    const q = avg ? 'median' : 'avg';
    const field = (prefix, what) => (what ? `${prefix}_${what}_minutes` : `${prefix}_minutes`);
    const word = avg ? 'average' : 'median';
    const otherWord = avg ? 'median' : 'average';
    const pick = (row, what = '') => row?.[field(p, what)];
    const other = (row, what = '') => row?.[field(q, what)];
    return {
      agg, avg, word, Word: avg ? 'Average' : 'Median', otherWord, OtherWord: avg ? 'Median' : 'Average',
      // What the figure means, for hints.
      meaning: avg ? 'the mean: every SR counts, so a few very slow ones pull it up' : 'the typical SR: half closed faster, half slower, not distorted by a few very slow ones',
      pick, other, key: what => field(p, what), otherKey: what => field(q, what),
      both: (row, fmt, what = '') => `${word} ${fmt(pick(row, what))} · ${otherWord} ${fmt(other(row, what))}`,
      // Sort comparator for "lowest first" by the chosen figure; people without one go last.
      byFigure: (what = '') => (a, b) => (pick(a, what) ?? Infinity) - (pick(b, what) ?? Infinity),
    };
  }, [agg]);
}

export { AGGREGATIONS };
