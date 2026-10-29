// One place for the colours charts and inline styles use. Charts are SVG, so they take hex values (not CSS variables), which
// also keeps exported PNG images identical to what is on screen.
//
// The categorical order is the validated data-viz palette (adjacent slots stay distinguishable for colour-blind readers);
// the brand indigo leads single-series charts, and the sequential ramp is one hue, light to dark.
export const BRAND = '#4f46e5';
export const BRAND_DEEP = '#3730a3';
export const INK = '#0f1330';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
export const SERIES_ONE = '#4f46e5';
export const TEAM = '#9aa1c4';

export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
export const STATUS_TEXT = { good: '#006300', warning: '#8a5a00', serious: '#a8481f', critical: '#b02a2a' };

// Sequential blue ramp (step 100 -> 700) for heatmaps.
export const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

export const TEXT = { primary: '#14172e', secondary: '#5b6080', muted: '#646a8c' };
export const GRID = '#e8eaf5';
export const FONT = 'Aptos, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif';

// One colour per status, used wherever a status is drawn.
export const STATUS_COLORS = {
  Open: '#2a78d6',
  'In Progress': '#6250d6',
  Pending: '#eda100',
  'Pending with User': '#e87ba4',
  'On Hold': '#8b90ad',
  Closed: '#1baf7a',
};

export const ANT_STATUS_TAG = {
  Open: 'blue', 'In Progress': 'purple', Pending: 'gold', 'On Hold': 'default', 'Pending with User': 'magenta', Closed: 'green',
};
