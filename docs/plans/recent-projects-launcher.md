# Recent Projects Launcher Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make the Null Dashboard a safe, searchable project launcher backed by the existing shared recent-projects store and Windows Jump List.

**Architecture:** Keep `null-recent-projects.json` as the only history store. Extend `recentProjects.ts` into the synchronous, fault-tolerant store owner; let a small browser-side projection module filter, sort, and group entries; and have the dashboard extension host validate every webview action against a freshly read store entry. The existing dashboard custom editor remains the only launcher UI, while the URI handler opens that editor and the core patch continues to own Jump List recording/direct entries.

**Tech Stack:** TypeScript (strict, CommonJS and browser `module: none` builds), Node `node:test`, VS Code Extension API 1.85+, Node `fs`/`path`, existing Git subprocess helper, and a maintained VSCodium patch.

**Spec:** `docs/specs/recent-projects-design.md`

## Execution Options

Leave every box below unchecked. The executing skill resolves them with your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Preserve every valid existing `null-recent-projects.json` entry; absent enhanced fields normalize to their documented defaults.
- Use no new dependency and no second recent-project store.
- Treat missing, malformed, inaccessible, or concurrently unavailable store data as `[]`; neither the dashboard nor startup may fail because of it.
- Compare Windows paths case-insensitively after normalization, but continue displaying the stored path string.
- Atomically replace the store file by writing a sibling temporary file and renaming it; clean up the temporary file after a failed write where possible.
- `null.recentProjects.maxItems` defaults to `20`, has a positive integer minimum of `1`, and only prunes unpinned entries.
- Keep direct Jump List project entries as one-click opens; its More Recent Projects task opens/focuses the dashboard instead of a quick pick.
- Webview code renders data and sends typed intents only. The extension host must re-read and validate the referenced entry before every filesystem, clipboard, or project-opening side effect.
- Keep tracked `out/` and dashboard `lib/` compilation outputs in sync with source changes; never hand-edit them.

## Review Focus

- A legacy entry with only the four original fields must still display and be writable without losing its path, label, workspace flag, or timestamp. Covered by Task 1’s legacy-read/write test.
- A mix of pinned and unpinned entries above the cap must retain every pinned item and the newest allowed unpinned items. Covered by Task 1’s prune test.
- Search text, including a path-only match and case differences, must filter before grouping without producing empty group headings. Covered by Task 2’s projection tests.
- A stale webview action must not act on a removed or replaced entry, even if it supplies a plausible path. Covered by Task 4’s validation seam test.
- A missing selected project must offer relocation and only replace its path after the chosen directory exists. Covered by Task 4’s relocation helper test and packaged-build manual check.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `extensions/null-tools/src/recentProjects.ts` | Store schema, path identity, defensive reads, atomic writes, and all mutations. |
| `extensions/null-tools/src/recentProjects.test.ts` | Pure filesystem coverage for legacy data, corruption, atomic mutations, retention, removal, and relocation. |
| `extensions/null-tools/src/webview/recentProjects.ts` | Browser-only search/sort/group projection and relative-time formatting. |
| `extensions/null-tools/src/recentProjectsProjection.test.ts` | VM tests for the compiled browser projection (kept outside `src/webview/` so the CommonJS test build includes it). |
| `extensions/null-tools/src/dashboardGitStatus.ts` | Existing bounded Git work; extended only if the final card metadata needs a richer status shape. |
| `extensions/null-tools/src/dashboard.ts` | Dashboard host protocol, current-store validation, metadata dispatch, and safe action execution. |
| `extensions/null-tools/src/dashboardActions.ts` | Native dialog and filesystem helpers reused for locating/revealing/copying/opening projects. |
| `extensions/null-tools/src/dashboardIntegration.ts` | A reusable `openDashboard()` entry point plus custom-editor registration. |
| `extensions/null-tools/src/recentProjectsIntegration.ts` | URI routing changed from Quick Pick to `openDashboard()`. |
| `extensions/null-tools/src/webview/dashboard.ts` | Launcher controls, cards, menus, and typed messages; no privileged operations. |
| `extensions/null-tools/tsconfig.webview-recent-projects.json` | Compiles the new browser-only projection to `lib/recent-projects.js`. |
| `extensions/null-tools/tsconfig.json` | Includes the new VM test in the explicit CommonJS test compilation list. |
| `extensions/null-tools/package.json` | Browser build command, new tests, and the `null.recentProjects.maxItems` setting. |
| `patches/001-jumplist-recent-projects.patch` | Preserve enhanced fields and use the configured retention policy in the Electron main process. |
| `README.md` | Describe the dashboard as a project launcher and mention its management controls. |

