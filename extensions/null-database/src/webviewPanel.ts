'use strict';

import * as vscode from 'vscode';
import * as path from 'node:path';
import { SqliteSession, TableDataResult, QueryResult } from './sqliteDriver';
import { rowsToCsv, rowsToJson } from './exportHelper';
import { DbNode } from './databaseExplorer';

// ─── Message Protocol ─────────────────────────────────────────────────────────

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'openTable'; table: string }
  | { type: 'fetchPage'; table: string; page: number; pageSize: number; sortColumn?: string; sortAsc?: boolean; search?: string }
  | { type: 'runSql'; sql: string }
  | { type: 'newQuery' }
  | { type: 'exportTable'; table: string; format: 'csv' | 'json' }
  | { type: 'copyTableName'; table: string }
  | { type: 'openTableFromPanel'; table: string }
  | { type: 'getTableList' };

// ─── Webview HTML builder ─────────────────────────────────────────────────────

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function buildWebviewHtml(nonce: string, dbName: string, filePath: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(dbName)}</title>
<style nonce="${nonce}">
:root {
  --bg: var(--vscode-editor-background);
  --fg: var(--vscode-editor-foreground);
  --border: var(--vscode-panel-border, var(--vscode-editorWidget-border));
  --header-bg: var(--vscode-sideBar-background);
  --input-bg: var(--vscode-input-background);
  --input-fg: var(--vscode-input-foreground);
  --input-border: var(--vscode-input-border);
  --btn-bg: var(--vscode-button-background);
  --btn-fg: var(--vscode-button-foreground);
  --btn-hover: var(--vscode-button-hoverBackground);
  --link: var(--vscode-textLink-foreground);
  --table-row-hover: var(--vscode-list-hoverBackground);
  --table-row-selected: var(--vscode-list-activeSelectionBackground);
  --tag-bg: var(--vscode-badge-background);
  --tag-fg: var(--vscode-badge-foreground);
  --font: var(--vscode-font-family, sans-serif);
  --mono: var(--vscode-editor-font-family, monospace);
  --radius: 4px;
}
*, *::before, *::after { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0;
  height: 100%; overflow: hidden;
  font-family: var(--font); font-size: 13px;
  color: var(--fg); background: var(--bg);
}
#app { display: flex; flex-direction: column; height: 100%; }

/* ── Toolbar ── */
#toolbar {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 12px;
  background: var(--header-bg);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
#db-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
#tab-bar { display: flex; gap: 4px; overflow-x: auto; flex: 1; align-items: center; }
.tab-btn {
  padding: 2px 10px; border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--input-bg); color: var(--fg);
  cursor: pointer; font-size: 12px; white-space: nowrap; flex-shrink: 0;
}
.tab-btn.active { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg); }
.tab-btn:hover:not(.active) { background: var(--table-row-hover); }

/* ── Main layout ── */
#main { display: flex; flex: 1; overflow: hidden; }
#sidebar {
  width: 200px; min-width: 160px; flex-shrink: 0;
  border-right: 1px solid var(--border);
  display: flex; flex-direction: column; overflow: hidden;
}
#sidebar-search {
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
#sidebar-search input {
  width: 100%; padding: 3px 6px;
  background: var(--input-bg); color: var(--input-fg);
  border: 1px solid var(--input-border); border-radius: var(--radius);
  font-size: 12px; font-family: var(--font); outline: none;
}
#table-list { flex: 1; overflow-y: auto; }
.table-entry {
  padding: 4px 10px; cursor: pointer;
  display: flex; align-items: center; justify-content: space-between; gap: 4px;
  font-size: 12px; white-space: nowrap; overflow: hidden;
}
.table-entry:hover { background: var(--table-row-hover); }
.table-entry.active { background: var(--table-row-selected); color: var(--vscode-list-activeSelectionForeground); }
.table-entry-name { overflow: hidden; text-overflow: ellipsis; }
.row-badge {
  font-size: 10px; padding: 1px 5px;
  background: var(--tag-bg); color: var(--tag-fg); border-radius: 10px;
  flex-shrink: 0;
}

