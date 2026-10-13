# Null Workspace Hub Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Turn the Null Workspace Activity Bar container into the single home for Null IDE features: a categorized Features launcher fed by `nullWorkspace` blocks in each extension's `package.json`, with Music moved in and its own Activity Bar entry removed.

**Architecture:** A pure `featureRegistry.ts` in `null-tools` turns the manifests of all installed `null.*` extensions into ordered categories. A thin `featuresTreeView.ts` renders them as the first view of the existing `null-workspace` container; each node runs its command. Other extensions only add JSON. `null-music` contributes its webview into `null-workspace` instead of owning a container.

**Tech Stack:** TypeScript, VS Code extension API (TreeDataProvider), `node --test` for unit tests.

**Spec:** [docs/specs/null-workspace-hub-design.md](../specs/null-workspace-hub-design.md) (issue #133)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Only extensions whose id starts with `null.` (case-insensitive) contribute launcher entries.
- Launcher entries are static: label, optional description, icon, command. No live state.
- Fixed category order: `develop` (Develop), `insights` (Insights), `account` (Account & Sync), `setup` (Setup); unknown categories are appended alphabetically with the id capitalized as title; empty categories are not shown.
- Entry defaults: icon `symbol-misc`, order `100`. Sort by `order`, then label.
- Global entry key is `<extensionId>/<id>`; on a duplicate key the first wins.
- Default view state: `null.featuresView` `"visibility": "visible"`; Scratch, Notes, Ports, Worktrees and Music `"visibility": "collapsed"`.
- GitHub Issues keeps its own Activity Bar container; Music's container is removed and `retainContextWhenHidden: true` stays.
- `nullWorkspace` is a top-level `package.json` key, a sibling of `contributes`.
- `out/` is tracked: after editing `src/`, run `npm run compile` in that extension and commit the refreshed `out/` in a separate `chore: refresh <ext> compiled output (#133)` commit. Never hand-edit `out/`.
- A new test file must be added to the explicit `node --test` list in the extension's `package.json` `test` script, or it is silently skipped.
- Source files start with `'use strict';`. Do not push. Do not amend commits. Commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Do not commit the unrelated uncommitted changes already in the working tree (`.impeccable/config.json`, `docs/plans/null-env-environment-check.md`, `docs/plans/null-markdown-editor.md`, `extensions/null-markdown/*`).

## Review Focus

1. A `nullWorkspace` block that is `null`, a string, or has `features` that is not an array must not throw or hide other extensions' entries (Task 1 test).
2. One malformed entry (missing/non-string `id`, `label`, `command` or `category`) is dropped and the valid entries around it survive (Task 1 test).
3. An extension that is not publisher `null` cannot add entries, including with an upper-case `Null.` id still being accepted (Task 1 test).
4. The same `id` in two different extensions both show; the same `id` twice in one extension keeps the first (Task 1 test).
5. An entry whose `command` is not declared by any extension's `contributes.commands` would be a dead click; a drift test over the real manifests catches a typo (Task 3 test).

---

### Task 1: Pure feature registry

**Files:**
- Create: `extensions/null-tools/src/featureRegistry.ts`
- Create: `extensions/null-tools/src/featureRegistry.test.ts`
- Modify: `extensions/null-tools/package.json` (`scripts.test`: append `out/featureRegistry.test.js`)

**Interfaces:**
- Consumes: nothing.
- Produces (used by Tasks 2 and 3):
  - `interface Feature { key: string; label: string; command: string; category: string; icon: string; description?: string; order: number }`
  - `interface FeatureCategory { id: string; title: string; features: Feature[] }`
  - `interface ManifestInput { extensionId: string; packageJSON: unknown }`
  - `collectFeatures(manifests: ManifestInput[], warn?: (message: string) => void): FeatureCategory[]`

- [ ] **Step 1: Write the failing test**

Create `extensions/null-tools/src/featureRegistry.test.ts`:

```ts
import assert from 'node:assert';
import test from 'node:test';
import { collectFeatures, FeatureCategory, ManifestInput } from './featureRegistry';

const entry = (over: Record<string, unknown> = {}) => ({
  id: 'a', label: 'A', command: 'x.a', category: 'develop', ...over,
});
const manifest = (extensionId: string, features: unknown): ManifestInput => ({
  extensionId,
  packageJSON: { nullWorkspace: { features } },
});
const shape = (cats: FeatureCategory[]) =>
  cats.map(c => [c.id, c.features.map(f => f.label)]);

test('groups in the fixed category order whatever the input order', () => {
  const result = collectFeatures([
    manifest('null.one', [
      entry({ id: 'e', label: 'Env', category: 'setup' }),
      entry({ id: 'a', label: 'Acc', category: 'account' }),
      entry({ id: 'd', label: 'Dash', category: 'develop' }),
      entry({ id: 'i', label: 'Act', category: 'insights' }),
    ]),
  ]);
  assert.deepStrictEqual(shape(result), [
    ['develop', ['Dash']], ['insights', ['Act']], ['account', ['Acc']], ['setup', ['Env']],
  ]);
  assert.strictEqual(result[2].title, 'Account & Sync');
});

test('sorts by order, then label, and applies defaults', () => {
  const [cat] = collectFeatures([
    manifest('null.one', [
      entry({ id: 'z', label: 'Zed', order: 5 }),
      entry({ id: 'b', label: 'Bee' }),
      entry({ id: 'a', label: 'Ant' }),
    ]),
  ]);
  assert.deepStrictEqual(cat.features.map(f => f.label), ['Zed', 'Ant', 'Bee']);
  assert.strictEqual(cat.features[1].order, 100);
  assert.strictEqual(cat.features[1].icon, 'symbol-misc');
});

test('appends unknown categories alphabetically with a capitalized title', () => {
  const result = collectFeatures([
    manifest('null.one', [
      entry({ id: 'p', category: 'zeta' }),
      entry({ id: 'q', category: 'alpha' }),
      entry({ id: 'r', category: 'setup' }),
    ]),
  ]);
  assert.deepStrictEqual(result.map(c => c.id), ['setup', 'alpha', 'zeta']);
  assert.strictEqual(result[1].title, 'Alpha');
});

test('ignores extensions that are not publisher null, accepts Null. in any case', () => {
  const result = collectFeatures([
    manifest('evil.ext', [entry({ id: 'x', label: 'Evil' })]),
    manifest('Null.Mixed', [entry({ id: 'm', label: 'Mixed' })]),
  ]);
  assert.deepStrictEqual(shape(result), [['develop', ['Mixed']]]);
});

test('malformed blocks never throw and do not hide other extensions', () => {
  const warnings: string[] = [];
  const result = collectFeatures(
    [
      { extensionId: 'null.a', packageJSON: null },
      { extensionId: 'null.b', packageJSON: 'text' },
      { extensionId: 'null.c', packageJSON: {} },
      { extensionId: 'null.d', packageJSON: { nullWorkspace: null } },
      { extensionId: 'null.e', packageJSON: { nullWorkspace: { features: 'nope' } } },
      manifest('null.good', [entry({ label: 'Good' })]),
    ],
    m => warnings.push(m),
  );
  assert.deepStrictEqual(shape(result), [['develop', ['Good']]]);
  assert.strictEqual(warnings.length, 2); // null.d and null.e; missing blocks are silent
});

test('drops malformed entries and keeps the valid ones around them', () => {
  const warnings: string[] = [];
  const result = collectFeatures(
    [manifest('null.one', [
      entry({ id: 'ok1', label: 'One' }),
      entry({ id: 'bad1', label: 42 }),
      entry({ id: 'bad2', command: '' }),
      entry({ id: undefined }),
      'not an object',
      entry({ id: 'ok2', label: 'Two', order: 'x' }),
    ])],
    m => warnings.push(m),
  );
  assert.deepStrictEqual(shape(result), [['develop', ['One', 'Two']]]);
  assert.strictEqual(warnings.length, 4);
});

test('same id in two extensions both show; same id twice in one keeps the first', () => {
  const result = collectFeatures([
    manifest('null.one', [entry({ label: 'First' }), entry({ label: 'Second' })]),
    manifest('null.two', [entry({ label: 'Other' })]),
  ]);
  assert.deepStrictEqual(shape(result), [['develop', ['First', 'Other']]]);
  assert.deepStrictEqual(result[0].features.map(f => f.key), ['null.one/a', 'null.two/a']);
});
```

- [ ] **Step 2: Add the test to the explicit list and run it to verify it fails**

In `extensions/null-tools/package.json`, append ` out/featureRegistry.test.js` to the end of the `node --test …` list in `scripts.test`.

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json`
Expected: FAIL with `Cannot find module './featureRegistry'`.

- [ ] **Step 3: Write the minimal implementation**

Create `extensions/null-tools/src/featureRegistry.ts`:

```ts
'use strict';

export interface Feature {
  /** `<extensionId>/<id>`, unique across all extensions. */
  key: string;
  label: string;
  command: string;
  category: string;
  icon: string;
  description?: string;
  order: number;
}

export interface FeatureCategory {
  id: string;
  title: string;
  features: Feature[];
}

export interface ManifestInput {
  extensionId: string;
  packageJSON: unknown;
}

const CATEGORIES = [
  { id: 'develop', title: 'Develop' },
  { id: 'insights', title: 'Insights' },
  { id: 'account', title: 'Account & Sync' },
  { id: 'setup', title: 'Setup' },
];
const DEFAULT_ICON = 'symbol-misc';
const DEFAULT_ORDER = 100;
const PUBLISHER_PREFIX = 'null.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseEntry(extensionId: string, raw: unknown): Feature | undefined {
  if (!isRecord(raw)) { return undefined; }
  const id = text(raw.id);
  const label = text(raw.label);
  const command = text(raw.command);
  const category = text(raw.category);
  if (!id || !label || !command || !category) { return undefined; }
  const order = typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : DEFAULT_ORDER;
  return {
    key: `${extensionId}/${id}`,
    label,
    command,
    category,
    icon: text(raw.icon) ?? DEFAULT_ICON,
    description: text(raw.description),
    order,
  };
}

