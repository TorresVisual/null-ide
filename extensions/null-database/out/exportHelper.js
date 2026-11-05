'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatCsvCell = formatCsvCell;
exports.rowsToCsv = rowsToCsv;
exports.rowsToJson = rowsToJson;
/**
 * Format a single cell value for CSV export according to RFC 4180.
 */
function formatCsvCell(value) {
    if (value === null || value === undefined) {
        return '';
    }
    let text;
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
        text = `[BLOB ${value.length} bytes]`;
    }
    else if (typeof value === 'object') {
        try {
            text = JSON.stringify(value);
        }
        catch {
            text = String(value);
        }
    }
    else if (typeof value === 'bigint') {
        text = value.toString();
    }
    else {
        text = String(value);
    }
    // If the cell contains quotes, commas, or line breaks, enclose in double quotes and escape internal quotes.
    if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}
/**
 * Convert column headers and rows into CSV text.
 */
function rowsToCsv(columns, rows) {
    const headerLine = columns.map(c => formatCsvCell(c)).join(',');
    const rowLines = rows.map(row => {
        return columns.map(col => formatCsvCell(row[col])).join(',');
    });
    return [headerLine, ...rowLines].join('\r\n');
}
/**
 * Safe JSON serializer supporting BigInt and Buffers/Uint8Arrays.
 */
function rowsToJson(rows, pretty = true) {
    const replacer = (_key, value) => {
        if (typeof value === 'bigint') {
            return value.toString();
        }
        if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
            return `[BLOB ${value.length} bytes]`;
        }
        return value;
    };
    return JSON.stringify(rows, replacer, pretty ? 2 : undefined);
}
//# sourceMappingURL=exportHelper.js.map