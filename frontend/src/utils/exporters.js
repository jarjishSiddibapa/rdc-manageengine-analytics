import dayjs from 'dayjs';
import { saveBlob, reportAPI } from '../services/api';
import { FONT, TEXT } from '../theme';

// Every chart and table can be downloaded three ways: as a picture (PNG), as an Excel workbook (built by the server) or as CSV.

const stamp = () => dayjs().format('YYYY-MM-DD');
// The application name for the footer of downloaded pictures (set from the public settings).
let brand = 'ManageEngine Analytics';
export const setExportBrand = name => { if (name) brand = name; };

const safeName = name => String(name || 'chart').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'chart';

// ── CSV ──
// A cell that starts with = + - or @ would run as a formula when the file is opened in Excel, so it is prefixed with a quote.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportCsv({ columns, rows }, filenameBase) {
  const lines = [columns, ...rows].map(row => row.map(csvCell).join(','));
  // The BOM makes Excel read the file as UTF-8.
  saveBlob(new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' }), `${safeName(filenameBase)}_${stamp()}.csv`);
}

// ── Excel (the server writes the workbook) ──
export function exportExcel({ columns, rows }, { title, note, sheetName }) {
  return reportAPI.tables({ title, note, sheets: [{ name: sheetName || title || 'Data', columns, rows }] });
}

// ── PNG ──
// Draws a chart's own <svg> onto a canvas with a title, legend and footer, so the picture stands on its own.
const WIDE = 24;

function biggestSvg(container) {
  const svgs = [...container.querySelectorAll('svg')].filter(s => !s.closest('[data-no-export]'));
  const area = s => { const r = s.getBoundingClientRect(); return r.width * r.height; };
  return svgs.sort((a, b) => area(b) - area(a))[0] || null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The chart could not be turned into a picture'));
    img.src = src;
  });
}

export async function exportPng(container, { title, subtitle, legend = [], note, filename }) {
  const svg = container && biggestSvg(container);
  if (!svg) throw new Error('There is nothing to download yet');
  const box = svg.getBoundingClientRect();
  const width = Math.ceil(box.width);
  const height = Math.ceil(box.height);

  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.style.fontFamily = FONT;
  const xml = new XMLSerializer().serializeToString(clone);
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`);

  const scale = 2;
  const headerHeight = (title ? 26 : 0) + (subtitle ? 20 : 0) + (legend.length ? 28 : 0) + 8;
  const footerHeight = 30;
  const canvasWidth = Math.max(width, 420) + WIDE * 2;
  const canvasHeight = headerHeight + height + footerHeight + WIDE;
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth * scale;
  canvas.height = canvasHeight * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  let y = WIDE;
  ctx.textBaseline = 'top';
  if (title) { ctx.fillStyle = TEXT.primary; ctx.font = `700 16px ${FONT}`; ctx.fillText(title, WIDE, y); y += 26; }
  if (subtitle) { ctx.fillStyle = TEXT.secondary; ctx.font = `400 12px ${FONT}`; ctx.fillText(subtitle, WIDE, y); y += 20; }
  if (legend.length) {
    let x = WIDE;
    ctx.font = `400 12px ${FONT}`;
    for (const item of legend) {
      ctx.fillStyle = item.color;
      ctx.fillRect(x, y + 3, 10, 10);
      ctx.fillStyle = TEXT.secondary;
      ctx.fillText(item.label, x + 16, y + 1);
      x += 16 + ctx.measureText(item.label).width + 18;
    }
    y += 28;
  }
  ctx.drawImage(image, WIDE + Math.max(0, (canvasWidth - WIDE * 2 - width) / 2), y + 4, width, height);
  ctx.fillStyle = TEXT.muted;
  ctx.font = `400 11px ${FONT}`;
  const footer = `${brand} · ${dayjs().format('DD-MMM-YYYY hh:mm A')}${note ? ` · ${note}` : ''}`;
  ctx.fillText(footer.length > 150 ? `${footer.slice(0, 147)}...` : footer, WIDE, canvasHeight - footerHeight + 4);

  const blob = await new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('The picture could not be created'))), 'image/png'));
  saveBlob(blob, `${safeName(filename || title)}_${stamp()}.png`);
}
