const ExcelJS = require('exceljs');
const analytics = require('./analytics');
const settings = require('./settings');

// Names, prefixes and limits come from the settings (Admin -> Settings -> Identity / Reports). With the defaults the files are
// exactly what they always were.
const appName = () => settings.str('app_name') || 'ManageEngine Analytics';
const titled = title => { const prefix = settings.str('report_title_prefix'); return prefix ? `${prefix} ${title}` : String(title); };
const targetDays = () => analytics.cfg().targets;
const staleDays = () => analytics.cfg().stale;
const dayWord = analytics.dayWord;
// 60 -> "1 hour", 1440 -> "1 day", 45 -> "45 min"
function minutesWord(m) {
  if (m % 1440 === 0) return dayWord(m / 1440);
  if (m % 60 === 0) return `${m / 60} hour${m / 60 === 1 ? '' : 's'}`;
  return `${m} min`;
}

// Excel reports, built on the server so every figure comes from the same code that draws the screens, and so each report
// can be tested by reading the finished file back. Cells are typed (real numbers and dates), headers are frozen, every
// sheet has filter arrows, and column widths fit their content.

// A request the caller got wrong (bad table data): answered with 400 and this message.
class ReportInputError extends Error {
  constructor(message) { super(message); this.status = 400; this.expose = true; }
}

const BRAND = 'FF4338CA';
const HEADER_TEXT = 'FFFFFFFF';
const BAND = 'FFF3F4FB';
const MAX_CELL_CHARS = 32000;
const MAX_COLUMN_WIDTH = 60;
// eslint-disable-next-line no-control-regex
const ILLEGAL_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const FORMATS = {
  text: null,
  int: '#,##0',
  decimal: '#,##0.00',
  pct: '0.0"%"',
  days: '#,##0.00',
  datetime: 'dd-mmm-yyyy hh:mm',
  date: 'dd-mmm-yyyy',
};

function cleanText(value) {
  const text = String(value).replace(ILLEGAL_XML, '');
  return text.length > MAX_CELL_CHARS ? `${text.slice(0, MAX_CELL_CHARS)}...` : text;
}