### Task 1: Make `recentProjects.ts` the complete shared-store owner

**Files:**
- Modify: `extensions/null-tools/src/recentProjects.ts`
- Modify: `extensions/null-tools/src/recentProjects.test.ts`
- Modify: `extensions/null-tools/package.json`

**Interfaces:**
- Produces:
  ```ts
  export interface RecentProjectEntry {
    path: string;
    label: string;
    isWorkspaceFile: boolean;
    timestamp: number;
    pinned: boolean;
    gitBranch?: string;
    projectType?: string;
    icon?: string;
  }
  export function normalizeRecentProjectPath(value: string): string;
  export function readRecentProjects(filePath: string): RecentProjectEntry[];
  export function writeRecentProjects(filePath: string, entries: RecentProjectEntry[]): boolean;
  export function updateRecentProjects(
    filePath: string,
    mutate: (entries: RecentProjectEntry[]) => RecentProjectEntry[],
    maxItems: number,
  ): boolean;
  export function touchRecentProject(
    filePath: string, entry: Omit<RecentProjectEntry, 'timestamp'>, maxItems: number,
  ): boolean;
  export function setRecentProjectPinned(
    filePath: string, requestedPath: string, pinned: boolean, maxItems: number,
  ): boolean;
  export function removeRecentProject(filePath: string, requestedPath: string, maxItems: number): boolean;
  export function replaceRecentProjectPath(
    filePath: string, requestedPath: string, replacementPath: string, replacementLabel: string, maxItems: number,
  ): boolean;
  ```
- Consumed by Tasks 3–5 and by the revised Jump List patch.

- [ ] **Step 1: Add failing store tests using a dedicated temporary directory**

  Add tests that write literal legacy JSON, invalid array members, malformed JSON, and a mixed pinned/unpinned list. Assert the public read returns normalized valid entries and that mutations keep enhanced fields:

  ```ts
  test('legacy entries receive defaults and unknown members are ignored', () => {
    writeFileSync(file, JSON.stringify([
      { path: 'C:\\Code\\App', label: 'App', isWorkspaceFile: false, timestamp: 7 },
      { path: 42 },
    ]));
    assert.deepStrictEqual(readRecentProjects(file), [{
      path: 'C:\\Code\\App', label: 'App', isWorkspaceFile: false,
      timestamp: 7, pinned: false,
    }]);
  });

  test('retention drops only oldest unpinned entries', () => {
    updateRecentProjects(file, entries => entries, 2);
    assert.deepStrictEqual(readRecentProjects(file).map(({ label }) => label), ['Pinned', 'Newest', 'Middle']);
  });
  ```

- [ ] **Step 2: Run the tests and confirm they fail for the missing mutation and default behavior**

  Run: `cd extensions/null-tools; npx tsc -p tsconfig.json; node --test out/recentProjects.test.js`

  Expected: FAIL because the new store API/default normalization is absent.

