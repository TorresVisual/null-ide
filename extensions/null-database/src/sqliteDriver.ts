'use strict';

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

type SqlValue = string | number | bigint | Uint8Array | null;

export interface TableSummary {
  name: string;
  type: 'table' | 'view';
  rowCount: number;
  sql?: string;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: unknown;
  primaryKey: boolean;
}

export interface ForeignKeyInfo {
  id: number;
  from: string;
  toTable: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface IndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface TableDetails {
  name: string;
  type: 'table' | 'view';
  columns: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  sql: string;
  rowCount: number;
}

export interface TableDataResult {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sortColumn?: string;
  sortAsc?: boolean;
}

export interface QueryResult {
  type: 'select' | 'mutation' | 'exec';
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  changes?: number;
  lastInsertRowid?: string | number;
  durationMs: number;
}

export interface DatabaseInfo {
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  sqliteVersion: string;
  tableCount: number;
  viewCount: number;
}

export function escapeIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export function sanitizeValue(value: unknown): unknown {
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

export class SqliteSession {
  private db: DatabaseSync;
  public readonly filePath: string;
  public readonly isMemory: boolean;

  constructor(filePath: string, readOnly = false) {
    this.filePath = filePath;
    this.isMemory = filePath === ':memory:';

    if (!this.isMemory && !fs.existsSync(filePath)) {
      throw new Error(`Database file does not exist: ${filePath}`);
    }

    this.db = new DatabaseSync(filePath, { readOnly: !this.isMemory && readOnly });
  }

  public getDatabaseInfo(): DatabaseInfo {
    let size = 0;
    if (!this.isMemory && fs.existsSync(this.filePath)) {
      try {
        size = fs.statSync(this.filePath).size;
      } catch {
        size = 0;
      }
    }

    let version = 'unknown';
    try {
      const verRow = this.db.prepare('SELECT sqlite_version() AS version').all()[0] as { version?: string };
      version = verRow?.version ?? 'unknown';
    } catch {
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

  public listTablesAndViews(): TableSummary[] {
    const query = `
      SELECT name, type, sql
      FROM sqlite_master
      WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
      ORDER BY type DESC, name ASC;
    `;
    const rows = this.db.prepare(query).all() as { name: string; type: string; sql: string }[];

    return rows.map(r => {
      let rowCount = 0;
      if (r.type === 'table') {
        try {
          const countRow = this.db.prepare(`SELECT COUNT(*) AS count FROM ${escapeIdentifier(r.name)}`).all()[0] as { count: number };
          rowCount = countRow?.count ?? 0;
        } catch {
          rowCount = 0;
        }
      }
      return {
        name: r.name,
        type: r.type as 'table' | 'view',
        rowCount,
        sql: r.sql,
      };
    });
  }

  public getTableDetails(tableName: string): TableDetails {
    // 1. Master entry (type, DDL)
    const masterRows = this.db
      .prepare(`SELECT type, sql FROM sqlite_master WHERE name = ? AND type IN ('table', 'view')`)
      .all(tableName) as { type: string; sql: string }[];

    if (!masterRows.length) {
      throw new Error(`Table or view "${tableName}" not found.`);
    }

    const itemType = masterRows[0].type as 'table' | 'view';
    const sql = masterRows[0].sql || '';

    // 2. Columns via PRAGMA table_info
    const colRows = this.db.prepare(`PRAGMA table_info(${escapeIdentifier(tableName)})`).all() as {
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
      pk: number;
    }[];

    const columns: ColumnInfo[] = colRows.map(c => ({
      cid: c.cid,
      name: c.name,
      type: c.type || 'TEXT',
      notNull: c.notnull === 1,
      defaultValue: c.dflt_value,
      primaryKey: c.pk > 0,
    }));

    // 3. Foreign Keys via PRAGMA foreign_key_list
    let foreignKeys: ForeignKeyInfo[] = [];
    try {
      const fkRows = this.db.prepare(`PRAGMA foreign_key_list(${escapeIdentifier(tableName)})`).all() as {
        id: number;
        from: string;
        table: string;
        to: string;
        on_update: string;
        on_delete: string;
      }[];
      foreignKeys = fkRows.map(fk => ({
        id: fk.id,
        from: fk.from,
        toTable: fk.table,
        toColumn: fk.to,
        onUpdate: fk.on_update,
        onDelete: fk.on_delete,
      }));
    } catch {
      // Views do not have foreign key lists
    }

    // 4. Indexes via PRAGMA index_list
    let indexes: IndexInfo[] = [];
    try {
      const idxRows = this.db.prepare(`PRAGMA index_list(${escapeIdentifier(tableName)})`).all() as {
        name: string;
        unique: number;
      }[];
      indexes = idxRows.map(idx => {
        let cols: string[] = [];
        try {
          const idxInfo = this.db.prepare(`PRAGMA index_info(${escapeIdentifier(idx.name)})`).all() as { name: string }[];
          cols = idxInfo.map(i => i.name);
        } catch {
          // ignore
        }
        return {
          name: idx.name,
          unique: idx.unique === 1,
          columns: cols,
        };
      });
    } catch {
      // Views do not have index lists
    }

    // 5. Row count
    let rowCount = 0;
    try {
      const countRow = this.db.prepare(`SELECT COUNT(*) AS count FROM ${escapeIdentifier(tableName)}`).all()[0] as { count: number };
      rowCount = countRow?.count ?? 0;
    } catch {
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

  public queryTableData(options: {
    table: string;
    page?: number;
    pageSize?: number;
    sortColumn?: string;
    sortAsc?: boolean;
    search?: string;
  }): TableDataResult {
    const table = options.table;
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.max(1, Math.min(1000, options.pageSize ?? 50));
    const details = this.getTableDetails(table);

    const columns = details.columns.map(c => c.name);
    const validCol = options.sortColumn && columns.includes(options.sortColumn) ? options.sortColumn : undefined;
    const sortDirection = options.sortAsc === false ? 'DESC' : 'ASC';

    let whereClause = '';
    const params: SqlValue[] = [];

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
    const totalRows = (this.db.prepare(countQuery).all(...(params as SqlValue[]))[0] as { count: number })?.count ?? 0;
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

    const rawRows = this.db.prepare(dataQuery).all(...(params as SqlValue[]), pageSize, offset) as Record<string, unknown>[];
    const sanitizedRows = rawRows.map(row => {
      const out: Record<string, unknown> = {};
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

  public executeSql(sql: string): QueryResult {
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
        const rawRows = stmt.all() as Record<string, unknown>[];
        const durationMs = Math.round((performance.now() - start) * 100) / 100;
        const columns = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
        const rows = rawRows.map(row => {
          const out: Record<string, unknown> = {};
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
      } else {
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
    } catch (err: unknown) {
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

  public close(): void {
    try {
      this.db.close();
    } catch {
      // ignore
    }
  }
}
