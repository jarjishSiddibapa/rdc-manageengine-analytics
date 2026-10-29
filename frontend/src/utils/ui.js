import { useMemo } from 'react';
import { useFilters } from '../context/Filters';

// The analytics wording and list sizes an administrator has chosen (Admin > Settings > Analytics), as delivered by /api/meta.
// These are the shipped defaults, used until the answer arrives.
export const UI_DEFAULTS = {
  default_preset: 'all',
  default_page_size: 25,
  targets_days: [1, 3, 7],
  first_reply_targets_minutes: [60, 1440],
  stale_days: [7, 14],
  recent_days: 30,
  min_ranked: 5,
  top_n_charts: 12,
  top_n_story: 4,
  top_n_matrix: 20,
  insight_diff_pct: 10,
  count_weekends: true,
  reassign_top: 3,
};

export function useUi() {
  const { meta } = useFilters();
  const ui = meta?.ui;
  return useMemo(() => (ui ? { ...UI_DEFAULTS, ...ui } : UI_DEFAULTS), [ui]);
}

// 1 -> "1 day", 3 -> "3 days"
export const dayWord = n => `${n} day${n === 1 ? '' : 's'}`;

// 60 -> "1 hour", 1440 -> "1 day", 45 -> "45 min"
export function minutesWord(m) {
  if (m % 1440 === 0) return dayWord(m / 1440);
  if (m % 60 === 0) return `${m / 60} hour${m / 60 === 1 ? '' : 's'}`;
  return `${m} min`;
}

// "Calendar time" unless weekends are excluded.
export const timeBasis = ui => (ui.count_weekends ? 'calendar time' : 'working days only, weekends not counted');