- [ ] **Step 3: Implement the smallest defensive store API**

  Validate each parsed object before accepting it, default `pinned` to `false`, discard malformed entries, and use `path.resolve(...).toLowerCase()` as the comparison key on Windows. Implement updates as read → mutate a copy → dedupe by normalized key → sort newest-first → retain all pinned plus the newest `maxItems` unpinned entries → write `${filePath}.${process.pid}.tmp` → rename. Return `false` rather than throw on any I/O failure.

  Implement the declared `touchRecentProject`, `setRecentProjectPinned`, `removeRecentProject`, and `replaceRecentProjectPath` helpers. Touch/upsert must preserve existing enhanced fields; the replacement helper only changes path/label after its caller has verified the directory. Do not let dashboard callers write arrays directly.

- [ ] **Step 4: Extend tests to pin the mutation contract and atomic output**

  Assert touch preserves `{ pinned, gitBranch, projectType, icon }`, case-variant paths dedupe, removal only removes its selected identity, and no `*.tmp` file remains after both successful and failed writes. Add the compiled test to the existing `package.json` `test` command if it is not already covered by the existing filename.

- [ ] **Step 5: Run the extension test suite and commit**

  Run: `cd extensions/null-tools; npm test`

  Expected: PASS, including the expanded recent-project store tests.

  ```bash
  git add extensions/null-tools/src/recentProjects.ts extensions/null-tools/src/recentProjects.test.ts extensions/null-tools/package.json
  git commit -m "feat(null-tools): manage enhanced recent project entries"
  ```

### Task 2: Add a tested browser-side project projection

**Files:**
- Create: `extensions/null-tools/src/webview/recentProjects.ts`
- Create: `extensions/null-tools/src/recentProjectsProjection.test.ts`
- Create: `extensions/null-tools/tsconfig.webview-recent-projects.json`
- Modify: `extensions/null-tools/tsconfig.json`
- Modify: `extensions/null-tools/package.json`

**Interfaces:**
- Produces browser globals compiled to `lib/recent-projects.js`:
  ```ts
  interface LauncherProject extends RecentProjectEntry {
    available: boolean;
    gitStatus: GitStatus | null;
  }
  function projectSections(
    projects: LauncherProject[],
    query: string,
    sort: 'lastOpened' | 'name' | 'location',
  ): Array<{ kind: 'pinned' | 'directory'; title: string; projects: LauncherProject[] }>;
  function relativeProjectTime(timestamp: number, now?: number): string;
  ```
- Consumed by Task 3’s dashboard webview.

- [ ] **Step 1: Write VM tests for filtering, ordering, grouping, and time labels**

  Follow `webviewShared.test.ts`: compile the browser script, load it with `vm.runInContext`, and assert its globals. Include a path-only case-insensitive search, pinned-before-unpinned output, `name` and `location` sort order, and no directory section when its final filtered list is empty.

  ```ts
  assert.deepStrictEqual(
    projection.projectSections(projects, 'D:/work', 'location').map(section => section.title),
    ['Pinned', 'D:\\work'],
  );
  assert.strictEqual(projection.relativeProjectTime(NOW - 60_000, NOW), '1 minute ago');
  ```

- [ ] **Step 2: Run the new browser test and confirm it fails**

  Run: `cd extensions/null-tools; npx tsc -p tsconfig.webview-recent-projects.json; npx tsc -p tsconfig.json; node --test out/recentProjectsProjection.test.js`

  Expected: FAIL because the projection source/configuration does not exist.

- [ ] **Step 3: Implement only deterministic rendering preparation**

  Put no VS Code API, filesystem read, persistence, Node imports, or side effect in this file. Normalize query text for matching, form the pinned section first, calculate directory headings with a local separator-aware string helper after filtering and sorting, and calculate concise relative times with a deterministic `now` parameter for tests.

- [ ] **Step 4: Register build and test entry points, then verify**

  Add `src/recentProjectsProjection.test.ts` to the explicit `tsconfig.json` include array. Add `tsc -p tsconfig.webview-recent-projects.json` to `compile`; compile this script before its VM test in `test`. Run: `cd extensions/null-tools; npm test`

  Expected: PASS; `lib/recent-projects.js` is refreshed and tracked with its source.