/**
 * Collects `nullWorkspace.features` from the manifests of `null.*` extensions into ordered
 * categories. Bad input is skipped (and reported through `warn`), never thrown.
 */
export function collectFeatures(
  manifests: ManifestInput[],
  warn: (message: string) => void = () => undefined,
): FeatureCategory[] {
  const seen = new Set<string>();
  const byCategory = new Map<string, Feature[]>();

  for (const { extensionId, packageJSON } of manifests) {
    if (!extensionId.toLowerCase().startsWith(PUBLISHER_PREFIX) || !isRecord(packageJSON)) { continue; }
    const block = packageJSON.nullWorkspace;
    if (block === undefined) { continue; }
    const list = isRecord(block) ? block.features : undefined;
    if (!Array.isArray(list)) {
      warn(`${extensionId}: nullWorkspace.features must be an array`);
      continue;
    }
    for (const raw of list) {
      const feature = parseEntry(extensionId, raw);
      if (!feature) {
        warn(`${extensionId}: skipped a malformed nullWorkspace feature`);
        continue;
      }
      if (seen.has(feature.key)) {
        warn(`${extensionId}: duplicate feature ${feature.key}`);
        continue;
      }
      seen.add(feature.key);
      const group = byCategory.get(feature.category);
      if (group) { group.push(feature); } else { byCategory.set(feature.category, [feature]); }
    }
  }

  const known = CATEGORIES.map(c => c.id);
  const unknown = [...byCategory.keys()].filter(id => !known.includes(id)).sort();
  const titles = new Map(CATEGORIES.map(c => [c.id, c.title]));
  return [...known, ...unknown]
    .filter(id => byCategory.has(id))
    .map(id => ({
      id,
      title: titles.get(id) ?? id.charAt(0).toUpperCase() + id.slice(1),
      features: byCategory.get(id)!.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
    }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/null-tools && npx tsc -p tsconfig.json && node --test out/featureRegistry.test.js`
Expected: 7 tests PASS.

- [ ] **Step 5: Commit the source, then the refreshed output**

```bash
git add extensions/null-tools/src/featureRegistry.ts extensions/null-tools/src/featureRegistry.test.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): feature registry for the Null Workspace launcher (#133)"
cd extensions/null-tools && npm run compile && cd ../..
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output (#133)"
```

(End each commit message with the `Co-Authored-By` line from Global Constraints.)

---

### Task 2: Features tree view in the Null Workspace container

**Files:**
- Create: `extensions/null-tools/src/featuresTreeView.ts`
- Modify: `extensions/null-tools/src/extension.ts` (import + one registration call)
- Modify: `extensions/null-tools/package.json` (`contributes.views["null-workspace"]`; new top-level `nullWorkspace`)

**Interfaces:**
- Consumes: `collectFeatures`, `Feature`, `FeatureCategory` from Task 1.
- Produces: `registerFeaturesView(context: vscode.ExtensionContext): void`, view id `null.featuresView`.

- [ ] **Step 1: Write the tree provider**

Create `extensions/null-tools/src/featuresTreeView.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { collectFeatures, Feature, FeatureCategory } from './featureRegistry';

type Node = FeatureCategory | Feature;

function isCategory(node: Node): node is FeatureCategory {
  return 'features' in node;
}

export class FeaturesTreeProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private categories: FeatureCategory[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor() {
    this.reload();
  }

  reload(): void {
    this.categories = collectFeatures(
      vscode.extensions.all.map(e => ({ extensionId: e.id, packageJSON: e.packageJSON })),
      message => console.warn(`[null-workspace] ${message}`),
    );
    this.changed.fire();
  }

  getChildren(element?: Node): Node[] {
    if (!element) { return this.categories; }
    return isCategory(element) ? element.features : [];
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (isCategory(element)) {
      const item = new vscode.TreeItem(element.title, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `category/${element.id}`;
      return item;
    }
    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.id = element.key;
    item.description = element.description;
    item.tooltip = element.description ? `${element.label} — ${element.description}` : element.label;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    item.command = { command: element.command, title: element.label };
    return item;
  }

  dispose(): void {
    this.changed.dispose();
  }
}

export function registerFeaturesView(context: vscode.ExtensionContext): void {
  const provider = new FeaturesTreeProvider();
  context.subscriptions.push(
    provider,
    vscode.window.registerTreeDataProvider('null.featuresView', provider),
    vscode.extensions.onDidChange(() => provider.reload()),
  );
}
```

- [ ] **Step 2: Register it in `extension.ts`**

Add next to the other imports:

```ts
import { registerFeaturesView } from './featuresTreeView';
```

and call `registerFeaturesView(context);` in `activate`, directly before the existing `registerScratchAndNotesFeature(...)` call (use the same argument style as that line).

- [ ] **Step 3: Declare the view, default states and the two `null-tools` entries**

In `extensions/null-tools/package.json`, replace `contributes.views["null-workspace"]` with:

```json
"null-workspace": [
  { "id": "null.featuresView", "name": "Features", "visibility": "visible" },
  { "id": "null.scratchView", "name": "Scratch Files", "visibility": "collapsed" },
  { "id": "null.notesView", "name": "Notes", "visibility": "collapsed" },
  { "id": "null.portsView", "name": "Null Ports", "visibility": "collapsed" },
  { "id": "null.worktreesView", "name": "Worktrees", "visibility": "collapsed" }
],
```

Add a top-level key (sibling of `contributes`, not inside it):

```json
"nullWorkspace": {
  "features": [
    { "id": "dashboard", "label": "Dashboard", "category": "develop", "icon": "home",
      "command": "null.showWelcome", "description": "Projects & recent folders", "order": 10 },
    { "id": "issues", "label": "GitHub Issues", "category": "develop", "icon": "issues",
      "command": "null.issues.openFullView", "description": "Full-width issue list", "order": 20 }
  ]
},
```

- [ ] **Step 4: Compile and run the unit tests**

Run: `cd extensions/null-tools && npm test`
Expected: compiles with no errors; all tests PASS (including the 7 from Task 1).

- [ ] **Step 5: Commit the source, then the refreshed output**

```bash
git add extensions/null-tools/src/featuresTreeView.ts extensions/null-tools/src/extension.ts extensions/null-tools/package.json
git commit -m "feat(null-tools): Features launcher view in Null Workspace (#133)"
cd extensions/null-tools && npm run compile && cd ../..
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output (#133)"
```

---

### Task 3: Entries in the other extensions, guarded by a manifest drift test

**Files:**
- Create: `extensions/null-tools/src/featureManifests.test.ts`
- Modify: `extensions/null-tools/package.json` (`scripts.test`: append `out/featureManifests.test.js`)
- Modify: `package.json` of `null-accounts`, `null-activity`, `null-startup`, `null-sync`, `null-env`, `null-actions`, `null-format` (under `extensions/`)

**Interfaces:**
- Consumes: `collectFeatures` (Task 1); the two `null-tools` entries (Task 2).
- Produces: the nine launcher entries.

- [ ] **Step 1: Write the failing drift test**

Create `extensions/null-tools/src/featureManifests.test.ts`:

```ts
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import test from 'node:test';
import { collectFeatures } from './featureRegistry';

// out/ -> null-tools -> extensions
const extensionsDir = path.resolve(__dirname, '..', '..');

function readManifests() {
  return fs.readdirSync(extensionsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(extensionsDir, d.name, 'package.json'))
    .filter(p => fs.existsSync(p))
    .map(p => {
      const json = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { extensionId: `${json.publisher}.${json.name}`, packageJSON: json };
    });
}

test('the real manifests declare exactly the agreed launcher entries', () => {
  const warnings: string[] = [];
  const result = collectFeatures(readManifests(), m => warnings.push(m));
  assert.deepStrictEqual(warnings, []);
  assert.deepStrictEqual(
    result.map(c => [c.id, c.features.map(f => f.label)]),
    [
      ['develop', ['Dashboard', 'GitHub Issues']],
      ['insights', ['Activity Dashboard', 'Startup Report']],
      ['account', ['Accounts', 'Sync Status']],
      ['setup', ['Environment Check', 'Actions Settings', 'Formatting Settings']],
    ],
  );
});

test('every launcher command is declared by some extension', () => {
  const manifests = readManifests();
  const declared = new Set<string>();
  for (const { packageJSON } of manifests) {
    const commands = (packageJSON as { contributes?: { commands?: { command: string }[] } }).contributes?.commands ?? [];
    for (const c of commands) { declared.add(c.command); }
  }
  for (const category of collectFeatures(manifests)) {
    for (const feature of category.features) {
      assert.ok(declared.has(feature.command), `${feature.key} runs undeclared command ${feature.command}`);
    }
  }
});
```

Append ` out/featureManifests.test.js` to the `node --test …` list in `scripts.test`.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd extensions/null-tools && npm test`
Expected: FAIL in `the real manifests declare exactly the agreed launcher entries` (only the two develop entries exist).

- [ ] **Step 3: Add the entries**

In each file, add a top-level `nullWorkspace` key as a sibling of `contributes`. All entries use the shape below; only these values change:

| File | id | label | category | icon | command | description | order |
|---|---|---|---|---|---|---|---|
| `null-activity/package.json` | `activity` | Activity Dashboard | insights | `graph` | `null-activity.openDashboard` | Coding time & git stats | 10 |
| `null-startup/package.json` | `startup` | Startup Report | insights | `pulse` | `null-startup.openReport` | What slows startup | 20 |
| `null-accounts/package.json` | `accounts` | Accounts | account | `account` | `null-accounts.open` | GitHub & GitLab | 10 |
| `null-sync/package.json` | `sync` | Sync Status | account | `sync` | `null.sync.showStatus` | Settings across devices | 20 |
| `null-env/package.json` | `env` | Environment Check | setup | `checklist` | `null.env.check` | Missing tools & extensions | 10 |
| `null-actions/package.json` | `actions` | Actions Settings | setup | `play-circle` | `null-actions.openSettings` | Status bar buttons | 20 |
| `null-format/package.json` | `format` | Formatting Settings | setup | `wand` | `null-format.openSettings` | Prettier, rustfmt, clang-format | 30 |

Example (`null-accounts/package.json`):

```json
"nullWorkspace": {
  "features": [
    { "id": "accounts", "label": "Accounts", "category": "account", "icon": "account",
      "command": "null-accounts.open", "description": "GitHub & GitLab", "order": 10 }
  ]
},
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd extensions/null-tools && npm test`
Expected: all PASS, including both new tests.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/featureManifests.test.ts extensions/null-tools/package.json extensions/null-accounts/package.json extensions/null-activity/package.json extensions/null-startup/package.json extensions/null-sync/package.json extensions/null-env/package.json extensions/null-actions/package.json extensions/null-format/package.json
git commit -m "feat: register launcher entries in the Null extensions (#133)"
cd extensions/null-tools && npm run compile && cd ../..
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output (#133)"
```

---

### Task 4: Move Music into Null Workspace

**Files:**
- Modify: `extensions/null-music/package.json` (remove the container, retarget the view)
- Modify: `extensions/null-music/src/extension.ts:19-22` (`revealView`)

**Interfaces:**
- Consumes: container id `null-workspace` (declared by `null-tools`).
- Produces: nothing new.

- [ ] **Step 1: Retarget the view in `package.json`**

In `extensions/null-music/package.json`, delete the whole `"viewsContainers"` block and replace the `"views"` block with:

```json
"views": {
  "null-workspace": [
    {
      "type": "webview",
      "id": "null.musicView",
      "name": "Music",
      "visibility": "collapsed"
    }
  ]
},
```

- [ ] **Step 2: Fix the reveal call**

In `extensions/null-music/src/extension.ts`, replace the first line of `revealView`:

```ts
await vscode.commands.executeCommand('workbench.view.extension.null-music');
```

with:

```ts
await vscode.commands.executeCommand('null.musicView.focus');
```

(The second line, `focusActiveEditorGroup`, stays.) Leave `retainContextWhenHidden: true` in `registerWebviewViewProvider` untouched.

- [ ] **Step 3: Compile and run the unit tests**

Run: `cd extensions/null-music && npm test`
Expected: compiles, all tests PASS. If a test asserts the old command string, update it to `null.musicView.focus`.

- [ ] **Step 4: Commit**

```bash
git add extensions/null-music/package.json extensions/null-music/src/extension.ts
git commit -m "feat(null-music): move the player into Null Workspace (#133)"
cd extensions/null-music && npm run compile && cd ../..
git add extensions/null-music/out
git commit -m "chore: refresh null-music compiled output (#133)"
```

---

### Task 5: Verify in the real build, then update the docs

**Files:**
- Modify: `CLAUDE.md` (null-tools row, null-music section)
- Modify: `docs/specs/null-workspace-hub-design.md` (only if verification disproves a statement)

- [ ] **Step 1: Sync and run the integration specs**

Run the `verify-local` skill for `null-tools` and for `null-music`: it syncs the compiled extensions into the installed Null IDE, reloads it, and runs `npm run test:integration`.
Expected: specs pass.

- [ ] **Step 2: Check the hub by hand in the synced Null IDE**

- The Activity Bar shows Null Workspace and GitHub Issues; there is no Music icon.
- Null Workspace opens with an expanded **Features** view showing four categories and nine entries; the other five views are collapsed on a fresh profile.
- Click each entry once: Dashboard, Issues full view, Activity Dashboard, Startup Report, Accounts, Sync quick pick, Environment Check, Actions Settings, Formatting Settings. Each opens its target.
- Expand **Music**, play a track, switch to Explorer and back: audio never stops.
- Run `Null Music: Play / Pause` from the command palette while Music is collapsed: it reveals the view and plays.
- Disable then enable an extension (e.g. `null-sync`): its entry disappears and returns without reloading.

If "contributing a view into another extension's container" fails, stop and apply the spec's fallback (keep Music's container, add a launcher entry) before continuing.

- [ ] **Step 3: Update `CLAUDE.md`**

In the `null-tools` table add a row:

```
| **Null Workspace hub** | `featureRegistry.ts` (pure) + `featuresTreeView.ts`: the **Features** view at the top of the `null-workspace` container lists launcher entries that every `null.*` extension declares as a top-level `nullWorkspace.features` array in its own `package.json` (`id`, `label`, `command`, `category`, optional `icon` codicon / `description` / `order`); categories `develop` / `insights` / `account` / `setup` (unknown ones append). Entries are static; non-`null` publishers are ignored. `featureManifests.test.ts` checks every entry's command exists. Design `docs/specs/null-workspace-hub-design.md`; plan `docs/plans/null-workspace-hub.md` |
```

In the `null-music` section replace "activity-bar view `null.musicView`" with "view `null.musicView` inside the `null-workspace` container (collapsed by default; `null.musicView.focus` reveals it)".

- [ ] **Step 4: Refresh the knowledge graph and commit**

```bash
graphify update .
git add CLAUDE.md
git commit -m "docs: document the Null Workspace hub (#133)"
```

Report the final commit hashes to the user; do not push.
