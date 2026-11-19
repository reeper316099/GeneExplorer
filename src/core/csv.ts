// CSV writing (RFC 4180 quoting) with protection against spreadsheet formula injection.

/** Escapes one cell. Text starting with = + - @ tab or CR is prefixed with an apostrophe so spreadsheets do not run it as a formula. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Builds a CSV file: optional "# comment" header lines (source, date, app version), then the rows. */
export function toCsv(
  rows: readonly (readonly (string | number | null | undefined)[])[],
  comments: readonly string[] = [],
): string {
  const head = comments.map((c) => `# ${c.replace(/[\r\n]+/g, ' ')}`);
  return [...head, ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n') + '\r\n';
}