- [ ] **Step 5: Commit**

  ```bash
  git add extensions/null-tools/src/webview/recentProjects.ts extensions/null-tools/src/recentProjectsProjection.test.ts extensions/null-tools/tsconfig.webview-recent-projects.json extensions/null-tools/tsconfig.json extensions/null-tools/package.json extensions/null-tools/lib/recent-projects.js
  git commit -m "feat(null-tools): add recent project search and grouping projection"
  ```

### Task 3: Turn the dashboard webview into the launcher UI

**Files:**
- Modify: `extensions/null-tools/src/webview/dashboard.ts`
- Modify: `extensions/null-tools/src/dashboard.ts`

**Interfaces:**
- Consumes: `projectSections()` and `relativeProjectTime()` from Task 2 and entries from Task 1.
- Produces a discriminated protocol shared textually by host and browser:
  ```ts
  type DashboardAction =
    | { type: 'openProject'; path: string; forceNewWindow: boolean }
    | { type: 'setPinned'; path: string; pinned: boolean }
    | { type: 'revealProject'; path: string }
    | { type: 'copyProjectPath'; path: string }
    | { type: 'removeProject'; path: string }
    | { type: 'locateProject'; path: string };
  ```
- Consumed by Task 4.

- [ ] **Step 1: Add the external projection script and launcher controls to dashboard HTML**

  In `_buildHtml`, allow `lib/recent-projects.js` in `localResourceRoots`, emit it before `dashboard.js`, and add a labelled search input plus a labelled sort select (`Last opened`, `Name`, `Location`). Preserve the existing New Project, Clone Repo, Open Folder, and refresh controls.

- [ ] **Step 2: Render safe card DOM nodes and accessibility-complete menus**

  Replace the current `innerHTML` card template with created elements/text content for every stored label/path/metadata value. Render availability, relative time, async Git branch/dirty state, detected type/icon, pinned cards, and directory headings using Task 2’s projection. Each card opens normally on click/Enter; an action button stops propagation and opens keyboard-accessible actions for open new window, pin/unpin, reveal, copy path, and remove. Missing cards expose Locate and Remove only.

- [ ] **Step 3: Emit only typed intents and redraw from host snapshots**

  Maintain search/sort/UI-only menu state in the webview. On a host `projects` snapshot, rebuild the projection and discard stale Git metadata; on progressive `gitStatus`/metadata messages, update the matching rendered card. Never use a webview-supplied path as trusted authority—the host validates it in Task 4.

- [ ] **Step 4: Compile and smoke-check the dashboard bundle**

  Run: `cd extensions/null-tools; npm run compile`

  Expected: PASS with refreshed `lib/dashboard.js`; inspect that raw labels and paths are assigned by `textContent`, not interpolated into HTML.

- [ ] **Step 5: Commit**

  ```bash
  git add extensions/null-tools/src/webview/dashboard.ts extensions/null-tools/src/dashboard.ts extensions/null-tools/lib/dashboard.js
  git commit -m "feat(null-tools): render the dashboard as a project launcher"
  ```

### Task 4: Validate and execute launcher actions in the extension host

**Files:**
- Modify: `extensions/null-tools/src/dashboard.ts`
- Modify: `extensions/null-tools/src/dashboardActions.ts`
- Create: `extensions/null-tools/src/dashboardLauncher.test.ts`
- Modify: `extensions/null-tools/package.json`

**Interfaces:**
- Consumes: Task 1 mutation helpers and Task 3 `DashboardAction` shape.
- Produces:
  ```ts
  export function findCurrentRecentProject(
    filePath: string, requestedPath: string,
  ): RecentProjectEntry | undefined;
  export function relocateRecentProject(
    filePath: string, requestedPath: string, replacementPath: string, maxItems: number,
  ): boolean;
  ```

- [ ] **Step 1: Write failing host-independent validation tests**

  Exercise a pure lookup helper against a fixture store. It must reject a path absent from the current file, accept a case-variant current path, and reject it after a separate removal. Test relocation returns `false` for a non-directory and leaves the original record untouched; test it preserves pin state and updates label only after an existing directory is supplied.

