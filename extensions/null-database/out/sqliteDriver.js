'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteSession = void 0;
exports.escapeIdentifier = escapeIdentifier;
exports.sanitizeValue = sanitizeValue;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_sqlite_1 = require("node:sqlite");
function escapeIdentifier(id) {
    return `"${id.replace(/"/g, '""')}"`;
}
function sanitizeValue(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'bigint') {
        if (value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
            return Number(value);
        }
        return value.toString();
    }
    if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(value))) {
        return {
            __type: 'blob',
            length: value.length,
            preview: Array.from(value.slice(0, 32))
                .map(b => b.toString(16).padStart(2, '0'))
                .join(' '),
        };
    }
    return value;
}
class SqliteSession {
    db;
    filePath;
    isMemory;
    constructor(filePath, readOnly = false) {
        this.filePath = filePath;
        this.isMemory = filePath === ':memory:';
        if (!this.isMemory && !fs.existsSync(filePath)) {
            throw new Error(`Database file does not exist: ${filePath}`);
        }
        this.db = new node_sqlite_1.DatabaseSync(filePath, { readOnly: !this.isMemory && readOnly });
    }
    getDatabaseInfo() {
        let size = 0;
        if (!this.isMemory && fs.existsSync(this.filePath)) {
            try {
                size = fs.statSync(this.filePath).size;
            }
            catch {
                size = 0;
            }
        }
        let version = 'unknown';
        try {
            const verRow = this.db.prepare('SELECT sqlite_version() AS version').all()[0];
            version = verRow?.version ?? 'unknown';
        }
        catch {
            // ignore
        }
        const tables = this.listTablesAndViews();
        const tableCount = tables.filter(t => t.type === 'table').length;
        const viewCount = tables.filter(t => t.type === 'view').length;
        return {
            filePath: this.filePath,
            fileName: this.isMemory ? ':memory:' : path.basename(this.filePath),
            fileSizeBytes: size,
            sqliteVersion: version,
            tableCount,
            viewCount,
        };
    }
    listTablesAndViews() {
        const query = `
      SELECT name, type, sql
      FROM sqlite_master
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
      ORDER BY type DESC, name ASC;
    `;
        const rows = this.db.prepare(query).all();
        return rows.map(r => {
            let rowCount = 0;
            if (r.type === 'table') {
                try {
                    const countRow = this.db.prepare(`SELECT COUNT(*) AS count FROM ${escapeIdentifier(r.name)}`).all()[0];
                    rowCount = countRow?.count ?? 0;
                }
                catch {
                    rowCount = 0;
                }
            }
            return {
                name: r.name,
                type: r.type,
                rowCount,
                sql: r.sql,
            };
        });
    }
    getTableDetails(tableName) {
        // 1. Master entry (type, DDL)
        const masterRows = this.db
            .prepare(`SELECT type, sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`)
            .all(tableName);
        if (!masterRows.length) {
            throw new Error(`Table or view "${tableName}" not found.`);
        }
        const itemType = masterRows[0].type;
        const sql = masterRows[0].sql || '';
        // 2. Columns via PRAGMA table_info
        const colRows = this.db.prepare(`PRAGMA table_info(${escapeIdentifier(tableName)})`).all();
        const columns = colRows.map(c => ({
            cid: c.cid,
            name: c.name,
            type: c.type || 'TEXT',
            notNull: c.notnull === 1,
            defaultValue: c.dflt_value,
            primaryKey: c.pk > 0,
        }));
        // 3. Foreign Keys via PRAGMA foreign_key_list
        let foreignKeys = [];
        try {
            const fkRows = this.db.prepare(`PRAGMA foreign_key_list(${escapeIdentifier(tableName)})`).all();
            foreignKeys = fkRows.map(fk => ({
                id: fk.id,
                from: fk.from,
                toTable: fk.table,
                toColumn: fk.to,
                onUpdate: fk.on_update,
                onDelete: fk.on_delete,
            }));
        }
        catch {
            // Views do not have foreign key lists
        }
        // 4. Indexes via PRAGMA index_list
        let indexes = [];
        try {
            const idxRows = this.db.prepare(`PRAGMA index_list(${escapeIdentifier(tableName)})`).all();
            indexes = idxRows.map(idx => {
                let cols = [];
                try {
                    const idxInfo = this.db.prepare(`PRAGMA index_info(${escapeIdentifier(idx.name)})`).all();
                    cols = idxInfo.map(i => i.name);
                }
                catch {
                    // ignore
                }
                return {
                    name: idx.name,
                    unique: idx.unique === 1,
                    columns: cols,
                };
            });
        }
        catch {
            // Views do not have index lists
        }
        // 5. Row count
        let rowCount = 0;
        try {
            const countRow = this.db.prepare(`SELECT COUNT(*) AS count FROM ${escapeIdentifier(tableName)}`).all()[0];
            rowCount = countRow?.count ?? 0;
        }
        catch {
            rowCount = 0;
        }
        return {
            name: tableName,
            type: itemType,
            columns,
            foreignKeys,
            indexes,
            sql,
            rowCount,
        };
    }
    queryTableData(options) {
        const table = options.table;
        const page = Math.max(1, options.page ?? 1);
        const pageSize = Math.max(1, Math.min(1000, options.pageSize ?? 50));
        const details = this.getTableDetails(table);
        const columns = details.columns.map(c => c.name);
        const validCol = options.sortColumn && columns.includes(options.sortColumn) ? options.sortColumn : undefined;
        const sortDirection = options.sortAsc === false ? 'DESC' : 'ASC';
        let whereClause = '';
        const params = [];
        if (options.search && options.search.trim().length > 0) {
            const term = options.search.trim();
            const searchCols = details.columns.filter(c => {
                const t = c.type.toUpperCase();
                return t.includes('CHAR') || t.includes('TEXT') || t.includes('CLOB') || t.includes('INT');
            });
            if (searchCols.length > 0) {
                const conditions = searchCols.map(c => `${escapeIdentifier(c.name)} LIKE '%' || ? || '%'`);
                whereClause = `WHERE ${conditions.join(' OR ')}`;
                for (let i = 0; i < searchCols.length; i++) {
                    params.push(term);
                }
            }
        }
        // Total matching rows
        const countQuery = `SELECT COUNT(*) AS count FROM ${escapeIdentifier(table)} ${whereClause}`;
        const totalRows = this.db.prepare(countQuery).all(...params)[0]?.count ?? 0;
        const totalPages = Math.ceil(totalRows / pageSize) || 1;
        const offset = (page - 1) * pageSize;
        let orderClause = '';
        if (validCol) {
            orderClause = `ORDER BY ${escapeIdentifier(validCol)} ${sortDirection}`;
        }
        const dataQuery = `
      SELECT * FROM ${escapeIdentifier(table)}
      ${whereClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;
        const rawRows = this.db.prepare(dataQuery).all(...params, pageSize, offset);
        const sanitizedRows = rawRows.map(row => {
            const out = {};
            for (const [k, v] of Object.entries(row)) {
                out[k] = sanitizeValue(v);
            }
            return out;
        });
        return {
            table,
            columns,
            rows: sanitizedRows,
            totalRows,
            page,
            pageSize,
            totalPages,
            sortColumn: validCol,
            sortAsc: validCol ? sortDirection === 'ASC' : undefined,
        };
    }
    executeSql(sql) {
        const trimmed = sql.trim();
        if (!trimmed) {
            return {
                type: 'select',
                columns: [],
                rows: [],
                rowCount: 0,
                durationMs: 0,
            };
        }
        const start = performance.now();
        const isQuery = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i.test(trimmed);
        try {
            const stmt = this.db.prepare(trimmed);
            if (isQuery) {
                const rawRows = stmt.all();
                const durationMs = Math.round((performance.now() - start) * 100) / 100;
                const columns = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
                const rows = rawRows.map(row => {
                    const out = {};
                    for (const [k, v] of Object.entries(row)) {
                        out[k] = sanitizeValue(v);
                    }
                    return out;
                });
                return {
                    type: 'select',
                    columns,
                    rows,
                    rowCount: rows.length,
                    durationMs,
                };
            }
            else {
                const result = stmt.run();
                const durationMs = Math.round((performance.now() - start) * 100) / 100;
                return {
                    type: 'mutation',
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    changes: Number(result.changes),
                    lastInsertRowid: typeof result.lastInsertRowid === 'bigint' ? result.lastInsertRowid.toString() : result.lastInsertRowid,
                    durationMs,
                };
            }
        }
        catch (err) {
            // If prepare failed, perhaps it's multiple semicolon-separated statements?
            if (trimmed.includes(';')) {
                this.db.exec(trimmed);
                const durationMs = Math.round((performance.now() - start) * 100) / 100;
                return {
                    type: 'exec',
                    columns: [],
                    rows: [],
                    rowCount: 0,
                    durationMs,
                };
            }
            throw err;
        }
    }
    close() {
        try {
            this.db.close();
        }
        catch {
            // ignore
        }
    }
}
exports.SqliteSession = SqliteSession;
//# sourceMappingURL=sqliteDriver.js.map