// A wall-clock string ("YYYY-MM-DD HH:MM:SS") becomes a Date holding the same wall-clock time in UTC, so Excel shows exactly
// what ManageEngine shows, whatever timezone the reader's computer is in.
function wallClockDate(value) {
  if (!value) return null;
  const text = String(value).trim().replace(' ', 'T');
  const ms = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : `${text}Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function cellValue(value, type) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'datetime' || type === 'date') return wallClockDate(value);
  if (type === 'int' || type === 'decimal' || type === 'pct' || type === 'days') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return cleanText(value);
}

const sheetNameOf = (name, used) => {
  let base = String(name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = base;
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = `${base.slice(0, 31 - String(i).length - 1)} ${i}`;
  used.add(candidate.toLowerCase());
  return candidate;
};

// sheet: { name, columns: [{ label, type?, width? }], rows: [[...cells]] }
// Workbooks are written with ExcelJS's streaming writer: each row is styled, written to the zip and released, so a 60,000-row,
// 40-column report needs a few hundred MB less memory than building the whole sheet model first (which took ~2 GB). Because the
// column widths sit before the rows in the file, they are worked out in a first pass over the values, then the rows are written.
// Optional per-sheet extras for the summary sheet: rowTypes (a number format per row for column 2), plain (no banding, no filter arrows).
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
const BAND_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
const HEADER_FONT = { bold: true, color: { argb: HEADER_TEXT } };
const HEADER_ALIGN = { vertical: 'middle', wrapText: true };
const BOLD = { bold: true };
const VALUE_ALIGN = { horizontal: 'left', wrapText: true };

function newWorkbook(title, stream) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: true, zip: { zlib: { level: 4 } }, creator: appName(), lastModifiedBy: appName() });
  workbook.title = titled(title);
  return workbook;
}

const sharedStyles = new Map();
function sharedStyle(numFmt, banded, bold, valueAlign) {
  const key = `${numFmt || ''}|${banded ? 1 : 0}|${bold ? 1 : 0}|${valueAlign ? 1 : 0}`;
  let style = sharedStyles.get(key);
  if (!style) {
    style = {};
    if (numFmt) style.numFmt = numFmt;
    if (bold) style.font = BOLD;
    if (valueAlign) style.alignment = VALUE_ALIGN;
    if (banded) style.fill = BAND_FILL;
    sharedStyles.set(key, style);
  }
  return style;
}

function writeSheet(workbook, sheet, used) {
  const ws = workbook.addWorksheet(sheetNameOf(sheet.name, used), { views: [{ state: 'frozen', ySplit: 1 }] });
  const columns = sheet.columns.map(c => (typeof c === 'string' ? { label: c, type: 'text' } : { type: 'text', ...c }));
  const typeOf = (rowIndex, i) => (i === 1 && sheet.rowTypes ? sheet.rowTypes[rowIndex] : columns[i].type);

  // Pass 1: column widths from the longest value in each column.
  const widths = columns.map(c => Math.min(MAX_COLUMN_WIDTH, Math.max(10, String(c.label).length + 3)));
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    for (let i = 0; i < columns.length; i++) {
      const value = cellValue(row[i], typeOf(r, i));
      if (value instanceof Date) widths[i] = Math.max(widths[i], 19);
      else if (value !== null) widths[i] = Math.min(MAX_COLUMN_WIDTH, Math.max(widths[i], String(value).length + 2));
    }
  }
  ws.columns = columns.map((c, i) => ({ header: cleanText(c.label), width: (i === 0 && sheet.firstColumnWidth) || c.width || widths[i] }));

  const header = ws.getRow(1);
  header.height = 22;
  header.eachCell(cell => {
    cell.font = HEADER_FONT;
    cell.fill = HEADER_FILL;
    cell.alignment = HEADER_ALIGN;
  });
  header.commit();

  // Pass 2: the rows.
  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r];
    const excelRow = ws.addRow(columns.map((_, i) => cellValue(row[i], typeOf(r, i))));
    const banded = !sheet.plain && r % 2 === 1;
    for (let i = 0; i < columns.length; i++) {
      // One shared style object per combination: ExcelJS recognises a style it has seen and skips re-encoding it for every cell.
      excelRow.getCell(i + 1).style = sharedStyle(FORMATS[typeOf(r, i)], banded, sheet.plain && i === 0, sheet.plain && i === 1);
    }
    excelRow.commit();
  }
  if (columns.length && !sheet.plain) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return ws.commit();
}

// Writes the workbook into memory and returns it as a Buffer.
async function finishWorkbook(title, sheets) {
  const chunks = [];
  const stream = new (require('stream').Writable)({ write(chunk, _enc, done) { chunks.push(chunk); done(); } });
  const workbook = newWorkbook(title, stream);
  const done = new Promise((resolve, reject) => { stream.on('finish', resolve); stream.on('error', reject); });
  const used = new Set();
  for (const sheet of sheets) writeSheet(workbook, sheet, used);
  await workbook.commit();
  await done;
  return Buffer.concat(chunks);
}

async function buildWorkbook({ title, sheets }) {
  if (!sheets.length) throw new ReportInputError('Nothing to export');
  return finishWorkbook(title, sheets);
}

// ── Safe filenames ──
function filenameFor(base) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = String(base || 'Report').replace(/[^A-Za-z0-9._ -]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'Report';
  const prefix = settings.str('report_file_prefix');
  return `${prefix ? `${prefix}_` : ''}${safe}_${stamp}.xlsx`;
}

// ── Pieces shared by the reports ──
const days = minutes => (minutes === null || minutes === undefined ? null : Math.round((minutes / analytics.DAY_MINUTES) * 100) / 100);
const basisLabel = basis => (basis === 'raised' ? 'Since the SR was raised' : 'Since the SR was assigned to the technician');

function describeFilters(filters) {
  const parts = [];
  if (filters.from || filters.to) parts.push(`Closed ${filters.from ? `from ${filters.from}` : ''}${filters.to ? ` to ${filters.to}` : ''}`.trim());
  if (filters.technicians.length) parts.push(`Technician: ${filters.technicians.join(', ')}`);
  if (filters.categories.length) parts.push(`Category: ${filters.categories.join(', ')}`);
  if (filters.priorities.length) parts.push(`Priority: ${filters.priorities.join(', ')}`);
  if (filters.groups.length) parts.push(`Group: ${filters.groups.join(', ')}`);
  if (filters.requestTypes.length) parts.push(`Type: ${filters.requestTypes.join(', ')}`);
  if (filters.statuses.length) parts.push(`Status: ${filters.statuses.join(', ')}`);
  if (filters.search) parts.push(`Search: ${filters.search}`);
  return parts.length ? parts.join(' | ') : 'None (all SRs, all time)';
}

function summaryRows(s) {
  const [t1, t2, t3] = targetDays();
  return [
    ['SRs assigned (closed + open)', s.assigned, 'int'], ['SRs closed', s.closed, 'int'], ['Closed with a measurable turnaround', s.measured, 'int'],
    ['Closure rate (%)', s.closure_rate_pct, 'pct'],
    ['Average time to close (days)', days(s.avg_minutes), 'days'], ['Median (days)', days(s.median_minutes), 'days'],
    ['90th percentile (days)', days(s.p90_minutes), 'days'], ['Fastest (days)', days(s.min_minutes), 'days'], ['Fastest SR', s.fastest_sr, 'text'],
    ['Slowest (days)', days(s.max_minutes), 'days'], ['Slowest SR', s.slowest_sr, 'text'],
    [`Closed within ${dayWord(t1)} (%)`, s.within_1d_pct, 'pct'], [`Closed within ${dayWord(t2)} (%)`, s.within_3d_pct, 'pct'], [`Closed within ${dayWord(t3)} (%)`, s.within_7d_pct, 'pct'],
    ['Closed by the ManageEngine due time (%)', s.sla_met_pct, 'pct'], ['Closed SRs that have a due time', s.sla_measured, 'int'],
    ['Open now', s.open, 'int'], ['Average age of open SRs (days)', days(s.open_avg_age_minutes), 'days'], ['Oldest open (days)', days(s.open_oldest_minutes), 'days'],
    ['Overdue', s.overdue, 'int'], ['On hold', s.on_hold, 'int'], ['Waiting on the requester', s.waiting_on_user, 'int'],
  ];
}

// A "Measure | Value" sheet that carries per-row number formats, so each value displays correctly.
function summarySheet(title, filters, generatedAt, pairs, extraRows = []) {
  const rows = [
    ['Report', titled(title), 'text'], ['Time measured', basisLabel(filters.basis), 'text'], ['Filters applied', describeFilters(filters), 'text'],
    ['Generated', generatedAt, 'datetime'], ...extraRows, ...pairs,
  ];
  return { name: 'Summary', columns: ['Measure', { label: 'Value', type: 'text', width: 46 }], rows: rows.map(([m, v]) => [m, v]), rowTypes: rows.map(r => r[2]), plain: true, firstColumnWidth: 42 };
}

// ManageEngine only sets due times when SLAs are configured. When the portal has none, columns, rows and sheets about them are left out
// rather than filled with blanks.
const isDueLabel = label => /due time|due-time|overdue/i.test(String(label));
function withoutDueTimes({ summary, sheets }) {
  const keepRow = row => !isDueLabel(row[0]);
  const prunedSummary = { ...summary, rows: summary.rows.filter(keepRow), rowTypes: summary.rowTypes.filter((_, i) => keepRow(summary.rows[i])) };
  const prunedSheets = sheets.filter(sh => !isDueLabel(sh.name)).map(sh => {
    const labels = sh.columns.map(c => (typeof c === 'string' ? c : c.label));
    const isMeasureSheet = labels[0] === 'Measure';
    if (isMeasureSheet) return { ...sh, rows: sh.rows.filter(keepRow) };
    const drop = new Set(labels.map((l, i) => (isDueLabel(l) ? i : -1)).filter(i => i >= 0));
    if (!drop.size) return sh;
    return { ...sh, columns: sh.columns.filter((_, i) => !drop.has(i)), rows: sh.rows.map(r => r.filter((_, i) => !drop.has(i))) };
  });
  return { summary: prunedSummary, sheets: prunedSheets };
}

async function buildWithSummary({ title, summary, sheets, dueTimes = true }) {
  if (!dueTimes) ({ summary, sheets } = withoutDueTimes({ summary, sheets }));
  return finishWorkbook(title, [summary, ...sheets]);
}

// Handling figures for a Summary sheet. Blank-safe: when no history is collected yet, one explanatory line replaces them.
function handlingRows(h) {
  if (!h || !h.covered) return [['SR history', 'Not collected yet (Data & sync > Collect SR history)', 'text']];
  const [r1, r2] = analytics.cfg().replyTargets;
  const [q1, q2] = staleDays();
  return [
    ['SRs with history collected', h.covered, 'int'], ['History coverage (%)', h.coverage_pct, 'pct'],
    ['Reassigned at least once (SRs)', h.reassigned, 'int'], ['Reassigned at least once (%)', h.reassigned_pct, 'pct'],
    ['Average reassignments per SR', h.avg_reassignments, 'text'], ['Most reassignments on one SR', h.max_reassignments, 'int'],
    ['Reopened after closing (SRs)', h.reopened, 'int'], ['Reopened after closing (%)', h.reopened_pct, 'pct'],
    ['First-contact resolution (%)', h.fcr_pct, 'pct'],
    ['Average time to first reply (min)', h.avg_first_response_minutes, 'int'], ['Median time to first reply (min)', h.median_first_response_minutes, 'int'],
    [`First reply within ${minutesWord(r1)} (%)`, h.response_within_1h_pct, 'pct'], [`First reply within ${minutesWord(r2)} (%)`, h.response_within_1d_pct, 'pct'],
    ['Average time to first assignment (min)', h.avg_time_to_assign_minutes, 'int'], ['Median time to first assignment (min)', h.median_time_to_assign_minutes, 'int'],
    ['Average technician replies per SR', h.avg_tech_replies, 'text'], ['Average requester replies per SR', h.avg_requester_replies, 'text'],
    ['SRs with work logged (%)', h.worklog_pct, 'pct'], ['Total work logged (hours)', Math.round((h.total_worklog_minutes / 60) * 10) / 10, 'text'],
    ['Closed SRs that were on hold (%)', h.on_hold_pct, 'pct'], ['Average active turnaround (days)', days(h.avg_active_minutes), 'days'],
    [`Open SRs idle for ${q1}+ days`, h.stale_7d, 'int'], [`Open SRs idle for ${q2}+ days`, h.stale_14d, 'int'],
  ];
}

const handlingSheets = (data, extra = []) => [
  { name: 'Reassignments', columns: ['Times reassigned', { label: 'SRs', type: 'int' }, { label: 'Share (%)', type: 'pct' }], rows: data.handling.reassignments.map(b => [b.label, b.count, b.pct]) },
  { name: 'First reply time', columns: ['First reply within', { label: 'SRs', type: 'int' }, { label: 'Share (%)', type: 'pct' }], rows: data.handling.responses.map(b => [b.label, b.count, b.pct]) },
  { name: 'Idle open SRs', columns: ['No activity for', { label: 'Open SRs', type: 'int' }, { label: 'Share (%)', type: 'pct' }], rows: data.handling.idle.map(b => [b.label, b.count, b.pct]) },
  { name: 'Handling by month', columns: ['Month closed', { label: 'SRs closed', type: 'int' }, { label: 'Reassigned (%)', type: 'pct' }, { label: 'Reopened (%)', type: 'pct' },
    { label: 'Average reassignments', type: 'text' }, { label: 'Median first reply (min)', type: 'int' }],
  rows: data.handling.trend.map(r => [r.key, r.closed, r.reassigned_pct, r.reopened_pct, r.avg_reassignments, r.median_first_response_minutes]) },
  ...extra,
];

const GROUP_COLUMNS = label => [label, { label: 'SRs closed', type: 'int' }, { label: 'Open now', type: 'int' }, { label: 'Average (days)', type: 'days' },
  { label: 'Median (days)', type: 'days' }, { label: '90th percentile (days)', type: 'days' }, { label: 'Closed by due time (%)', type: 'pct' }];
const groupRow = r => [r.key, r.closed, r.open, days(r.avg_minutes), days(r.median_minutes), days(r.p90_minutes), r.sla_met_pct];

const SR_COLUMNS = [
  { label: 'SR No', type: 'int' }, 'Subject', 'Technician', 'Category', 'Subcategory', 'Priority', 'Group', 'Site', 'Request type', 'Mode',
  'Status', 'ManageEngine status', 'Requester',
  { label: 'Raised', type: 'datetime' }, { label: 'Assigned to technician', type: 'datetime' }, { label: 'Clock started', type: 'datetime' },
  { label: 'Closed', type: 'datetime' }, { label: 'Due by', type: 'datetime' },
  { label: 'Turnaround (days)', type: 'days' }, 'Turnaround', { label: 'Open for (days)', type: 'days' }, 'Overdue', 'Closed by due time',
  // From the SR's change log (blank until its history has been collected)
  { label: 'Reassignments', type: 'int' }, { label: 'Technicians involved', type: 'int' }, 'Handover path', 'First assigned by',
  { label: 'Time to assign (min)', type: 'int' }, { label: 'First response (min)', type: 'int' },
  { label: 'Technician replies', type: 'int' }, { label: 'Requester replies', type: 'int' }, { label: 'Times reopened', type: 'int' },
  'First-contact resolution', 'Closed by', 'Closure code', { label: 'Work logged (min)', type: 'int' }, { label: 'Notes', type: 'int' },
  { label: 'Time on hold (days)', type: 'days' }, { label: 'Active time (days)', type: 'days' }, { label: 'Idle (days, open SRs)', type: 'days' },
  { label: 'Last activity', type: 'datetime' },
];

const srRow = r => [
  /^\d{1,15}$/.test(String(r.sr_number)) ? Number(r.sr_number) : null, r.description, r.technician, r.category, r.subcategory, r.priority, r.group, r.site,
  r.request_type, r.mode, r.status, r.manageengine_status, r.requester, r.raised_at, r.assigned_at, r.start_at, r.closed_at, r.due_by,
  days(r.tat_minutes), r.tat_minutes === null ? null : analytics.fmtDuration(r.tat_minutes), days(r.age_minutes),
  r.overdue ? 'Yes' : '', r.sla_met === null ? '' : r.sla_met ? 'Yes' : 'No',
  r.reassignments, r.technicians_involved, r.path ? r.path.join(' > ') : null, r.first_assigned_by, r.time_to_assign_minutes, r.first_response_minutes,
  r.tech_replies, r.requester_replies, r.reopens, r.fcr === null || r.fcr === undefined ? '' : r.fcr ? 'Yes' : 'No', r.closed_by, r.closure_code,
  r.worklog_minutes, r.notes_count, days(r.hold_minutes), days(r.active_minutes), days(r.idle_minutes), r.last_activity_at,
];

async function srSheet(filters, drill) {
  const data = await analytics.buildRecords(filters, { pageSize: 0, drill });
  const cap = settings.num('report_max_sr_rows');
  const kept = data.records.length > cap ? data.records.slice(0, cap) : data.records;
  const limited = kept.length < data.records.length ? [['Rows limited', `Only the first ${kept.length.toLocaleString('en-US')} of ${data.records.length.toLocaleString('en-US')} SRs are listed (the report row limit in Admin > Settings)`, 'text']] : [];
  return { generated_at: data.generated_at, sheet: { name: 'All SRs', columns: SR_COLUMNS, rows: kept.map(srRow) }, total: data.total, limited };
}

// ── Reports ──
async function dashboardReport(filters) {
  const data = await analytics.buildOverview(filters);
  const sr = await srSheet(filters);
  const buckets = rows => rows.map(b => [b.label, b.count, b.pct]);
  const heat = data.closure_heatmap;
  const matrix = data.technician_months;
  return buildWithSummary({
    dueTimes: analytics.hasDueTimes(data.summary),
    title: 'Team dashboard',
    summary: summarySheet('Team dashboard', filters, data.generated_at, [...summaryRows(data.summary), ...handlingRows(data.handling.summary), ...sr.limited]),
    sheets: [
      {
        name: 'Technicians',
        columns: ['Technician', { label: 'Assigned (closed + open)', type: 'int' }, { label: 'SRs closed', type: 'int' }, { label: 'Closure rate (%)', type: 'pct' },
          { label: 'Average (days)', type: 'days' }, { label: 'Median (days)', type: 'days' }, { label: '90th percentile (days)', type: 'days' },
          { label: 'Fastest (days)', type: 'days' }, { label: 'Slowest (days)', type: 'days' }, { label: `Closed within ${dayWord(targetDays()[1])} (%)`, type: 'pct' },
          { label: 'Closed by due time (%)', type: 'pct' }, { label: 'Open now', type: 'int' }, { label: 'Overdue', type: 'int' },
          { label: 'On hold', type: 'int' }, { label: 'Waiting on requester', type: 'int' }, { label: 'Oldest open (days)', type: 'days' },
          { label: 'Reassigned (%)', type: 'pct' }, { label: 'Average reassignments', type: 'text' }, { label: 'Reopened (%)', type: 'pct' },
          { label: 'First-contact resolution (%)', type: 'pct' }, { label: 'Median first reply (min)', type: 'int' }, { label: 'Average active time (days)', type: 'days' },
          { label: `Open SRs idle ${staleDays()[0]}+ days`, type: 'int' }],
        rows: data.technicians.map(t => [t.key, t.assigned, t.closed, t.closure_rate_pct, days(t.avg_minutes), days(t.median_minutes), days(t.p90_minutes),
          days(t.min_minutes), days(t.max_minutes), t.within_3d_pct, t.sla_met_pct, t.open, t.overdue, t.on_hold, t.waiting_on_user, days(t.open_oldest_minutes),
          t.handling.reassigned_pct, t.handling.avg_reassignments, t.handling.reopened_pct, t.handling.fcr_pct, t.handling.median_first_response_minutes,
          days(t.handling.avg_active_minutes), t.handling.stale_7d]),
      },
      ...handlingSheets(data),
      { name: 'By month closed', columns: GROUP_COLUMNS('Month'), rows: data.trend.map(groupRow) },
      { name: 'Weekly flow', columns: ['Week starting', { label: 'SRs started', type: 'int' }, { label: 'SRs closed', type: 'int' }, { label: 'Backlog at week end', type: 'int' }],
        rows: data.flow.map(w => [w.key, w.assigned, w.closed, w.backlog]) },
      { name: 'By category', columns: GROUP_COLUMNS('Category'), rows: data.categories.map(groupRow) },
      { name: 'By priority', columns: GROUP_COLUMNS('Priority'), rows: data.priorities.map(groupRow) },
      { name: 'By group', columns: GROUP_COLUMNS('Group'), rows: data.groups.map(groupRow) },
      { name: 'By request type', columns: GROUP_COLUMNS('Request type'), rows: data.request_types.map(groupRow) },
      { name: 'Status mix', columns: ['Status', { label: 'SRs', type: 'int' }], rows: data.statuses.map(s => [s.key, s.count]) },
      { name: 'Time to close', columns: ['Closed within', { label: 'SRs', type: 'int' }, { label: 'Share (%)', type: 'pct' }], rows: buckets(data.distribution) },
      { name: 'Open SR ageing', columns: ['Open for', { label: 'SRs', type: 'int' }, { label: 'Share (%)', type: 'pct' }], rows: buckets(data.aging) },
      { name: 'Due-time performance', columns: ['Outcome', { label: 'SRs', type: 'int' }],
        rows: [['Closed by the due time', data.sla.met], ['Closed after the due time', data.sla.missed], ['No due time recorded', data.sla.no_due_date]] },
      { name: 'Closed by weekday and hour', columns: ['Day', ...Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}:00`, type: 'int' }))],
        rows: heat.days.map((d, i) => [d, ...heat.grid[i]]) },
      { name: 'Technician by month', columns: ['Technician', ...matrix.months.map(m => ({ label: `${m} closed`, type: 'int' })), { label: 'Total closed', type: 'int' }],
        rows: matrix.rows.map(r => [r.technician, ...matrix.months.map(m => r.months[m]?.closed ?? 0), r.total]) },
      sr.sheet,
    ],
  }).then(buffer => ({ buffer, filename: filenameFor('Team_Dashboard') }));
}

