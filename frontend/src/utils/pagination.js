// Shared pagination defaults so every table in the app gets the same, fuller pagination bar
// (page-size changer + jump-to-page) instead of each table reinventing - or skipping - it.
// `itemLabel` becomes "N <label>" in the total count (e.g. "88 SRs", "12 users").
//
// IMPORTANT - pass `defaultPageSize`, not `pageSize`, unless the table is genuinely
// server-side controlled (current/pageSize/onChange all wired to real component state, like
// SRPage.jsx). `pageSize` is a *controlled* prop antd resyncs from this object every render;
// since this helper is called fresh inline in JSX (not memoized), a literal `pageSize: N`
// silently snaps the table back to N on the next unrelated re-render - which is exactly what
// made the page-size dropdown look "broken" (a real bug this comment exists to prevent
// reintroducing). `defaultPageSize` only seeds the initial value; antd's Table then owns the
// current page/size internally for anything that doesn't pass `current`+`onChange`.
export function paginationConfig(itemLabel, overrides = {}) {
  return {
    showSizeChanger: true,
    showQuickJumper: true,
    pageSizeOptions: ['10', '20', '50', '100'],
    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} ${itemLabel}`,
    ...overrides,
  };
}

// Lighter variant for small, transient tables (bulk-upload results, PDF-import previews) -
// still gets a size changer, but skips the jump-to-page input, which is more clutter than
// use when there are only ever going to be a couple of pages.
export function compactPaginationConfig(itemLabel, overrides = {}) {
  return {
    showSizeChanger: true,
    pageSizeOptions: ['10', '20', '50'],
    showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} ${itemLabel}`,
    ...overrides,
  };
}
