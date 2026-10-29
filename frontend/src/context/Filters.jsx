import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { metaAPI } from '../services/api';
import { useAuth } from './Auth';

const FiltersContext = createContext(null);

export const DEFAULT_FILTERS = {
  preset: 'all', range: null, technicians: [], categories: [], priorities: [], groups: [], requestTypes: [], statuses: [],
};

export const PRESETS = [
  { label: 'All time', value: 'all' },
  { label: '30 days', value: '30' },
  { label: '90 days', value: '90' },
  { label: '6 months', value: '180' },
  { label: 'This year', value: 'year' },
  { label: 'Custom', value: 'custom' },
];

export const AGGREGATIONS = [
  { value: 'average', label: 'Average', long: 'average (mean)' },
  { value: 'median', label: 'Median', long: 'median (the typical SR)' },
];

export const BASES = [
  { value: 'assigned', label: 'Since assigned', long: 'Since the SR was assigned to the technician' },
  { value: 'raised', label: 'Since raised', long: 'Since the SR was raised' },
];

const FILTERS_KEY = 'mea.filters';
const SETTLE_MS = 350;
const ANALYTIC_PATHS = ['/technicians', '/srs'];
const isAnalytic = path => path === '/' || ANALYTIC_PATHS.some(p => path === p || path.startsWith(`${p}/`));

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* private window: the choice just is not remembered */ } },
};
// The measuring basis is not remembered between visits: every fresh open starts on the administrator's default (normally "since
// assigned"). A choice made during a visit lives in the address (?basis=) and in the open page, so it survives a refresh and a shared link.
try { localStorage.removeItem('mea.basis'); } catch { /* nothing saved to clear */ }

// The filters travel in the address (so a view can be bookmarked or sent to a colleague) and are remembered between visits.
const LISTS = [['technicians', 'technician'], ['categories', 'category'], ['priorities', 'priority'], ['groups', 'group'], ['requestTypes', 'type'], ['statuses', 'status']];
const KEYS = ['preset', 'from', 'to', 'basis', 'agg', ...LISTS.map(([, k]) => k)];
const VALID_PRESETS = new Set(PRESETS.map(p => p.value));

// Rewrites only the keys the filters own and leaves every other query key (table page, sort, search, SR-list switches) as the pages set it.
function toSearch(filters, basis, defaultBasis, agg, defaultAgg, currentSearch = '') {
  const q = new URLSearchParams(currentSearch);
  KEYS.forEach(k => q.delete(k));
  if (filters.preset !== 'all') q.set('preset', filters.preset);
  if (filters.preset === 'custom' && filters.range?.[0] && filters.range?.[1]) {
    q.set('from', filters.range[0].format('YYYY-MM-DD'));
    q.set('to', filters.range[1].format('YYYY-MM-DD'));
  }
  for (const [field, key] of LISTS) filters[field].forEach(v => q.append(key, v));
  if (basis !== defaultBasis) q.set('basis', basis);
  if (agg !== defaultAgg) q.set('agg', agg);
  const text = q.toString();
  return text ? `?${text}` : '';
}

function fromSearch(search) {
  const q = new URLSearchParams(search);
  if (!KEYS.some(k => q.has(k))) return null;
  const filters = { ...DEFAULT_FILTERS };
  const preset = q.get('preset');
  if (VALID_PRESETS.has(preset)) filters.preset = preset;
  if (filters.preset === 'custom') {
    const from = dayjs(q.get('from'), 'YYYY-MM-DD', true);
    const to = dayjs(q.get('to'), 'YYYY-MM-DD', true);
    filters.range = from.isValid() && to.isValid() ? [from, to] : null;
  }
  for (const [field, key] of LISTS) filters[field] = q.getAll(key).filter(Boolean);
  const basis = q.get('basis');
  const agg = q.get('agg');
  return { filters, basis: basis === 'raised' || basis === 'assigned' ? basis : null, agg: agg === 'median' || agg === 'average' ? agg : null };
}