async function technicianReport(name, filters) {
  const data = await analytics.buildTechnician(name, { ...filters, technicians: [] });
  if (!data) return null;
  const tFilters = { ...filters, technicians: [data.technician.name] };
  const sr = await srSheet(tFilters);
  const s = data.summary;
  const t = data.team;
  const buckets = (mine, team) => mine.map((b, i) => [b.label, b.count, b.pct, team[i].pct]);
  const teamTrend = new Map(data.team_trend.map(r => [r.key, r]));
  const comparison = [
    ['SRs closed', s.closed, t.closed, 'int'], ['Average time to close (days)', days(s.avg_minutes), days(t.avg_minutes), 'days'],
    ['Median (days)', days(s.median_minutes), days(t.median_minutes), 'days'], ['90th percentile (days)', days(s.p90_minutes), days(t.p90_minutes), 'days'],
    [`Closed within ${dayWord(targetDays()[1])} (%)`, s.within_3d_pct, t.within_3d_pct, 'pct'], ['Closed by the due time (%)', s.sla_met_pct, t.sla_met_pct, 'pct'],
    ['Open now', s.open, t.open, 'int'], ['Overdue', s.overdue, t.overdue, 'int'],
  ];
  const buffer = await buildWithSummary({
    dueTimes: data.has_due_times,
    title: `Technician: ${data.technician.name}`,
    summary: summarySheet(`Technician: ${data.technician.name}`, tFilters, data.generated_at, [...summaryRows(s), ...handlingRows(data.handling.summary), ['SRs handed over to others', data.handovers.handed_away, 'int'], ['SRs received from others', data.handovers.received, 'int'], ...sr.limited], [
      ['Technician', data.technician.name, 'text'], ['Email', data.technician.email, 'text'],
      ['Rank by SRs closed', data.ranks.closed ? `${data.ranks.closed.rank} of ${data.ranks.closed.of}` : 'Not ranked (too few SRs)', 'text'],
      ['Rank by average turnaround', data.ranks.avg ? `${data.ranks.avg.rank} of ${data.ranks.avg.of}` : 'Not ranked (too few SRs)', 'text'],
      ['Rank by median turnaround', data.ranks.median ? `${data.ranks.median.rank} of ${data.ranks.median.of}` : 'Not ranked (too few SRs)', 'text'],
      [`Rank (${data.ranks.target_label})`, data.ranks.target ? `${data.ranks.target.rank} of ${data.ranks.target.of}` : 'Not ranked (too few SRs)', 'text'],
    ]),
    sheets: [
      { name: 'Versus team', columns: ['Measure', 'Technician', 'Team (same filters)'], rows: comparison.map(([m, a, b]) => [m, a, b]) },
      { name: 'Insights', columns: ['Tone', 'Observation'], rows: data.insights.map(i => [i.tone, i.text]) },
      ...handlingSheets(data, [
        { name: 'Handovers', columns: ['Direction', 'Technician', { label: 'SRs', type: 'int' }],
          rows: [...data.handovers.handed_to.map(r => ['Handed over to', r.key, r.count]), ...data.handovers.received_from.map(r => ['Received from', r.key, r.count])] },
        { name: 'Handling vs team', columns: ['Measure', 'Technician', 'Team (same filters)'], rows: [
          ['Reassigned (%)', data.handling.summary.reassigned_pct, data.team_handling.reassigned_pct], ['Average reassignments', data.handling.summary.avg_reassignments, data.team_handling.avg_reassignments],
          ['Reopened (%)', data.handling.summary.reopened_pct, data.team_handling.reopened_pct], ['First-contact resolution (%)', data.handling.summary.fcr_pct, data.team_handling.fcr_pct],
          ['Average first reply (min)', data.handling.summary.avg_first_response_minutes, data.team_handling.avg_first_response_minutes],
          ['Median first reply (min)', data.handling.summary.median_first_response_minutes, data.team_handling.median_first_response_minutes],
          ['Average time to assign (min)', data.handling.summary.avg_time_to_assign_minutes, data.team_handling.avg_time_to_assign_minutes],
          ['Median time to assign (min)', data.handling.summary.median_time_to_assign_minutes, data.team_handling.median_time_to_assign_minutes],
          ['Average active time (days)', days(data.handling.summary.avg_active_minutes), days(data.team_handling.avg_active_minutes)],
        ] },
      ]),
      { name: 'By month closed', columns: [...GROUP_COLUMNS('Month'), { label: 'Team average (days)', type: 'days' }],
        rows: data.trend.map(r => [...groupRow(r), days(teamTrend.get(r.key)?.avg_minutes)]) },
      { name: 'Weekly flow', columns: ['Week starting', { label: 'SRs started', type: 'int' }, { label: 'SRs closed', type: 'int' }, { label: 'Backlog at week end', type: 'int' }],
        rows: data.flow.map(w => [w.key, w.assigned, w.closed, w.backlog]) },
      { name: 'By category', columns: [...GROUP_COLUMNS('Category'), { label: 'Team average (days)', type: 'days' }], rows: data.categories.map(r => [...groupRow(r), days(r.team_avg_minutes)]) },
      { name: 'By priority', columns: GROUP_COLUMNS('Priority'), rows: data.priorities.map(groupRow) },
      { name: 'By group', columns: GROUP_COLUMNS('Group'), rows: data.groups.map(groupRow) },
      { name: 'Time to close', columns: ['Closed within', { label: 'SRs', type: 'int' }, { label: 'Share (%)', type: 'pct' }, { label: 'Team share (%)', type: 'pct' }], rows: buckets(data.distribution, data.team_distribution) },
      { name: 'Open SR ageing', columns: ['Open for', { label: 'SRs', type: 'int' }, { label: 'Share (%)', type: 'pct' }], rows: data.aging.map(b => [b.label, b.count, b.pct]) },
      { name: 'Status mix', columns: ['Status', { label: 'SRs', type: 'int' }], rows: data.statuses.map(x => [x.key, x.count]) },
      { name: 'Closed by weekday and hour', columns: ['Day', ...Array.from({ length: 24 }, (_, h) => ({ label: `${String(h).padStart(2, '0')}:00`, type: 'int' }))],
        rows: data.closure_heatmap.days.map((d, i) => [d, ...data.closure_heatmap.grid[i]]) },
      sr.sheet,
    ],
  });
  return { buffer, filename: filenameFor(`Technician_${data.technician.name}`) };
}