- [ ] **Step 2: Run the focused test to confirm the trust boundary is absent**

  Run: `cd extensions/null-tools; npx tsc -p tsconfig.json; node --test out/dashboardLauncher.test.js`

  Expected: FAIL because the validation/relocation helpers do not exist.

- [ ] **Step 3: Implement current-entry lookup and native effects behind it**

  On every incoming project action, read the store again and resolve its normalized identity before calling any VS Code API. Reject stale/unknown requests silently and refresh the dashboard. For a validated entry, use `vscode.openFolder` (including `forceNewWindow`), `revealFileInOS`, and `vscode.env.clipboard.writeText`; mutate pin/remove through Task 1; and reload the project list after success.

  For Locate, invoke `showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false })`, use the selected folder only if `fs.statSync(...).isDirectory()`, then commit relocation. Never auto-delete an unavailable path. Keep failures as `showErrorMessage` messages and keep the dashboard usable.

- [ ] **Step 4: Preserve asynchronous enrichment as best effort**

  Extend the existing bounded Git-status dispatch only as needed to send its branch/status as card metadata. Add a small synchronous type detector using existing files (`package.json`, `Cargo.toml`, `CMakeLists.txt`, `*.sln`/`*.csproj`) and a fixed icon/type mapping. Catch per-project inspection failures and send no enrichment rather than an error; do not persist a transient failed lookup.

- [ ] **Step 5: Add the new test to the package command, run all tests, and commit**

  Run: `cd extensions/null-tools; npm test`

  Expected: PASS, including stale-action and relocation coverage.

  ```bash
  git add extensions/null-tools/src/dashboard.ts extensions/null-tools/src/dashboardActions.ts extensions/null-tools/src/dashboardLauncher.test.ts extensions/null-tools/src/dashboardGitStatus.ts extensions/null-tools/package.json
  git commit -m "feat(null-tools): validate project launcher actions"
  ```

### Task 5: Route More Recent Projects to the dashboard and configure retention

**Files:**
- Modify: `extensions/null-tools/src/dashboardIntegration.ts`
- Modify: `extensions/null-tools/src/recentProjectsIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts`
- Modify: `extensions/null-tools/package.json`
- Modify: `patches/001-jumplist-recent-projects.patch`

**Interfaces:**
- Produces:
  ```ts
  export function openDashboard(): Thenable<unknown>;
  ```
- `registerRecentProjectsUriHandler()` consumes `openDashboard()` instead of building a Quick Pick.

- [ ] **Step 1: Add `openDashboard()` and route the URI handler through it**

  Centralize opening `URI.from({ scheme: 'null-dashboard', path: '/Dashboard' })` with the existing `null.dashboard` custom editor in `dashboardIntegration.ts`. Have `/recent-projects` call it unconditionally and remove the Quick Pick/read/open-folder code. Confirm the helper works whether the extension host was activated by startup or by the URI event, and register the dashboard provider before the URI handler in `activate()`.

- [ ] **Step 2: Declare and consume `null.recentProjects.maxItems`**

  Add this contributed setting to the existing `null-tools` configuration:

  ```json
  "null.recentProjects.maxItems": {
    "type": "number",
    "default": 20,
    "minimum": 1,
    "description": "Maximum number of unpinned projects retained by the Null recent-projects launcher. Pinned projects are always retained."
  }
  ```

  Clamp malformed runtime configuration to the default before passing it to store mutations. Do not add a separate launch-list setting.

