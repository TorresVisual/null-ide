# null-database — Agent Notes

## Purpose
Built-in SQLite database viewer and SQL query runner for Null IDE.

## Architecture

```
extensions/null-database/
  src/
    extension.ts          — activate/deactivate, command registrations, custom-editor provider
    sqliteDriver.ts       — SqliteSession wrapping node:sqlite; schema introspection + data paging
    databaseExplorer.ts   — TreeDataProvider (sidebar), ConnectionRegistry (globalState)
    webviewPanel.ts       — DatabasePanel (singleton per file); HTML+CSS+JS webview
    exportHelper.ts       — CSV/JSON export helpers (pure, no vscode dependency)
    *.test.ts             — node:test unit tests (exportHelper + sqliteDriver)
  media/
    database.svg          — Activity-bar icon (currentColor stroke)
  package.json
  tsconfig.json
```

## Key design decisions
- Uses **node:sqlite** (`DatabaseSync`, available since Node 22.5) — no native addon, no bundled driver.
- Sessions opened **read-only** for the tree view and table viewer; write mode only when the user runs arbitrary SQL.
- The **ConnectionRegistry** persists absolute paths in `globalState` — survives extension restarts.
- The webview is built as a **single inline HTML string** (no separate webview compile step needed).
- Database files dropped into the workspace root are **auto-discovered** on activation.
- Export creates a **Save dialog** and writes via `vscode.workspace.fs`.

## Commands
| Command | Title |
|---|---|
| `null.database.open` | Open Database (file picker or URI) |
| `null.database.addConnection` | Add Database… (sidebar +) |
| `null.database.removeConnection` | Remove Database |
| `null.database.refresh` | Refresh Explorer |
| `null.database.openTable` | View Table Data |
| `null.database.queryTable` | Open SQL Query for table |
| `null.database.newQuery` | New SQL Query |
| `null.database.copyTableName` | Copy table name to clipboard |
| `null.database.exportTable` | Export table data (CSV/JSON) |

## Running tests
```
npm run test  # from extensions/null-database
```
or from repo root:
```
node --test extensions/null-database/out/exportHelper.test.js extensions/null-database/out/sqliteDriver.test.js
```

## Adding/Extending
- **New database drivers** (PostgreSQL, MySQL etc.): add an interface in `sqliteDriver.ts` and implement a new session class. The TreeView and Panel talk only to the session interface.
- **New webview features**: edit `buildWebviewHtml()` in `webviewPanel.ts`; messages flow as `vscode.postMessage` ↔ `window.addEventListener('message', ...)`.
- **Column context menus**: add `viewItem == column` conditions in `package.json` menus + a new command.