async function recordsReport(filters, drill, title = 'SR list') {
  const sr = await srSheet(filters, drill);
  const data = await analytics.buildRecords(filters, { pageSize: 1, drill });
  const buffer = await buildWithSummary({
    title,
    summary: summarySheet(title, filters, sr.generated_at, [
      ['SRs in this report', sr.total, 'int'], ['Closed', data.stats.closed, 'int'], ['Open', data.stats.open, 'int'],
      ['Average time to close (days)', days(data.stats.avg_minutes), 'days'], ['Median (days)', days(data.stats.median_minutes), 'days'], ...sr.limited,
    ]),
    sheets: [sr.sheet],
  });
  return { buffer, filename: filenameFor(title) };
}

// Any table a chart or screen shows. The browser sends the rows it is displaying; they are validated and written the same way.
// (limits: report_max_sheets, report_max_rows and report_max_columns in Admin -> Settings)

function validateTables(body) {
  if (!body || typeof body !== 'object') throw new ReportInputError('Nothing to export');
  const MAX_SHEETS = settings.num('report_max_sheets');
  const MAX_ROWS = settings.num('report_max_rows');
  const MAX_COLS = settings.num('report_max_columns');
  const sheets = Array.isArray(body.sheets) ? body.sheets : [];
  if (!sheets.length || sheets.length > MAX_SHEETS) throw new ReportInputError(`A report needs between 1 and ${MAX_SHEETS} sheets`);
  let rowCount = 0;
  const clean = sheets.map(sheet => {
    const columns = Array.isArray(sheet?.columns) ? sheet.columns.map(c => cleanText(c)).slice(0, MAX_COLS) : [];
    const rows = Array.isArray(sheet?.rows) ? sheet.rows : [];
    if (!columns.length) throw new ReportInputError('Every sheet needs column names');
    rowCount += rows.length;
    if (rowCount > MAX_ROWS) throw new ReportInputError('Too many rows to export');
    return {
      name: cleanText(sheet?.name || 'Data'),
      columns: columns.map(label => ({ label, type: 'text' })),
      rows: rows.map(row => (Array.isArray(row) ? row.slice(0, columns.length) : [])),
    };
  });
  return { title: cleanText(body.title || 'Chart data'), note: body.note ? cleanText(body.note) : null, sheets: clean };
}

