# Recent Projects Launcher — Design

## Goal

Replace the current `More Recent Projects...` quick pick with a persistent,
full-featured project launcher. It must work when Null starts from the Windows
Jump List as well as from an existing window, and make previously opened
projects fast to find and manage.

## Scope

The implementation extends the existing shared
`<userData>/null-recent-projects.json` file and preserves its current entries.
It affects the Null Tools dashboard, the URI handler used by the Jump List,
the Windows Jump List patch, and the `null-tools` configuration.

It does not replace VS Code's File > Open Recent history or build a separate
workspace-management subsystem.

## Store

`recentProjects.ts` owns reading, validating, normalising, and mutating the
JSON store. Old entries remain valid: missing new properties receive defaults.

```ts
interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
  pinned?: boolean;
  gitBranch?: string;
  projectType?: string;
  icon?: string;
}
```

Paths are normalised for comparisons, but their original form is displayed.
Writes are atomic. Corrupt or unavailable data is treated as an empty list;
the launcher must never prevent Null from starting.

Opening a project moves it to the current timestamp while preserving
extension-managed fields such as `pinned`. The configured maximum,
`null.recentProjects.maxItems`, defaults to 20 and applies only to unpinned
entries. Pinned entries are always retained.

## Launcher

The dashboard is the project launcher. The existing startup patch already
opens it in an empty window. The Jump List `More Recent Projects...` URI
handler will therefore open or focus that dashboard instead of creating a
VS Code quick pick. This covers both cases:

- A cold Jump List launch starts Null and lands on the dashboard.
- A running Null instance receives the URI and opens/focuses the dashboard in
  its workbench.

Direct Jump List project entries remain one-click open actions.

The dashboard provides:

- a search field matching project label and path;
- sort choices for last opened (default), name, and location;
- a pinned section followed by parent-directory groups;
- cards with name, path, relative last-opened time, available/unavailable
  state, Git branch/status, and detected project type/icon when available;
- normal click to open a project;
- per-project actions: open in a new window, pin/unpin, reveal in Explorer,
  copy path, and remove;
- missing-project actions: locate a replacement directory or remove.

Grouping is derived only for rendering after search and sort. It has no
persisted group data or configuration. Git and type metadata are best-effort
and discovered asynchronously; failure leaves the card useful rather than
showing an error.

## Safety and Actions

The webview only renders data and sends typed action requests. The extension
host validates every request against a current stored entry before opening,
revealing, copying, removing, or relocating it. Relocation uses the native
folder picker and commits the new path only after it exists. Missing projects
are never silently removed.

## Main-Process Patch

The existing Jump List patch remains the component that records project opens.
It must read and preserve enhanced entry fields rather than rewriting them,
and use the configured retention policy instead of a fixed 50-item slice.
It continues to use the shared JSON file for direct Jump List entries and the
More Recent Projects URI task.

## Testing

Unit tests cover legacy entries, corrupt data, atomic mutations, pin
preservation, unpinned retention pruning, filter/sort/group output, removal,
and relocation. Extension-host UI wiring is type-checked. Manual verification
in a built Null package covers cold URI launch, direct Jump List opening, and
native Explorer/clipboard/folder-picker integration.

## Out of Scope

- Modifying VS Code's File > Open Recent and its built-in history.
- Persisting custom group definitions.
- A second recent-project store or a new dependency.