/* ── Content area ── */
#content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

/* ── View: Table Data ── */
#view-table { display: flex; flex-direction: column; overflow: hidden; height: 100%; }
#view-query { display: flex; flex-direction: column; overflow: hidden; height: 100%; }
.hidden { display: none !important; }

#table-controls {
  display: flex; align-items: center; gap: 8px; padding: 6px 10px;
  border-bottom: 1px solid var(--border); flex-shrink: 0; flex-wrap: wrap;
}
#table-controls input[type=text] {
  flex: 1; min-width: 120px; max-width: 240px;
  padding: 3px 7px; border: 1px solid var(--input-border);
  background: var(--input-bg); color: var(--input-fg);
  border-radius: var(--radius); font-size: 12px; font-family: var(--font); outline: none;
}
.ctrl-btn {
  padding: 3px 10px; border: 1px solid var(--input-border);
  background: var(--input-bg); color: var(--fg);
  border-radius: var(--radius); cursor: pointer; font-size: 12px;
}
.ctrl-btn:hover { background: var(--table-row-hover); }
.ctrl-btn.primary { background: var(--btn-bg); color: var(--btn-fg); border-color: var(--btn-bg); }
.ctrl-btn.primary:hover { background: var(--btn-hover); }
#page-info { font-size: 12px; color: var(--vscode-descriptionForeground); white-space: nowrap; }

