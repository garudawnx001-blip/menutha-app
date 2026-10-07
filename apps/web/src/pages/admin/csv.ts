/**
 * A CSV download for the console. Same rules as lib/reportCsv.ts: UTF-8 BOM
 * (so Excel shows ₹ and Kannada correctly), CRLF lines, and any cell starting
 * with = + - or @ is prefixed with an apostrophe so Excel never runs it.
 */
function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(head: string[], rows: (string | number | null | undefined)[][]): string {
  return '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, head: string[], rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob([toCsv(head, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