- [ ] **Step 3: Rebase the maintained Electron-main patch against the pinned `MS_TAG`**

  In the upstream `WorkspacesHistoryMainService` patch, replace local four-field interfaces/read-write code with the same defensive enhanced-field preservation rules used by the store. Inject/read the configuration service available at that upstream revision, clamp `null.recentProjects.maxItems`, and replace the fixed `slice(0, 50)` retention with “all pinned plus newest configured unpinned.” Keep the direct Jump List category capped by Electron’s `minItems`, preserve the More Recent URI task, and retain non-fatal log-and-continue behavior for any store I/O error.

  Re-export the patch with its existing filename and confirm it applies in CI’s documented order; do not make a local full VSCodium build.

- [ ] **Step 4: Type-check and manually verify the routing boundary**

  Run: `cd extensions/null-tools; npm run compile; npm test`

  Expected: PASS. In a locally synced Null IDE, invoke `null://null.null-tools/recent-projects` and confirm it focuses/opens the dashboard rather than showing a Quick Pick.

- [ ] **Step 5: Commit**

  ```bash
  git add extensions/null-tools/src/dashboardIntegration.ts extensions/null-tools/src/recentProjectsIntegration.ts extensions/null-tools/src/extension.ts extensions/null-tools/package.json patches/001-jumplist-recent-projects.patch
  git commit -m "feat: open recent projects in the Null dashboard"
  ```

### Task 6: Document and verify the packaged Windows behavior

**Files:**
- Modify: `README.md`
- Modify: tracked `extensions/null-tools/out/` and `extensions/null-tools/lib/` files generated by Tasks 1–5

**Interfaces:**
- Consumes the built extension and patch from Tasks 1–5.
- Produces user-facing documentation and release-ready verification evidence.

- [ ] **Step 1: Update the project-dashboard highlight**

  Replace the existing generic dashboard wording with a concise statement that it is the recent-project launcher: search/sort, pin/manage projects, best-effort Git/type details, and New Project/Clone Repo/Open Folder remain available. Do not document unsupported custom groups or a second history.

- [ ] **Step 2: Compile and run all extension tests from a clean generated-output state**

  Run: `cd extensions/null-tools; npm run compile; npm test`

  Expected: PASS; review `git diff -- extensions/null-tools/out extensions/null-tools/lib` to ensure outputs correspond only to source changes.

- [ ] **Step 3: Perform packaged-build manual verification**

  Trigger the existing CI build and install its ZIP or installer. Verify:

  1. A cold Jump List `More Recent Projects...` launch opens Null on the dashboard.
  2. Calling the URI while Null is already running opens/focuses the dashboard in that workbench.
  3. Direct Jump List project entries still open their project in one action.
  4. Search matches both label and path; all three sort choices and pinned-first grouping work.
  5. Pin/unpin, open in new window, reveal, copy, and remove work only for current entries.
  6. A deleted project shows Locate/Remove; Locate rejects a non-directory and preserves the entry until a real replacement is chosen.
  7. Git/type inspection failure leaves cards usable, and `maxItems` prunes only unpinned projects.

- [ ] **Step 4: Commit generated assets and documentation**

  ```bash
  git add README.md extensions/null-tools/out extensions/null-tools/lib
  git commit -m "docs: describe the recent projects launcher"
  ```

## Self-Review

- **Spec coverage:** Tasks 1 and 5 cover the enhanced, backward-compatible shared store, atomic persistence, configured retention, and main-process preservation. Tasks 2–4 cover launcher search/sort/grouping, card metadata, all requested actions, missing-project recovery, typed webview messages, and extension-host validation. Task 5 covers cold/running URI behavior and direct Jump List preservation. Task 6 covers the required CI/package integration verification.
- **Placeholder scan:** No unfinished implementation steps remain; upstream patch rebasing explicitly names the affected service and acceptance condition.
- **Type consistency:** Store identity is a `path` string throughout. Browser action messages and host validation both use `DashboardAction` with `path`; mutations are owned by `recentProjects.ts`.
- **Review Focus:** Each of the five listed failure modes has an assigned unit test or, for native Windows integration, explicit packaged-build verification.

## Execution Handoff

Plan complete and saved to `docs/plans/recent-projects-launcher.md`. Please review the plan. Does it capture what you want?
