// Minimal CSV helper — no external dependency needed for a handful of columns.

/**
 * Escapes a single value for safe inclusion in a CSV cell.
 * Wraps in quotes and doubles any internal quotes whenever the value
 * contains a comma, quote, or newline (per RFC 4180).
 */
function escapeCsvField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a CSV string from an array of row objects.
 * @param {Array<Object>} rows
 * @param {Array<{key: string, header: string}>} columns
 */
function toCsv(rows, columns) {
  const headerLine = columns.map((c) => escapeCsvField(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(row[c.key])).join(',')
  );
  return [headerLine, ...lines].join('\r\n');
}

module.exports = { toCsv, escapeCsvField };