#grid-wrap { flex: 1; overflow: auto; }
table {
  border-collapse: collapse; width: 100%; font-size: 12px;
  font-family: var(--mono);
}
table th {
  position: sticky; top: 0; z-index: 2;
  background: var(--header-bg); padding: 5px 8px;
  border-bottom: 2px solid var(--border);
  text-align: left; font-size: 11px; font-weight: 600; cursor: pointer;
  user-select: none; white-space: nowrap;
}
table th:hover { color: var(--link); }
table th .sort-arrow { margin-left: 4px; opacity: 0.5; }
table th.sort-active .sort-arrow { opacity: 1; color: var(--link); }
table td {
  padding: 4px 8px; border-bottom: 1px solid var(--border);
  max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  vertical-align: top;
}
table tr:hover td { background: var(--table-row-hover); }
.cell-null { color: var(--vscode-descriptionForeground); font-style: italic; }
.cell-blob { color: #a0a0a0; font-style: italic; }
.cell-num { color: var(--vscode-charts-blue, #4fc3f7); }
.status-row { padding: 10px; color: var(--vscode-descriptionForeground); font-size: 12px; }

/* ── SQL Editor ── */
#sql-editor-wrap { display: flex; flex-direction: column; padding: 8px; border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 6px; }
#sql-editor {
  width: 100%; min-height: 90px; max-height: 180px; resize: vertical;
  background: var(--input-bg); color: var(--input-fg);
  border: 1px solid var(--input-border); border-radius: var(--radius);
  font-family: var(--mono); font-size: 12px; padding: 6px 8px; outline: none;
  tab-size: 2;
}
#sql-editor:focus { border-color: var(--vscode-focusBorder); }
#sql-actions { display: flex; align-items: center; gap: 8px; }
#sql-status { font-size: 11px; color: var(--vscode-descriptionForeground); flex: 1; }
#query-results { flex: 1; overflow: auto; display: flex; flex-direction: column; }
.result-info { padding: 8px 10px; font-size: 11px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--border); }
.result-error { padding: 10px; color: var(--vscode-errorForeground, #f48771); font-size: 12px; font-family: var(--mono); white-space: pre-wrap; }

/* Scrollbars */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--vscode-scrollbarSlider-hoverBackground); }
</style>
</head>
<body>
<div id="app">
  <!-- Toolbar -->
  <div id="toolbar">
    <span id="db-name" title="${escapeHtml(filePath)}">🗄 ${escapeHtml(dbName)}</span>
    <div id="tab-bar">
      <button class="tab-btn active" id="tab-data" onclick="switchTab('data')">Tables</button>
      <button class="tab-btn" id="tab-query" onclick="switchTab('query')">SQL Query</button>
    </div>
  </div>

  <!-- Main layout -->
  <div id="main">
    <!-- Sidebar: table list -->
    <div id="sidebar">
      <div id="sidebar-search">
        <input id="table-search" type="text" placeholder="Filter tables…" oninput="filterTables(this.value)">
      </div>
      <div id="table-list"></div>
    </div>

    <!-- Content area -->
    <div id="content">
      <!-- Table data view -->
      <div id="view-table">
        <div id="table-controls">
          <span id="active-table-label" style="font-weight:600;font-size:12px;"></span>
          <input type="text" id="search-input" placeholder="Search…" oninput="debounceSearch(this.value)">
          <select id="page-size-select" class="ctrl-btn" onchange="onPageSizeChange(this.value)" style="padding:3px 4px;">
            <option value="25">25</option>
            <option value="50" selected>50</option>
            <option value="100">100</option>
            <option value="250">250</option>
            <option value="500">500</option>
          </select>
          <button class="ctrl-btn" onclick="prevPage()" id="btn-prev">‹ Prev</button>
          <span id="page-info">—</span>
          <button class="ctrl-btn" onclick="nextPage()" id="btn-next">Next ›</button>
          <button class="ctrl-btn" onclick="exportCsv()" title="Export to CSV">↓ CSV</button>
          <button class="ctrl-btn" onclick="exportJson()" title="Export to JSON">↓ JSON</button>
          <button class="ctrl-btn" onclick="openQueryForTable()" title="Open SQL Query for this table">SQL ›</button>
        </div>
        <div id="grid-wrap">
          <div class="status-row" id="table-status">Select a table from the sidebar.</div>
          <div id="grid-container"></div>
        </div>
      </div>

      <!-- SQL Query view -->
      <div id="view-query" class="hidden">
        <div id="sql-editor-wrap">
          <textarea id="sql-editor" spellcheck="false" placeholder="SELECT * FROM my_table LIMIT 100;&#10;&#10;-- Press Ctrl+Enter or click Run to execute"></textarea>
          <div id="sql-actions">
            <button class="ctrl-btn primary" onclick="runSql()">▶ Run (Ctrl+Enter)</button>
            <button class="ctrl-btn" onclick="clearQuery()">Clear</button>
            <span id="sql-status"></span>
          </div>
        </div>
        <div id="query-results">
          <div class="status-row">Enter a SQL query above and click Run.</div>
        </div>
      </div>
    </div>
  </div>
</div>

<script nonce="${nonce}">
const vscode = acquireVsCodeApi();

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  currentTab: 'data',
  currentTable: null,
  currentPage: 1,
  pageSize: 50,
  sortColumn: null,
  sortAsc: true,
  search: '',
  tables: [],
  totalRows: 0,
  totalPages: 1,
  columns: [],
};
let searchTimer = null;

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  state.currentTab = tab;
  document.getElementById('view-table').classList.toggle('hidden', tab !== 'data');
  document.getElementById('view-query').classList.toggle('hidden', tab !== 'query');
  document.getElementById('tab-data').classList.toggle('active', tab === 'data');
  document.getElementById('tab-query').classList.toggle('active', tab === 'query');
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function renderTableList(tables, filter) {
  state.tables = tables;
  const list = document.getElementById('table-list');
  const normalFilter = (filter || '').toLowerCase();
  const filtered = tables.filter(t => t.name.toLowerCase().includes(normalFilter));
  if (!filtered.length) {
    list.innerHTML = '<div class="status-row">No tables found.</div>';
    return;
  }
  list.innerHTML = filtered.map(t => {
    const icon = t.type === 'view' ? '◈' : '▤';
    const active = state.currentTable === t.name ? ' active' : '';
    return \`<div class="table-entry\${active}" onclick="selectTable('\${esc(t.name)}')" title="\${esc(t.name)}">
      <span class="table-entry-name">\${icon} \${esc(t.name)}</span>
      <span class="row-badge">\${t.rowCount}</span>
    </div>\`;
  }).join('');
}

function filterTables(val) {
  renderTableList(state.tables, val);
}

// ─── Table data ───────────────────────────────────────────────────────────────
function selectTable(name) {
  state.currentTable = name;
  state.currentPage = 1;
  state.sortColumn = null;
  state.sortAsc = true;
  state.search = '';
  document.getElementById('search-input').value = '';
  renderTableList(state.tables, document.getElementById('table-search').value);
  fetchPage();
  if (state.currentTab !== 'data') switchTab('data');
}

function fetchPage() {
  if (!state.currentTable) return;
  document.getElementById('table-status').textContent = 'Loading…';
  document.getElementById('grid-container').innerHTML = '';
  vscode.postMessage({
    type: 'fetchPage',
    table: state.currentTable,
    page: state.currentPage,
    pageSize: state.pageSize,
    sortColumn: state.sortColumn || undefined,
    sortAsc: state.sortAsc,
    search: state.search || undefined,
  });
}

function renderTableData(data) {
  state.totalRows = data.totalRows;
  state.totalPages = data.totalPages;
  state.currentPage = data.page;
  state.columns = data.columns;

  document.getElementById('table-status').style.display = 'none';
  document.getElementById('active-table-label').textContent = data.table;

  const pageInfo = document.getElementById('page-info');
  const start = (data.page - 1) * data.pageSize + 1;
  const end = Math.min(data.page * data.pageSize, data.totalRows);
  pageInfo.textContent = data.totalRows === 0 ? '0 rows' : \`\${start}–\${end} of \${data.totalRows.toLocaleString()}\`;

  document.getElementById('btn-prev').disabled = data.page <= 1;
  document.getElementById('btn-next').disabled = data.page >= data.totalPages;

  if (!data.columns.length) {
    document.getElementById('grid-container').innerHTML = '<div class="status-row">No columns.</div>';
    return;
  }

  const rows = data.rows;
  let thead = '<thead><tr>' + data.columns.map(col => {
    const isSorted = col === state.sortColumn;
    const arrow = isSorted ? (state.sortAsc ? '▲' : '▼') : '⇅';
    const activeClass = isSorted ? ' sort-active' : '';
    return \`<th class="\${activeClass}" onclick="sortBy('\${esc(col)}')"> \${esc(col)} <span class="sort-arrow">\${arrow}</span></th>\`;
  }).join('') + '</tr></thead>';

  let tbody = '<tbody>';
  for (const row of rows) {
    tbody += '<tr>' + data.columns.map(col => {
      const val = row[col];
      return \`<td>\${formatCell(val)}</td>\`;
    }).join('') + '</tr>';
  }
  tbody += '</tbody>';

  if (!rows.length) {
    tbody = '<tbody><tr><td colspan="' + data.columns.length + '" class="status-row">No rows.</td></tr></tbody>';
  }

  document.getElementById('grid-container').innerHTML = \`<table>\${thead}\${tbody}</table>\`;
}

function formatCell(val) {
  if (val === null || val === undefined) return '<span class="cell-null">NULL</span>';
  if (typeof val === 'object' && val.__type === 'blob') {
    return \`<span class="cell-blob">[BLOB \${val.length}B] \${val.preview}</span>\`;
  }
  if (typeof val === 'number') return \`<span class="cell-num">\${val}</span>\`;
  const s = String(val);
  return esc(s.length > 200 ? s.slice(0, 200) + '…' : s);
}

function prevPage() {
  if (state.currentPage > 1) { state.currentPage--; fetchPage(); }
}
function nextPage() {
  if (state.currentPage < state.totalPages) { state.currentPage++; fetchPage(); }
}
function sortBy(col) {
  if (state.sortColumn === col) { state.sortAsc = !state.sortAsc; }
  else { state.sortColumn = col; state.sortAsc = true; }
  state.currentPage = 1;
  fetchPage();
}
function onPageSizeChange(val) {
  state.pageSize = parseInt(val, 10) || 50;
  state.currentPage = 1;
  fetchPage();
}
function debounceSearch(val) {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = val;
    state.currentPage = 1;
    fetchPage();
  }, 400);
}
function exportCsv() {
  if (state.currentTable) vscode.postMessage({ type: 'exportTable', table: state.currentTable, format: 'csv' });
}
function exportJson() {
  if (state.currentTable) vscode.postMessage({ type: 'exportTable', table: state.currentTable, format: 'json' });
}
function openQueryForTable() {
  if (state.currentTable) {
    document.getElementById('sql-editor').value = \`SELECT * FROM "\${state.currentTable}" LIMIT 100;\`;
    switchTab('query');
  }
}

// ─── SQL Editor ───────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && state.currentTab === 'query') {
    e.preventDefault(); runSql();
  }
});

function runSql() {
  const sql = document.getElementById('sql-editor').value.trim();
  if (!sql) return;
  document.getElementById('sql-status').textContent = 'Running…';
  document.getElementById('query-results').innerHTML = '';
  vscode.postMessage({ type: 'runSql', sql });
}

function clearQuery() {
  document.getElementById('sql-editor').value = '';
  document.getElementById('sql-status').textContent = '';
  document.getElementById('query-results').innerHTML = '<div class="status-row">Enter a SQL query above and click Run.</div>';
}

function renderQueryResult(result) {
  const container = document.getElementById('query-results');
  container.innerHTML = '';

  if (result.error) {
    container.innerHTML = \`<div class="result-error">Error: \${esc(result.error)}</div>\`;
    document.getElementById('sql-status').textContent = 'Error';
    return;
  }

  const ms = result.durationMs !== undefined ? \` (\${result.durationMs} ms)\` : '';
  if (result.type === 'mutation' || result.type === 'exec') {
    const info = result.changes !== undefined ? \`\${result.changes} row(s) affected\` : 'Statement executed';
    document.getElementById('sql-status').textContent = info + ms;
    container.innerHTML = \`<div class="result-info">\${esc(info)}\${ms}</div>\`;
    return;
  }

  document.getElementById('sql-status').textContent = \`\${result.rowCount} row(s)\${ms}\`;

  const info = document.createElement('div');
  info.className = 'result-info';
  info.textContent = \`\${result.rowCount} row(s) returned\${ms}\`;
  container.appendChild(info);

  if (!result.columns.length) {
    container.innerHTML += '<div class="status-row">No columns.</div>';
    return;
  }

  const wrap = document.createElement('div');
  wrap.style.overflow = 'auto';
  wrap.style.flex = '1';

  let thead = '<thead><tr>' + result.columns.map(c => \`<th>\${esc(c)}</th>\`).join('') + '</tr></thead>';
  let tbody = '<tbody>';
  for (const row of result.rows) {
    tbody += '<tr>' + result.columns.map(c => \`<td>\${formatCell(row[c])}</td>\`).join('') + '</tr>';
  }
  tbody += '</tbody>';
  wrap.innerHTML = \`<table>\${thead}\${tbody}</table>\`;
  container.appendChild(wrap);
}

// ─── Message handler ──────────────────────────────────────────────────────────
window.addEventListener('message', e => {
  const msg = e.data;
  switch (msg.type) {
    case 'tableList': renderTableList(msg.tables, ''); break;
    case 'tableData': renderTableData(msg.data); break;
    case 'queryResult': renderQueryResult(msg.result); break;
    case 'openTable': selectTable(msg.table); break;
    case 'openQuery': {
      document.getElementById('sql-editor').value = msg.sql || '';
      switchTab('query');
      break;
    }
  }
});

// ─── Utilities ────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Database Panel ───────────────────────────────────────────────────────────

export class DatabasePanel {
  private static panels = new Map<string, DatabasePanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly filePath: string;
  private session: SqliteSession;
  private disposables: vscode.Disposable[] = [];

  static createOrFocus(filePath: string, context: vscode.ExtensionContext, options?: { openTable?: string; openQuery?: boolean }): DatabasePanel {
    const existing = DatabasePanel.panels.get(filePath);
    if (existing) {
      existing.panel.reveal();
      if (options?.openTable) {
        existing.panel.webview.postMessage({ type: 'openTable', table: options.openTable });
      } else if (options?.openQuery) {
        existing.panel.webview.postMessage({ type: 'openQuery', sql: '' });
      }
      return existing;
    }
    return new DatabasePanel(filePath, context, options);
  }

  static closeAll(): void {
    for (const p of DatabasePanel.panels.values()) {
      try { p.panel.dispose(); } catch { /* ignore */ }
    }
    DatabasePanel.panels.clear();
  }

  private constructor(filePath: string, _context: vscode.ExtensionContext, options?: { openTable?: string; openQuery?: boolean }) {
    this.filePath = filePath;
    this.session = new SqliteSession(filePath, true);

    const dbName = path.basename(filePath);
    this.panel = vscode.window.createWebviewPanel(
      'null.database.viewer',
      `DB: ${dbName}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    DatabasePanel.panels.set(filePath, this);

    const nonce = getNonce();
    this.panel.webview.html = buildWebviewHtml(nonce, dbName, filePath);

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewMessage) => this.handleMessage(msg),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => {
      DatabasePanel.panels.delete(filePath);
      try { this.session.close(); } catch { /* ignore */ }
      this.disposables.forEach(d => d.dispose());
    }, undefined, this.disposables);

    if (options?.openTable) {
      this._pendingOpenTable = options.openTable;
    } else if (options?.openQuery) {
      this._pendingOpenQuery = true;
    }
  }

  private _pendingOpenTable?: string;
  private _pendingOpenQuery?: boolean;

  private handleMessage(msg: WebviewMessage): void {
    switch (msg.type) {
      case 'ready':
        this.sendTableList();
        if (this._pendingOpenTable) {
          this.panel.webview.postMessage({ type: 'openTable', table: this._pendingOpenTable });
          this._pendingOpenTable = undefined;
        } else if (this._pendingOpenQuery) {
          this.panel.webview.postMessage({ type: 'openQuery', sql: '' });
          this._pendingOpenQuery = false;
        }
        break;

      case 'getTableList':
        this.sendTableList();
        break;

      case 'fetchPage': {
        try {
          const result = this.session.queryTableData({
            table: msg.table,
            page: msg.page,
            pageSize: msg.pageSize,
            sortColumn: msg.sortColumn,
            sortAsc: msg.sortAsc,
            search: msg.search,
          });
          this.panel.webview.postMessage({ type: 'tableData', data: result });
        } catch (err: unknown) {
          vscode.window.showErrorMessage(`Query failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        break;
      }

      case 'runSql': {
        try {
          const result: QueryResult = this.session.executeSql(msg.sql);
          this.panel.webview.postMessage({ type: 'queryResult', result });
        } catch (err: unknown) {
          const error = err instanceof Error ? err.message : String(err);
          this.panel.webview.postMessage({ type: 'queryResult', result: { error, type: 'select', columns: [], rows: [], rowCount: 0, durationMs: 0 } });
        }
        break;
      }

      case 'exportTable':
        this.handleExport(msg.table, msg.format);
        break;
    }
  }

  private sendTableList(): void {
    try {
      const tables = this.session.listTablesAndViews();
      this.panel.webview.postMessage({ type: 'tableList', tables });
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Failed to list tables: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async handleExport(table: string, format: 'csv' | 'json'): Promise<void> {
    try {
      const details = this.session.queryTableData({ table, page: 1, pageSize: 1000000 });
      const defaultName = `${table}.${format}`;
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(path.dirname(this.filePath), defaultName)),
        filters: format === 'csv' ? { 'CSV Files': ['csv'] } : { 'JSON Files': ['json'] },
        saveLabel: 'Export',
      });
      if (!uri) { return; }

      const content = format === 'csv'
        ? rowsToCsv(details.columns, details.rows)
        : rowsToJson(details.rows);

      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
      const action = await vscode.window.showInformationMessage(
        `Exported ${details.rows.length} rows to ${path.basename(uri.fsPath)}`,
        'Open File'
      );
      if (action === 'Open File') {
        vscode.commands.executeCommand('vscode.open', uri);
      }
    } catch (err: unknown) {
      vscode.window.showErrorMessage(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public openTable(tableName: string): void {
    this.panel.reveal();
    this.panel.webview.postMessage({ type: 'openTable', table: tableName });
  }
}