async function tablesReport(body) {
  const { title, note, sheets } = validateTables(body);
  const first = sheets[0];
  const info = {
    name: 'About',
    columns: ['Item', { label: 'Detail', width: 60 }],
    rows: [['Report', titled(title)], ['Generated', new Date().toISOString().slice(0, 16).replace('T', ' ')], ...(note ? [['Filters', note]] : []), ['Source', appName()]],
  };
  const buffer = await buildWorkbook({ title, sheets: [first, ...sheets.slice(1), info] });
  return { buffer, filename: filenameFor(title) };
}

// One SR in full: its details, the figures from its change log, and the complete timeline.
async function requestReport(id) {
  const sr = await analytics.buildRequest(id);
  if (!sr) return null;
  const a = sr.handling.assigned;
  const r = sr.handling.raised;
  const rows = [
    ['SR No', sr.display_id], ['Subject', sr.subject], ['Status', sr.status], ['ManageEngine status', sr.status_name], ['Technician', sr.technician || '(Unassigned)'],
    ['Requester', sr.requester], ['Category', sr.category], ['Subcategory', sr.subcategory], ['Priority', sr.priority], ['Request type', sr.request_type],
    ['Group', sr.group_name], ['Site', sr.site], ['Mode', sr.mode], ['Raised', sr.created_at], ['Assigned to technician', sr.assigned_at],
    ['Completed', sr.completed_at], ['Turnaround since assigned (days)', days(a.tat_minutes)], ['Turnaround since raised (days)', days(r.tat_minutes)],
    ['Active time since assigned (days)', days(a.active_minutes)], ['Time on hold (days)', days(a.hold_minutes)],
    ['Reassignments', a.reassignments], ['Technicians involved', a.technicians_involved], ['Handover path', a.path ? a.path.join(' > ') : null],
    ['First assigned by', a.first_assigned_by], ['Time to first assignment (min)', a.time_to_assign_minutes],
    ['First reply, from assignment (min)', a.first_response_minutes], ['First reply, from raised (min)', r.first_response_minutes],
    ['Technician replies', a.tech_replies], ['Requester replies', a.requester_replies], ['Times reopened', a.reopens],
    ['First-contact resolution', a.fcr === null || a.fcr === undefined ? null : a.fcr ? 'Yes' : 'No'], ['Closed by', a.closed_by], ['Closure code', a.closure_code],
    ['Work logged (min)', a.worklog_minutes], ['Notes', a.notes_count], ['Attachments', a.attachments], ['Group changes', a.group_changes],
    ['Priority changes', a.priority_changes], ['Category changes', a.category_changes], ['Idle (days, open SRs)', days(a.idle_minutes)],
  ];
  const buffer = await buildWorkbook({
    title: `SR ${sr.display_id}`,
    sheets: [
      { name: 'SR', columns: [{ label: 'Measure', type: 'text', width: 40 }, { label: 'Value', type: 'text', width: 60 }], rows },
      { name: 'Timeline', columns: [{ label: '#', type: 'int' }, { label: 'When', type: 'datetime' }, 'Event', 'By', 'Detail', 'From', 'To'],
        rows: sr.events.map(e => [e.seq, e.at, e.kind, e.actor, e.summary, e.from_value, e.to_value]) },
    ],
  });
  return { buffer, filename: filenameFor(`SR_${sr.display_id}`) };
}

module.exports = { ReportInputError, requestReport, dashboardReport, technicianReport, recordsReport, tablesReport, buildWorkbook, filenameFor, wallClockDate, validateTables };