// Only a period the person picked themselves (or a link that carries one) counts as their choice; what the app saved on its own does not.
const PRESET_CHOSEN_KEY = 'mea.presetChosen';
const fromSearchHasKeys = search => new URLSearchParams(search).has('preset');
const savedExists = () => store.get(PRESET_CHOSEN_KEY) === '1';

function readSaved() {
  try {
    const saved = JSON.parse(store.get(FILTERS_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return null;
    const filters = { ...DEFAULT_FILTERS };
    if (VALID_PRESETS.has(saved.preset)) filters.preset = saved.preset;
    if (filters.preset === 'custom' && saved.from && saved.to) {
      const from = dayjs(saved.from); const to = dayjs(saved.to);
      filters.range = from.isValid() && to.isValid() ? [from, to] : null;
    }
    for (const [field] of LISTS) if (Array.isArray(saved[field])) filters[field] = saved[field].filter(v => typeof v === 'string');
    return filters;
  } catch { return null; }
}

function writeSaved(filters) {
  store.set(FILTERS_KEY, JSON.stringify({
    preset: filters.preset,
    from: filters.range?.[0]?.format('YYYY-MM-DD'),
    to: filters.range?.[1]?.format('YYYY-MM-DD'),
    ...Object.fromEntries(LISTS.map(([field]) => [field, filters[field]])),
  }));
}

export function countActive(filters) {
  let n = filters.preset !== 'all' ? 1 : 0;
  for (const [field] of LISTS) if (filters[field].length) n += 1;
  return n;
}

// The date range always means "SRs closed between these dates"; open SRs are a live snapshot.
function dateRange(filters) {
  const today = dayjs();
  if (filters.preset === 'custom' && filters.range?.[0] && filters.range?.[1]) {
    return { from: filters.range[0].format('YYYY-MM-DD'), to: filters.range[1].format('YYYY-MM-DD') };
  }
  if (['30', '90', '180'].includes(filters.preset)) return { from: today.subtract(Number(filters.preset), 'day').format('YYYY-MM-DD') };
  if (filters.preset === 'year') return { from: today.startOf('year').format('YYYY-MM-DD') };
  return {};
}

const joinList = list => list.join('||');

export function FiltersProvider({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const initial = useRef(null);
  if (initial.current === null) {
    const fromUrl = isAnalytic(location.pathname) ? fromSearch(location.search) : null;
    initial.current = { filters: fromUrl?.filters || readSaved() || DEFAULT_FILTERS, basis: fromUrl?.basis || null, agg: fromUrl?.agg || null };
  }

  // `filters` is what the controls show; `applied` follows it after a short pause, so ticking several options in a row
  // sends one request, not one per click.
  const [filters, setFiltersState] = useState(initial.current.filters);
  const [applied, setApplied] = useState(initial.current.filters);
  const [basis, setBasisState] = useState(initial.current.basis || 'assigned');
  const [agg, setAggState] = useState(initial.current.agg || 'average');
  const [meta, setMeta] = useState(null);
  // A visitor with no choice of their own (nothing in the address, nothing remembered) starts with the administrator's default period.
  const presetChosen = useRef(!!(fromSearchHasKeys(location.search) || savedExists()));
  const [metaError, setMetaError] = useState(null);
  // Bumped when a sync finishes, so every screen reloads its numbers.
  const [dataVersion, setDataVersion] = useState(0);
  const timer = useRef(null);
  const basisChosen = useRef(!!initial.current.basis);
  const aggChosen = useRef(!!initial.current.agg);

  const setFilters = useCallback((next, immediate = false) => {
    presetChosen.current = true;
    store.set(PRESET_CHOSEN_KEY, '1');
    setFiltersState(next);
    clearTimeout(timer.current);
    if (immediate) setApplied(next); else timer.current = setTimeout(() => setApplied(next), SETTLE_MS);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const loadMeta = useCallback(async () => {
    try {
      const res = await metaAPI.get();
      setMeta(res.data);
      setMetaError(null);
      if (!basisChosen.current) setBasisState(res.data.default_basis || 'assigned');
      if (!aggChosen.current) setAggState(res.data.default_aggregation || 'average');
      const wanted = res.data.ui?.default_preset;
      if (!presetChosen.current && wanted && VALID_PRESETS.has(wanted) && wanted !== 'custom') {
        presetChosen.current = true;
        setFiltersState(f => (f.preset === 'all' ? { ...f, preset: wanted } : f));
        setApplied(f => (f.preset === 'all' ? { ...f, preset: wanted } : f));
      }
    } catch (error) { setMetaError(error.message || 'Could not load the filter options'); }
  }, []);

  useEffect(() => { if (user && !user.must_change_password) loadMeta(); }, [user, loadMeta, dataVersion]);

  const setBasis = useCallback(value => { basisChosen.current = true; setBasisState(value); }, []);
  const setAgg = useCallback(value => { aggChosen.current = true; setAggState(value); }, []);
  const bumpData = useCallback(() => setDataVersion(v => v + 1), []);
  const reset = useCallback(() => setFilters(DEFAULT_FILTERS, true), [setFilters]);

  // Keep the address and the saved copy in step with the filters on the analytics pages.
  const defaultBasis = meta?.default_basis || 'assigned';
  const defaultAgg = meta?.default_aggregation || 'average';
  const search = location.search;
  const path = location.pathname;
  useEffect(() => {
    writeSaved(applied);
    if (!isAnalytic(path)) return;
    const wanted = toSearch(applied, basis, defaultBasis, agg, defaultAgg, search);
    if (wanted !== search) navigate({ pathname: path, search: wanted }, { replace: true, state: location.state });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, basis, defaultBasis, agg, defaultAgg, path, search]);

  // Query-string parameters for the API. `withTechnicians: false` for the technician profile, which picks its own technician.
  const buildParams = useCallback((withTechnicians = true) => {
    const params = { basis, ...dateRange(applied) };
    if (withTechnicians && applied.technicians.length) params.technician = joinList(applied.technicians);
    if (applied.categories.length) params.category = joinList(applied.categories);
    if (applied.priorities.length) params.priority = joinList(applied.priorities);
    if (applied.groups.length) params.group = joinList(applied.groups);
    if (applied.requestTypes.length) params.request_type = joinList(applied.requestTypes);
    if (applied.statuses.length) params.status = joinList(applied.statuses);
    return params;
  }, [applied, basis]);

  // The filters in words, for the footer of a downloaded picture and the second line of an Excel file.
  const describe = useCallback((withTechnicians = true) => {
    const p = buildParams(withTechnicians);
    const parts = [BASES.find(b => b.value === basis).long];
    if (p.from || p.to) parts.push(`closed ${p.from ? `from ${dayjs(p.from).format('DD-MMM-YYYY')}` : ''}${p.to ? ` to ${dayjs(p.to).format('DD-MMM-YYYY')}` : ''}`.trim());
    if (p.technician) parts.push(`technician: ${p.technician.split('||').join(', ')}`);
    if (p.category) parts.push(`category: ${p.category.split('||').join(', ')}`);
    if (p.priority) parts.push(`priority: ${p.priority.split('||').join(', ')}`);
    if (p.group) parts.push(`group: ${p.group.split('||').join(', ')}`);
    if (p.request_type) parts.push(`type: ${p.request_type.split('||').join(', ')}`);
    if (p.status) parts.push(`status: ${p.status.split('||').join(', ')}`);
    return parts.join(' | ');
  }, [buildParams, basis]);

  const value = useMemo(() => ({
    filters, applied, setFilters, reset, basis, setBasis, agg, setAgg, meta, metaError, buildParams, describe, dataVersion, bumpData, reloadMeta: loadMeta,
    settling: filters !== applied,
  }), [filters, applied, setFilters, reset, basis, setBasis, agg, setAgg, meta, metaError, buildParams, describe, dataVersion, bumpData, loadMeta]);

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

export const useFilters = () => useContext(FiltersContext);
