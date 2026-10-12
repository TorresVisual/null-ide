# Null Startup Profiler Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Record every launch's startup phases and extension activations, keep a bounded history, and show a sortable report with a timeline, launch-to-launch comparison and a sanitized export.

**Architecture:** A thin core patch (`010-startup-snapshot.patch`) stamps extension activations with absolute times and registers one internal command, `_null.startup.snapshot`, that returns the startup data as plain JSON. A new built-in extension, `null-startup`, calls it once after startup (and again 30 s later), turns the snapshot into a stored `Report`, and renders reports in one reused `WebviewPanel` (pure view-model + vanilla-TS webview, the `null-activity` dashboard pattern).

**Tech Stack:** TypeScript (extension, `node --test`, CommonJS), vanilla TS webview (`module: none`, `outFile`), VS Code source patch (TS), Node 24 type stripping for the patch unit test.

**Spec:** [docs/specs/null-startup-profiler-design.md](../specs/null-startup-profiler-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [ ] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Headline duration is launch → `code/didRestoreEditors` (`workspaceRestored`). Launch is `code/didStartMain` (first window), `code/willOpenNewWindow` (later windows), `code/timeOrigin` fallback.
- Milestones, in order: `windowCreated` (`code/didCreateCodeWindow`), `uiInteractive` (`code/didStartWorkbench`), `workspaceRestored` (`code/didRestoreEditors`), `extensionsSettled` (end of the last eager activation).
- Reports store only extension IDs, sanitized activation event names, timings and the app version. No paths, no workspace names. `workspaceContains:*`-style events reduce to their type.
- Missing data is `undefined`, rendered `n/a`; nothing throws.
- Defaults: `null-startup.retention` 20 (1–200), `null-startup.slowExtensionMs` 100, `null-startup.enabled` true.
- Extension conventions (CLAUDE.md): `out/` and `lib/` are tracked and never hand-edited (only `lib/report.css` is hand-written); every `out/test/*.test.js` must be listed in the `test` script; only `snapshotSource.ts`, `reportPanel.ts`, `commands.ts` and `extension.ts` import `vscode`.
- Do not run `scripts/build-local.ps1` or trigger CI. Local iteration uses `scripts/sync-local.ps1` then `scripts/reload-local.ps1`.
- Commit messages: Conventional Commits with `(#19)`, ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push, never amend.
- Webview code (`src/webview/report/`): top-level `function` declarations only in files loaded by `vm` tests (`dom.ts`, `model.ts`); no `style` attributes (CSP) — use classes and SVG attributes.

## Review Focus

1. Concurrent activations: two extensions running over the same 500 ms must add 500 ms to the wall-clock total, not 1000 ms (Task 3 `incrementalImpact`).
2. A launch whose marks are partly missing (no `didRestoreEditors`, no start mark, no activation stamps) must produce a report with `n/a` cells, not an exception (Task 4).
3. A corrupt, truncated or future-`schemaVersion` file in the reports folder must not break `list()` and must not be deleted by reading or pruning (Task 5).
4. A stock VS Code (command `_null.startup.snapshot` missing) must leave the extension active, silent, and with an empty report panel (Tasks 6, 11).
5. Activation events carrying paths (`workspaceContains:C:\\Users\\me\\proj\\x`, `onFileOpen:/home/me/x`) must never reach a report, a Markdown copy or a JSON export (Task 3, Task 8).

---

### Task 1: Core patch 010 — activation stamps and `_null.startup.snapshot`

**Files (all in `vscode-src/`, then exported to the repo):**
- Create: `vscode-src/src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.ts` (pure, no imports)
- Create: `vscode-src/src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.contribution.ts`
- Modify: `vscode-src/src/vs/workbench/services/extensions/common/abstractExtensionService.ts` (`ExtensionStatus`, `getExtensionsStatus`)
- Modify: `vscode-src/src/vs/workbench/services/extensions/common/extensions.ts:50-57` (`IExtensionsStatus`)
- Modify: `vscode-src/src/vs/workbench/contrib/performance/browser/performance.contribution.ts` (one import line)
- Create: `patches/010-startup-snapshot.patch`
- Test: `patches/test/startupSnapshot.test.mjs`

**Interfaces:**
- Produces: command `_null.startup.snapshot` → resolves to a `StartupSnapshot` (JSON-serialisable):
  `{ schemaVersion: 1, takenAt: number, appVersion: string, initialStartup: boolean, metrics: Record<string, number>, marks: {source, name, startTime}[], contributions: {phase, id, ms}[], extensions: {id, activationEvent, reason, eager, startMs?, endMs?, loadMs?, callMs?, resolveMs?}[] }`. All times are epoch milliseconds (marks) or durations (`*Ms` loadMs/callMs/resolveMs); `startMs`/`endMs` are epoch ms from the renderer clock, the same clock as `marks[].startTime`.

`vscode-src` is a working tree where patches 001–009 are applied but unstaged (the index is the VSCodium-patched state), so `git diff -- <paths>` shows only your change for files no earlier patch touched. None of the five paths above is touched by patches 001–009.

- [ ] **Step 1: Write the failing test**

Create `patches/test/startupSnapshot.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const src = new URL('../../vscode-src/src/vs/', import.meta.url);
const skip = !existsSync(new URL('workbench/contrib/performance/browser/', src)) && 'vscode-src not present';

// Plain TypeScript with no VS Code imports, so Node's type stripping loads it directly.
const load = (rel) => import(new URL(rel, src).href);

test('buildStartupSnapshot flattens timers, marks, contributions and extensions', { skip }, async () => {
	const { buildStartupSnapshot } = await load('workbench/contrib/performance/browser/nullStartupSnapshot.ts');
	const reason = { startup: true, activationEvent: 'onStartupFinished', extensionId: { value: 'pub.a' } };
	const snap = buildStartupSnapshot({
		now: 1000,
		appVersion: '1.2.3',
		initialStartup: true,
		timers: { ellapsedRequire: 120, ellapsedExtensions: undefined, label: 'x', bad: Number.NaN },
		marks: [['renderer', [{ name: 'code/didStartWorkbench', startTime: 500 }]]],
		contributions: [[2, [['a.B', 4]]]],
		extensions: {
			'pub.a': { activationStarted: true, activationStartedAt: 10, activationEndedAt: 50, activationTimes: { codeLoadingTime: 5, activateCallTime: 10, activateResolvedTime: 20, activationReason: reason } },
			'pub.b': { activationStarted: false },
			'pub.c': { activationStarted: true, activationStartedAt: 60 },
		},
	});

	assert.equal(snap.schemaVersion, 1);
	assert.equal(snap.takenAt, 1000);
	assert.equal(snap.appVersion, '1.2.3');
	assert.deepEqual(snap.metrics, { ellapsedRequire: 120 }, 'only finite numbers survive');
	assert.deepEqual(snap.marks, [{ source: 'renderer', name: 'code/didStartWorkbench', startTime: 500 }]);
	assert.deepEqual(snap.contributions, [{ phase: 2, id: 'a.B', ms: 4 }]);
	assert.deepEqual(snap.extensions.map(e => e.id), ['pub.a', 'pub.c'], 'never-activated extensions are skipped');
	assert.deepEqual(snap.extensions[0], {
		id: 'pub.a', activationEvent: 'onStartupFinished', reason: 'pub.a', eager: true,
		startMs: 10, endMs: 50, loadMs: 5, callMs: 10, resolveMs: 20,
	});
	assert.equal(snap.extensions[1].activationEvent, '', 'started but unfinished: no reason known');
	assert.equal(snap.extensions[1].endMs, undefined);
	assert.doesNotThrow(() => JSON.stringify(snap));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (repo root): `node --test patches/test/startupSnapshot.test.mjs`
Expected: FAIL — cannot find `nullStartupSnapshot.ts`.

- [ ] **Step 3: Write the pure builder**

Create `vscode-src/src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.ts` (tabs, LF line endings):

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Null IDE: plain data in, plain JSON out. No VS Code imports, so patches/test can load it directly.

export interface StartupSnapshotExtensionInput {
	readonly activationStarted: boolean;
	readonly activationStartedAt?: number;
	readonly activationEndedAt?: number;
	readonly activationTimes?: {
		readonly codeLoadingTime: number;
		readonly activateCallTime: number;
		readonly activateResolvedTime: number;
		readonly activationReason: { readonly startup: boolean; readonly activationEvent: string; readonly extensionId: { readonly value: string } };
	};
}

export interface StartupSnapshotInput {
	readonly now: number;
	readonly appVersion: string;
	readonly initialStartup: boolean;
	readonly timers: Readonly<Record<string, unknown>>;
	readonly marks: readonly (readonly [source: string, marks: readonly { readonly name: string; readonly startTime: number }[]])[];
	readonly contributions: readonly (readonly [phase: number, timings: readonly (readonly [id: string, ms: number])[]])[];
	readonly extensions: Readonly<Record<string, StartupSnapshotExtensionInput>>;
}

export interface StartupSnapshot {
	readonly schemaVersion: 1;
	readonly takenAt: number;
	readonly appVersion: string;
	readonly initialStartup: boolean;
	readonly metrics: Record<string, number>;
	readonly marks: { source: string; name: string; startTime: number }[];
	readonly contributions: { phase: number; id: string; ms: number }[];
	readonly extensions: {
		id: string; activationEvent: string; reason: string; eager: boolean;
		startMs?: number; endMs?: number; loadMs?: number; callMs?: number; resolveMs?: number;
	}[];
}

export function buildStartupSnapshot(input: StartupSnapshotInput): StartupSnapshot {
	const metrics: Record<string, number> = {};
	for (const [key, value] of Object.entries(input.timers)) {
		if (typeof value === 'number' && Number.isFinite(value)) {
			metrics[key] = value;
		}
	}

	const marks = input.marks.flatMap(([source, list]) => list.map(m => ({ source, name: m.name, startTime: m.startTime })));
	const contributions = input.contributions.flatMap(([phase, list]) => list.map(([id, ms]) => ({ phase, id, ms })));

	const extensions: StartupSnapshot['extensions'] = [];
	for (const [id, status] of Object.entries(input.extensions)) {
		const times = status.activationTimes;
		if (!status.activationStarted && !times) {
			continue;
		}
		extensions.push({
			id,
			activationEvent: times?.activationReason.activationEvent ?? '',
			reason: times?.activationReason.extensionId.value ?? '',
			eager: times?.activationReason.startup ?? false,
			startMs: status.activationStartedAt,
			endMs: status.activationEndedAt,
			loadMs: times?.codeLoadingTime,
			callMs: times?.activateCallTime,
			resolveMs: times?.activateResolvedTime,
		});
	}

	return { schemaVersion: 1, takenAt: input.now, appVersion: input.appVersion, initialStartup: input.initialStartup, metrics, marks, contributions, extensions };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test patches/test/startupSnapshot.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Stamp activations in `abstractExtensionService.ts`**

In `vscode-src/src/vs/workbench/services/extensions/common/abstractExtensionService.ts`, class `ExtensionStatus`:

Replace
```ts
	private _activationStarted: boolean = false;
	public get activationStarted(): boolean {
		return this._activationStarted;
	}
```
with
```ts
	private _activationStarted: boolean = false;
	public get activationStarted(): boolean {
		return this._activationStarted;
	}

	// Null IDE: epoch ms on the renderer clock, so activations can be placed next to the performance marks.
	private _activationStartedAt: number | undefined;
	public get activationStartedAt(): number | undefined {
		return this._activationStartedAt;
	}

	private _activationEndedAt: number | undefined;
	public get activationEndedAt(): number | undefined {
		return this._activationEndedAt;
	}
```

In `clearRuntimeStatus()` add after `this._activationTimes = null;`:
```ts
		this._activationStartedAt = undefined;
		this._activationEndedAt = undefined;
```

Replace
```ts
	public setActivationTimes(activationTimes: ActivationTimes) {
		this._activationTimes = activationTimes;
	}
```
with
```ts
	public setActivationTimes(activationTimes: ActivationTimes) {
		this._activationTimes = activationTimes;
		this._activationEndedAt = Date.now();
	}
```

Replace
```ts
	public onWillActivate() {
		this._activationStarted = true;
	}
```
with
```ts
	public onWillActivate() {
		this._activationStarted = true;
		this._activationStartedAt ??= Date.now();
	}
```

In `getExtensionsStatus()` add two properties after `activationTimes: extensionStatus?.activationTimes ?? undefined,`:
```ts
					activationStartedAt: extensionStatus?.activationStartedAt,
					activationEndedAt: extensionStatus?.activationEndedAt,
```

- [ ] **Step 6: Extend `IExtensionsStatus`**

In `vscode-src/src/vs/workbench/services/extensions/common/extensions.ts`, add to `IExtensionsStatus` after `activationTimes: ActivationTimes | undefined;`:
```ts
	activationStartedAt?: number;
	activationEndedAt?: number;
```

- [ ] **Step 7: Register the command**

Create `vscode-src/src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.contribution.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { ITimerService } from '../../../services/timer/browser/timerService.js';
import { buildStartupSnapshot } from './nullStartupSnapshot.js';

// Null IDE: the null-startup extension reads startup data through this internal command, because
// the extension API cannot see ITimerService or per-extension activation times.
CommandsRegistry.registerCommand('_null.startup.snapshot', async accessor => {
	const timerService = accessor.get(ITimerService);
	const extensionService = accessor.get(IExtensionService);
	const productService = accessor.get(IProductService);

	await timerService.whenReady();
	await extensionService.whenInstalledExtensionsRegistered();

	const metrics = timerService.startupMetrics;
	const contributions = Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench).timings;

	return buildStartupSnapshot({
		now: Date.now(),
		appVersion: productService.version,
		initialStartup: metrics.initialStartup,
		timers: { ...metrics.timers },
		marks: timerService.getPerformanceMarks(),
		contributions: Array.from(contributions, ([phase, list]) => [phase as number, list] as const),
		extensions: extensionService.getExtensionsStatus(),
	});
});
```

In `vscode-src/src/vs/workbench/contrib/performance/browser/performance.contribution.ts`, add after the last `import` line:
```ts
import './nullStartupSnapshot.contribution.js';
```

- [ ] **Step 8: Type-check the VS Code source**

Run: `cd vscode-src && npx tsc -p src/tsconfig.json --noEmit`
Expected: no errors in the files above (takes several minutes; pre-existing errors elsewhere, if any, are not yours — compare against `git stash`-free baseline by grepping the output for `nullStartupSnapshot|abstractExtensionService|performance.contribution`).

- [ ] **Step 9: Export the patch and verify it applies to the VSCodium-patched index**

```bash
cd vscode-src
git add -N src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.ts src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.contribution.ts
git -c core.autocrlf=false -c core.safecrlf=false diff --no-color -- \
  src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.ts \
  src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.contribution.ts \
  src/vs/workbench/contrib/performance/browser/performance.contribution.ts \
  src/vs/workbench/services/extensions/common/abstractExtensionService.ts \
  src/vs/workbench/services/extensions/common/extensions.ts > ../patches/010-startup-snapshot.patch
git reset -q -- src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.ts src/vs/workbench/contrib/performance/browser/nullStartupSnapshot.contribution.ts
git apply --check --cached --ignore-whitespace ../patches/010-startup-snapshot.patch && echo PATCH-OK
```
Expected: `PATCH-OK`. If `git apply --check` complains the new files "already exist in working tree", rerun with `--cached` only (as written) — `--cached` ignores the working tree. Make sure the patch file has LF endings (`file ../patches/010-startup-snapshot.patch` must not say CRLF).

- [ ] **Step 10: Commit**

```bash
git add patches/010-startup-snapshot.patch patches/test/startupSnapshot.test.mjs
git commit -m "feat(patch): startup snapshot command and activation stamps (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `null-startup` scaffold, types, snapshot parsing, settings, CI wiring

**Files:**
- Create: `extensions/null-startup/package.json`, `tsconfig.json`, `src/types.ts`, `src/snapshot.ts`, `src/settings.ts`, `src/extension.ts` (stub), `src/test/snapshot.test.ts`, `src/test/settings.test.ts`
- Modify: `.github/workflows/build.yml` (compile + copy), `scripts/sync-local.ps1`, `scripts/build-local.ps1`

**Interfaces:**
- Produces (`types.ts`): `SCHEMA_VERSION`, `Snapshot`, `SnapshotMark`, `SnapshotExtension`, `SnapshotContribution`, `MilestoneId`, `Milestone`, `PhaseEntry`, `ExtensionEntry`, `Report` (exact shapes below).
- Produces (`snapshot.ts`): `parseSnapshot(raw: unknown): Snapshot | undefined`.
- Produces (`settings.ts`): `normalizeRetention(v: unknown): number`, `normalizeSlowMs(v: unknown): number`.

- [ ] **Step 1: Scaffold package files**

`extensions/null-startup/package.json`:

```json
{
  "name": "null-startup",
  "displayName": "Null Startup",
  "description": "Startup profiler for Null IDE — startup phases, extension activation times, launch history and comparison",
  "version": "1.0.0",
  "publisher": "null",
  "license": "MIT",
  "engines": { "vscode": "^1.93.0" },
  "main": "./out/extension.js",
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "null-startup.openReport", "title": "Null Startup: Open Startup Report" },
      { "command": "null-startup.copyReport", "title": "Null Startup: Copy Startup Report" },
      { "command": "null-startup.exportReport", "title": "Null Startup: Export Startup Report as JSON…" },
      { "command": "null-startup.clearHistory", "title": "Null Startup: Clear Startup History…" }
    ],
    "configuration": {
      "title": "Null Startup",
      "properties": {
        "null-startup.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Record a startup report on every launch. Takes effect on the next start."
        },
        "null-startup.retention": {
          "type": "number",
          "default": 20,
          "minimum": 1,
          "maximum": 200,
          "description": "How many startup reports to keep for comparison. Older reports are deleted."
        },
        "null-startup.slowExtensionMs": {
          "type": "number",
          "default": 100,
          "minimum": 0,
          "description": "Extensions whose activation takes at least this long are flagged 'slow' in the report. A slow activation is not necessarily a problem."
        }
      }
    }
  },
  "scripts": {
    "compile": "tsc -p tsconfig.json",
    "test": "tsc -p tsconfig.json && node --test out/test/snapshot.test.js out/test/settings.test.js",
    "pretest:integration": "tsc -p tsconfig.json",
    "test:integration": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "@types/vscode": "^1.93.0",
    "@types/node": "^22.0.0",
    "@vscode/test-electron": "^3.1.0",
    "mocha": "^11.8.0",
    "@types/mocha": "^10.0.10",
    "glob": "^13.0.6"
  }
}
```

`extensions/null-startup/tsconfig.json` — identical to `extensions/null-activity/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./out",
    "rootDir": "./src",
    "strict": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/webview"]
}
```

`extensions/null-startup/src/extension.ts` (stub, replaced in Task 6):

```ts
'use strict';

import * as vscode from 'vscode';

export function activate(_context: vscode.ExtensionContext): void {}

export function deactivate(): void {}
```

Run: `cd extensions/null-startup && npm install` (creates `package-lock.json`, which CI's `npm ci` needs).

- [ ] **Step 2: Write `src/types.ts`**

```ts
'use strict';

export const SCHEMA_VERSION = 1;

/** Output of the `_null.startup.snapshot` command (patch 010). Epoch ms unless noted. */
export interface SnapshotMark {
  source: string;
  name: string;
  startTime: number;
}

export interface SnapshotContribution {
  phase: number;
  id: string;
  /** Duration. */
  ms: number;
}

export interface SnapshotExtension {
  id: string;
  activationEvent: string;
  /** The extension that triggered this activation. */
  reason: string;
  eager: boolean;
  /** Epoch ms on the same clock as the marks. */
  startMs?: number;
  endMs?: number;
  /** Durations measured in the extension host. */
  loadMs?: number;
  callMs?: number;
  resolveMs?: number;
}

export interface Snapshot {
  schemaVersion: 1;
  takenAt: number;
  appVersion: string;
  initialStartup: boolean;
  metrics: Record<string, number>;
  marks: SnapshotMark[];
  contributions: SnapshotContribution[];
  extensions: SnapshotExtension[];
}

export type MilestoneId = 'windowCreated' | 'uiInteractive' | 'workspaceRestored' | 'extensionsSettled';

/** Everything below is milliseconds since launch unless named otherwise. */
export interface Milestone {
  id: MilestoneId;
  label: string;
  atMs?: number;
}

export interface PhaseEntry {
  id: string;
  label: string;
  process: 'main' | 'renderer';
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  /** Wall-clock time this phase adds that no earlier-starting phase already covers. */
  impactMs?: number;
}

export interface ExtensionEntry {
  id: string;
  activationEvent: string;
  reason: string;
  eager: boolean;
  /** Ended after `workspaceRestored` (or, without that mark, not eager). */
  deferred: boolean;
  startMs?: number;
  endMs?: number;
  loadMs?: number;
  callMs?: number;
  resolveMs?: number;
  /** loadMs + callMs + resolveMs. */
  totalMs?: number;
  /** Wall-clock time this activation adds beyond earlier-starting activations. */
  impactMs?: number;
}

export interface Report {
  schemaVersion: 1;
  id: string;
  windowId: string;
  /** Epoch ms of the snapshot. */
  takenAt: number;
  appVersion: string;
  initialStartup: boolean;
  /** No launch-start mark was found, so every offset is unknown. */
  partial: boolean;
  /** `workspaceRestored`. */
  headlineMs?: number;
  milestones: Milestone[];
  phases: PhaseEntry[];
  extensions: ExtensionEntry[];
}
```

- [ ] **Step 3: Write the failing tests**

`src/test/snapshot.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { parseSnapshot } from '../snapshot';

const valid = {
  schemaVersion: 1, takenAt: 5, appVersion: '1.0.0', initialStartup: true,
  metrics: { a: 1, b: 'x', c: Number.POSITIVE_INFINITY },
  marks: [{ source: 'main', name: 'code/didStartMain', startTime: 10 }, { name: 7 }, null],
  contributions: [{ phase: 2, id: 'x', ms: 3 }, { phase: 'z' }],
  extensions: [{ id: 'p.a', activationEvent: '*', reason: 'p.a', eager: true, startMs: 1, endMs: 2, loadMs: 'nope' }, { id: 5 }],
};

test('parseSnapshot keeps valid entries and drops malformed ones', () => {
  const s = parseSnapshot(valid)!;
  assert.deepStrictEqual(s.metrics, { a: 1 });
  assert.deepStrictEqual(s.marks, [{ source: 'main', name: 'code/didStartMain', startTime: 10 }]);
  assert.deepStrictEqual(s.contributions, [{ phase: 2, id: 'x', ms: 3 }]);
  assert.strictEqual(s.extensions.length, 1);
  assert.strictEqual(s.extensions[0].id, 'p.a');
  assert.strictEqual(s.extensions[0].loadMs, undefined, 'non-numeric timing becomes undefined');
  assert.strictEqual(s.extensions[0].startMs, 1);
});

test('parseSnapshot rejects non-objects and unknown schema versions', () => {
  assert.strictEqual(parseSnapshot(undefined), undefined);
  assert.strictEqual(parseSnapshot('x'), undefined);
  assert.strictEqual(parseSnapshot({ ...valid, schemaVersion: 2 }), undefined);
});

test('parseSnapshot tolerates missing arrays', () => {
  const s = parseSnapshot({ schemaVersion: 1, takenAt: 1, appVersion: '1', initialStartup: false })!;
  assert.deepStrictEqual([s.marks, s.contributions, s.extensions], [[], [], []]);
});
```

`src/test/settings.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { normalizeRetention, normalizeSlowMs } from '../settings';

test('normalizeRetention clamps to 1..200 and defaults to 20', () => {
  assert.strictEqual(normalizeRetention(undefined), 20);
  assert.strictEqual(normalizeRetention('5'), 20);
  assert.strictEqual(normalizeRetention(0), 1);
  assert.strictEqual(normalizeRetention(5.4), 5);
  assert.strictEqual(normalizeRetention(9999), 200);
});

test('normalizeSlowMs accepts non-negative numbers, defaults to 100', () => {
  assert.strictEqual(normalizeSlowMs(undefined), 100);
  assert.strictEqual(normalizeSlowMs(-1), 100);
  assert.strictEqual(normalizeSlowMs(Number.NaN), 100);
  assert.strictEqual(normalizeSlowMs(0), 0);
  assert.strictEqual(normalizeSlowMs(250), 250);
});
```

- [ ] **Step 4: Run to verify failure**

Run: `cd extensions/null-startup && npm test`
Expected: FAIL — `Cannot find module '../snapshot'` (tsc error).

- [ ] **Step 5: Implement**

`src/snapshot.ts`:

```ts
'use strict';

import { SCHEMA_VERSION, Snapshot, SnapshotContribution, SnapshotExtension, SnapshotMark } from './types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObject) : []);

/** Validates the untrusted command result; anything that is not a version-1 snapshot is dropped. */
export function parseSnapshot(raw: unknown): Snapshot | undefined {
  if (!isObject(raw) || raw.schemaVersion !== SCHEMA_VERSION) return undefined;

  const metrics: Record<string, number> = {};
  if (isObject(raw.metrics)) {
    for (const [key, value] of Object.entries(raw.metrics)) {
      const n = num(value);
      if (n !== undefined) metrics[key] = n;
    }
  }

  const marks: SnapshotMark[] = [];
  for (const m of list(raw.marks)) {
    const startTime = num(m.startTime);
    if (typeof m.name === 'string' && startTime !== undefined) marks.push({ source: String(m.source ?? ''), name: m.name, startTime });
  }

  const contributions: SnapshotContribution[] = [];
  for (const c of list(raw.contributions)) {
    const phase = num(c.phase);
    const ms = num(c.ms);
    if (phase !== undefined && ms !== undefined && typeof c.id === 'string') contributions.push({ phase, id: c.id, ms });
  }

  const extensions: SnapshotExtension[] = [];
  for (const e of list(raw.extensions)) {
    if (typeof e.id !== 'string') continue;
    extensions.push({
      id: e.id,
      activationEvent: typeof e.activationEvent === 'string' ? e.activationEvent : '',
      reason: typeof e.reason === 'string' ? e.reason : '',
      eager: e.eager === true,
      startMs: num(e.startMs),
      endMs: num(e.endMs),
      loadMs: num(e.loadMs),
      callMs: num(e.callMs),
      resolveMs: num(e.resolveMs),
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    takenAt: num(raw.takenAt) ?? 0,
    appVersion: typeof raw.appVersion === 'string' ? raw.appVersion : '',
    initialStartup: raw.initialStartup === true,
    metrics,
    marks,
    contributions,
    extensions,
  };
}
```

`src/settings.ts`:

```ts
'use strict';

export function normalizeRetention(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(200, Math.max(1, Math.round(v))) : 20;
}

export function normalizeSlowMs(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 100;
}
```

- [ ] **Step 6: Run to verify pass**

Run: `cd extensions/null-startup && npm test`
Expected: PASS — 5 tests.

- [ ] **Step 7: Wire the extension into CI and local scripts**

`.github/workflows/build.yml` — after the "Compile null-activity TypeScript" step add:

```yaml
      - name: Compile null-startup TypeScript
        shell: pwsh
        run: |
          Set-Location ide-overlay/extensions/null-startup
          npm ci --ignore-scripts
          npm run compile
```
and after the `null-activity` copy line add:
```yaml
          Copy-Item -Recurse -Force ide-overlay/extensions/null-startup    vscode-src/extensions/
```

`scripts/sync-local.ps1` — after the `"null-activity" = @{ … }` block add (same indentation):

```powershell
    "null-startup" = @{
        Compile       = $true
        CompileScript = "compile"
        Copy          = @(
            "package.json",
            "out",
            "lib"
        )
    }
```
(`lib` does not exist until Task 10; check how the script treats a missing path — if it errors, add `lib` in Task 10 instead.)

`scripts/build-local.ps1` lines 361 and 378: append `"null-startup"` to both extension arrays.

- [ ] **Step 8: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/package-lock.json extensions/null-startup/tsconfig.json extensions/null-startup/src .github/workflows/build.yml scripts/sync-local.ps1 scripts/build-local.ps1
git commit -m "feat(null-startup): scaffold extension, snapshot parsing and settings (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Intervals and sanitizing (pure)

**Files:**
- Create: `extensions/null-startup/src/intervals.ts`, `src/sanitize.ts`
- Test: `extensions/null-startup/src/test/intervals.test.ts`, `src/test/sanitize.test.ts`
- Modify: `extensions/null-startup/package.json` (`test` script)

**Interfaces:**
- Produces (`intervals.ts`): `interface Span { start: number; end: number }`, `unionMs(spans: Span[]): number`, `incrementalImpact(spans: Span[]): number[]` (same order as input), `assignLanes(spans: (Span | undefined)[]): number[]`.
- Produces (`sanitize.ts`): `sanitizeEvent(event: string): string`.

- [ ] **Step 1: Write the failing tests**

`src/test/intervals.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { assignLanes, incrementalImpact, unionMs } from '../intervals';

test('unionMs does not double-count overlap', () => {
  assert.strictEqual(unionMs([]), 0);
  assert.strictEqual(unionMs([{ start: 0, end: 10 }, { start: 5, end: 15 }]), 15);
  assert.strictEqual(unionMs([{ start: 0, end: 10 }, { start: 20, end: 30 }]), 20);
  assert.strictEqual(unionMs([{ start: 0, end: 10 }, { start: 2, end: 4 }]), 10);
});

test('two extensions running over the same 500 ms add 500 ms, not 1000 ms', () => {
  const spans = [{ start: 1000, end: 1500 }, { start: 1000, end: 1500 }];
  const impact = incrementalImpact(spans);
  assert.strictEqual(impact.reduce((a, b) => a + b, 0), 500);
  assert.strictEqual(unionMs(spans), 500);
});

test('incrementalImpact attributes overlap to the earlier-starting span', () => {
  assert.deepStrictEqual(incrementalImpact([{ start: 0, end: 10 }, { start: 5, end: 15 }]), [10, 5]);
  assert.deepStrictEqual(incrementalImpact([{ start: 5, end: 15 }, { start: 0, end: 10 }]), [5, 10], 'result keeps input order');
  assert.deepStrictEqual(incrementalImpact([{ start: 0, end: 10 }, { start: 2, end: 4 }]), [10, 0]);
  assert.deepStrictEqual(incrementalImpact([{ start: 0, end: 10 }, { start: 10, end: 20 }]), [10, 10]);
  assert.deepStrictEqual(incrementalImpact([{ start: 5, end: 5 }, { start: 9, end: 3 }]), [0, 0], 'empty or reversed spans add nothing');
});

test('assignLanes packs non-overlapping spans into the same lane', () => {
  const lanes = assignLanes([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 10, end: 20 }, undefined]);
  assert.deepStrictEqual(lanes, [0, 1, 0, 0]);
});
```

`src/test/sanitize.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { sanitizeEvent } from '../sanitize';

test('plain events pass through', () => {
  for (const e of ['*', 'onStartupFinished', 'onLanguage:typescript', 'onCommand:null-startup.openReport', 'onView:null.musicView', '']) {
    assert.strictEqual(sanitizeEvent(e), e);
  }
});

test('workspaceContains keeps only its type', () => {
  assert.strictEqual(sanitizeEvent('workspaceContains:**/*.csproj'), 'workspaceContains');
  assert.strictEqual(sanitizeEvent('workspaceContains:C:\\Users\\me\\proj\\x'), 'workspaceContains');
});

test('any event carrying a path keeps only its prefix', () => {
  assert.strictEqual(sanitizeEvent('onFileOpen:/home/me/x'), 'onFileOpen');
  assert.strictEqual(sanitizeEvent('onFileSystem:file'), 'onFileSystem:file');
  assert.strictEqual(sanitizeEvent('onDebugResolve:C:\\a\\b'), 'onDebugResolve');
});
```

Add both to the `test` script: `... out/test/settings.test.js out/test/intervals.test.js out/test/sanitize.test.js`.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`src/intervals.ts`:

```ts
'use strict';

export interface Span {
  start: number;
  end: number;
}

/** Adds `s` to a sorted, disjoint list, merging whatever it touches. */
function add(covered: Span[], s: Span): Span[] {
  const next: Span[] = [];
  let cur = { ...s };
  for (const c of covered) {
    if (c.end < cur.start || c.start > cur.end) next.push(c);
    else cur = { start: Math.min(c.start, cur.start), end: Math.max(c.end, cur.end) };
  }
  next.push(cur);
  return next.sort((a, b) => a.start - b.start);
}

const valid = (s: Span) => s.end > s.start;

/** Length of the union of the spans: wall-clock time with overlap counted once. */
export function unionMs(spans: Span[]): number {
  let covered: Span[] = [];
  for (const s of spans) if (valid(s)) covered = add(covered, s);
  return covered.reduce((sum, c) => sum + (c.end - c.start), 0);
}

/**
 * For each span, the time it adds that no earlier-starting span already covers. The values sum to
 * `unionMs`, so overlapping work is never counted twice. Result order matches the input order.
 */
export function incrementalImpact(spans: Span[]): number[] {
  const out = new Array<number>(spans.length).fill(0);
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].start - spans[b].start || spans[a].end - spans[b].end);
  let covered: Span[] = [];
  for (const i of order) {
    const s = spans[i];
    if (!valid(s)) continue;
    const overlap = covered.reduce((sum, c) => sum + Math.max(0, Math.min(s.end, c.end) - Math.max(s.start, c.start)), 0);
    out[i] = s.end - s.start - overlap;
    covered = add(covered, s);
  }
  return out;
}

/** Greedy lane packing for the timeline: first lane whose last span ended by this span's start. */
export function assignLanes(spans: (Span | undefined)[]): number[] {
  const lanes = new Array<number>(spans.length).fill(0);
  const laneEnds: number[] = [];
  const order = spans.map((_, i) => i).filter((i) => spans[i] !== undefined).sort((a, b) => spans[a]!.start - spans[b]!.start);
  for (const i of order) {
    const s = spans[i]!;
    let lane = laneEnds.findIndex((end) => end <= s.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else {
      laneEnds[lane] = s.end;
    }
    lanes[i] = lane;
  }
  return lanes;
}
```

`src/sanitize.ts`:

```ts
'use strict';

/**
 * Activation events can embed workspace globs or paths (`workspaceContains:**\/x`, `onFileOpen:/home/me/x`).
 * Reports keep only the event type for those; ordinary events (`onLanguage:ts`, `onCommand:x.y`) stay whole.
 */
export function sanitizeEvent(event: string): string {
  const i = event.indexOf(':');
  if (i === -1) return event;
  const head = event.slice(0, i);
  const rest = event.slice(i + 1);
  return head === 'workspaceContains' || /[\\/]/.test(rest) ? head : event;
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src
git commit -m "feat(null-startup): interval union and activation-event sanitizing (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `buildReport` — snapshot to report

**Files:**
- Create: `extensions/null-startup/src/buildReport.ts`
- Test: `extensions/null-startup/src/test/buildReport.test.ts`
- Modify: `extensions/null-startup/package.json` (`test` script: add `out/test/buildReport.test.js`)

**Interfaces:**
- Consumes: `Snapshot`, `Report`, `PhaseEntry`, `ExtensionEntry`, `Milestone` (`types.ts`); `incrementalImpact` (`intervals.ts`); `sanitizeEvent` (`sanitize.ts`).
- Produces: `buildReport(snapshot: Snapshot, opts: { id: string; windowId: string }): Report`; `markTime(snapshot: Snapshot, name: string): number | undefined`; `launchStart(snapshot: Snapshot): number | undefined`; `PHASES` (the phase table).

- [ ] **Step 1: Write the failing test**

`src/test/buildReport.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { buildReport } from '../buildReport';
import { Snapshot, SnapshotExtension } from '../types';

const mark = (source: string, name: string, startTime: number) => ({ source, name, startTime });
const ext = (over: Partial<SnapshotExtension> & { id: string }): SnapshotExtension => ({ activationEvent: '*', reason: over.id, eager: true, ...over });

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 1, takenAt: 9000, appVersion: '1.2.3', initialStartup: true, metrics: {}, contributions: [],
    marks: [
      mark('main', 'code/didStartMain', 1000),
      mark('main', 'code/willCreateCodeWindow', 1100),
      mark('main', 'code/didCreateCodeWindow', 1200),
      mark('renderer', 'code/willStartWorkbench', 1500),
      mark('renderer', 'code/didStartWorkbench', 2000),
      mark('renderer', 'code/willRestoreEditors', 2000),
      mark('renderer', 'code/didRestoreEditors', 2500),
    ],
    extensions: [
      ext({ id: 'p.fast', startMs: 1100, endMs: 1900, loadMs: 10, callMs: 20, resolveMs: 30, activationEvent: 'workspaceContains:C:\\Users\\me\\x' }),
      ext({ id: 'p.late', startMs: 2000, endMs: 3000, loadMs: 1, callMs: 2, resolveMs: 3 }),
      ext({ id: 'p.lazy', eager: false, activationEvent: 'onLanguage:rust' }),
    ],
    ...over,
  };
}

test('milestones are offsets from launch and the headline is workspaceRestored', () => {
  const r = buildReport(snapshot(), { id: 'r1', windowId: 'w1' });
  const at = Object.fromEntries(r.milestones.map((m) => [m.id, m.atMs]));
  assert.deepStrictEqual(at, { windowCreated: 200, uiInteractive: 1000, workspaceRestored: 1500, extensionsSettled: 2000 });
  assert.strictEqual(r.headlineMs, 1500);
  assert.strictEqual(r.partial, false);
  assert.strictEqual(r.id, 'r1');
  assert.strictEqual(r.windowId, 'w1');
});

test('later windows start at willOpenNewWindow, falling back to timeOrigin', () => {
  const s = snapshot({ initialStartup: false, marks: [mark('renderer', 'code/willOpenNewWindow', 100), mark('renderer', 'code/didRestoreEditors', 400)] });
  assert.strictEqual(buildReport(s, { id: 'a', windowId: 'w' }).headlineMs, 300);
  const t = snapshot({ marks: [mark('renderer', 'code/timeOrigin', 50), mark('renderer', 'code/didRestoreEditors', 90)] });
  assert.strictEqual(buildReport(t, { id: 'a', windowId: 'w' }).headlineMs, 40);
});

test('phases have durations and wall-clock impact; missing marks give undefined, not errors', () => {
  const r = buildReport(snapshot(), { id: 'r', windowId: 'w' });
  const byId = Object.fromEntries(r.phases.map((p) => [p.id, p]));
  assert.deepStrictEqual([byId['window-create'].startMs, byId['window-create'].endMs, byId['window-create'].durationMs], [100, 200, 100]);
  assert.strictEqual(byId['workbench'].durationMs, 500);
  assert.strictEqual(byId['editors'].durationMs, 500);
  assert.strictEqual(byId['workbench'].impactMs, 500);
  assert.strictEqual(byId['editors'].impactMs, 500);
  assert.strictEqual(byId['storage'].durationMs, undefined, 'no storage marks in this snapshot');
  assert.strictEqual(byId['storage'].impactMs, undefined);
});

test('extensions split into startup and deferred, with sanitized events and totals', () => {
  const r = buildReport(snapshot(), { id: 'r', windowId: 'w' });
  const byId = Object.fromEntries(r.extensions.map((e) => [e.id, e]));
  assert.strictEqual(byId['p.fast'].deferred, false, 'ended (1900) before restored (2500)');
  assert.strictEqual(byId['p.fast'].totalMs, 60);
  assert.strictEqual(byId['p.fast'].activationEvent, 'workspaceContains');
  assert.deepStrictEqual([byId['p.fast'].startMs, byId['p.fast'].endMs], [100, 900]);
  assert.strictEqual(byId['p.late'].deferred, true, 'ended after restored');
  assert.strictEqual(byId['p.lazy'].deferred, true, 'no stamps and not eager');
  assert.strictEqual(byId['p.lazy'].totalMs, undefined);
});

test('overlapping activations are not double-counted in impact', () => {
  const s = snapshot({ extensions: [ext({ id: 'a', startMs: 1100, endMs: 1600 }), ext({ id: 'b', startMs: 1100, endMs: 1600 })] });
  const r = buildReport(s, { id: 'r', windowId: 'w' });
  assert.strictEqual(r.extensions.reduce((sum, e) => sum + (e.impactMs ?? 0), 0), 500);
});

test('a snapshot with no marks is partial and every offset is undefined', () => {
  const r = buildReport(snapshot({ marks: [], extensions: [ext({ id: 'a', startMs: 5, endMs: 9 })] }), { id: 'r', windowId: 'w' });
  assert.strictEqual(r.partial, true);
  assert.strictEqual(r.headlineMs, undefined);
  assert.ok(r.milestones.every((m) => m.atMs === undefined));
  assert.ok(r.phases.every((p) => p.durationMs === undefined));
  assert.strictEqual(r.extensions[0].startMs, undefined);
  assert.strictEqual(r.extensions[0].deferred, false, 'eager and no restored mark: falls back to the eager flag');
});
```

Add `out/test/buildReport.test.js` to the `test` script.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL (`../buildReport` missing).

- [ ] **Step 3: Implement `src/buildReport.ts`**

```ts
'use strict';

import { incrementalImpact } from './intervals';
import { sanitizeEvent } from './sanitize';
import { ExtensionEntry, Milestone, MilestoneId, PhaseEntry, Report, SCHEMA_VERSION, Snapshot } from './types';

interface PhaseDef {
  id: string;
  label: string;
  process: 'main' | 'renderer';
  from: string;
  to: string;
}

/** Every pair is a will/did mark pair that upstream sets; a pair with a missing mark yields `n/a`. */
export const PHASES: PhaseDef[] = [
  { id: 'window-state', label: 'Restore window state', process: 'main', from: 'code/willRestoreCodeWindowState', to: 'code/didRestoreCodeWindowState' },
  { id: 'window-create', label: 'Create window', process: 'main', from: 'code/willCreateCodeWindow', to: 'code/didCreateCodeWindow' },
  { id: 'load-workbench', label: 'Load workbench bundle', process: 'renderer', from: 'code/willLoadWorkbenchMain', to: 'code/didLoadWorkbenchMain' },
  { id: 'window-config', label: 'Wait for window config', process: 'renderer', from: 'code/willWaitForWindowConfig', to: 'code/didWaitForWindowConfig' },
  { id: 'storage', label: 'Init storage', process: 'renderer', from: 'code/willInitStorage', to: 'code/didInitStorage' },
  { id: 'workspace-service', label: 'Init workspace service', process: 'renderer', from: 'code/willInitWorkspaceService', to: 'code/didInitWorkspaceService' },
  { id: 'shared-process', label: 'Connect shared process', process: 'renderer', from: 'code/willConnectSharedProcess', to: 'code/didConnectSharedProcess' },
  { id: 'workbench', label: 'Start workbench', process: 'renderer', from: 'code/willStartWorkbench', to: 'code/didStartWorkbench' },
  { id: 'extensions', label: 'Register extensions', process: 'renderer', from: 'code/willLoadExtensions', to: 'code/didLoadExtensions' },
  { id: 'viewlet', label: 'Restore sidebar', process: 'renderer', from: 'code/willRestoreViewlet', to: 'code/didRestoreViewlet' },
  { id: 'panel', label: 'Restore panel', process: 'renderer', from: 'code/willRestorePanel', to: 'code/didRestorePanel' },
  { id: 'editors', label: 'Restore editors', process: 'renderer', from: 'code/willRestoreEditors', to: 'code/didRestoreEditors' },
];

const MILESTONES: { id: MilestoneId; label: string; mark?: string }[] = [
  { id: 'windowCreated', label: 'Window created', mark: 'code/didCreateCodeWindow' },
  { id: 'uiInteractive', label: 'UI interactive', mark: 'code/didStartWorkbench' },
  { id: 'workspaceRestored', label: 'Workspace restored', mark: 'code/didRestoreEditors' },
  { id: 'extensionsSettled', label: 'Extensions settled' },
];

export function markTime(snapshot: Snapshot, name: string): number | undefined {
  return snapshot.marks.find((m) => m.name === name)?.startTime;
}

/** Epoch ms of the launch: the main-process start, or the window-open mark for later windows. */
export function launchStart(snapshot: Snapshot): number | undefined {
  const first = snapshot.initialStartup ? 'code/didStartMain' : 'code/willOpenNewWindow';
  return markTime(snapshot, first) ?? markTime(snapshot, 'code/timeOrigin');
}

export function buildReport(snapshot: Snapshot, opts: { id: string; windowId: string }): Report {
  const start = launchStart(snapshot);
  const off = (t: number | undefined) => (t === undefined || start === undefined ? undefined : t - start);
  const sum = (...v: (number | undefined)[]) => (v.every((x) => x !== undefined) ? (v as number[]).reduce((a, b) => a + b, 0) : undefined);

  const phases: PhaseEntry[] = PHASES.map((p) => {
    const startMs = off(markTime(snapshot, p.from));
    const endMs = off(markTime(snapshot, p.to));
    const durationMs = startMs !== undefined && endMs !== undefined ? Math.max(0, endMs - startMs) : undefined;
    return { id: p.id, label: p.label, process: p.process, startMs, endMs, durationMs };
  });
  const measured = phases.filter((p) => p.durationMs !== undefined);
  incrementalImpact(measured.map((p) => ({ start: p.startMs!, end: p.endMs! }))).forEach((v, i) => (measured[i].impactMs = v));

  const restoredAbs = markTime(snapshot, 'code/didRestoreEditors');
  const extensions: ExtensionEntry[] = snapshot.extensions.map((e) => ({
    id: e.id,
    activationEvent: sanitizeEvent(e.activationEvent),
    reason: e.reason,
    eager: e.eager,
    deferred: e.endMs !== undefined && restoredAbs !== undefined ? e.endMs > restoredAbs : !e.eager,
    startMs: off(e.startMs),
    endMs: off(e.endMs),
    loadMs: e.loadMs,
    callMs: e.callMs,
    resolveMs: e.resolveMs,
    totalMs: sum(e.loadMs, e.callMs, e.resolveMs),
  }));
  const timed = extensions.filter((e) => e.startMs !== undefined && e.endMs !== undefined);
  incrementalImpact(timed.map((e) => ({ start: e.startMs!, end: e.endMs! }))).forEach((v, i) => (timed[i].impactMs = v));

  const settledEnds = extensions.filter((e) => e.eager && e.endMs !== undefined).map((e) => e.endMs!);
  const milestones: Milestone[] = MILESTONES.map((m) => ({
    id: m.id,
    label: m.label,
    atMs: m.mark ? off(markTime(snapshot, m.mark)) : settledEnds.length ? Math.max(...settledEnds) : undefined,
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    id: opts.id,
    windowId: opts.windowId,
    takenAt: snapshot.takenAt,
    appVersion: snapshot.appVersion,
    initialStartup: snapshot.initialStartup,
    partial: start === undefined,
    headlineMs: milestones.find((m) => m.id === 'workspaceRestored')?.atMs,
    milestones,
    phases,
    extensions,
  };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src
git commit -m "feat(null-startup): build startup reports from snapshots (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `ReportStore` — history on disk

**Files:**
- Create: `extensions/null-startup/src/reportStore.ts`
- Test: `extensions/null-startup/src/test/reportStore.test.ts`
- Modify: `extensions/null-startup/package.json` (`test` script: add `out/test/reportStore.test.js`)

**Interfaces:**
- Consumes: `Report`, `SCHEMA_VERSION` (`types.ts`).
- Produces: `interface StoreFs { mkdir(dir: string): Promise<void>; readdir(dir: string): Promise<string[]>; readFile(file: string): Promise<string>; writeFile(file: string, data: string): Promise<void>; unlink(file: string): Promise<void> }`; `class ReportStore { constructor(deps: { dir: string; fs: StoreFs; retention: () => number; log: (m: string) => void }); save(report: Report): Promise<void>; list(): Promise<Report[]> /* newest first */; clear(): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

`src/test/reportStore.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import path from 'node:path';
import { test } from 'node:test';
import { ReportStore, StoreFs } from '../reportStore';
import { Report } from '../types';

function memFs(): StoreFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async mkdir() {},
    async readdir(dir) {
      return [...files.keys()].filter((k) => path.dirname(k) === path.normalize(dir)).map((k) => path.basename(k));
    },
    async readFile(f) {
      const v = files.get(f);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async writeFile(f, d) {
      files.set(f, d);
    },
    async unlink(f) {
      files.delete(f);
    },
  };
}

const report = (id: string, takenAt: number): Report => ({
  schemaVersion: 1, id, windowId: 'w', takenAt, appVersion: '1', initialStartup: true, partial: false,
  headlineMs: 1000, milestones: [], phases: [], extensions: [],
});

const make = (retention = 20) => {
  const fs = memFs();
  const logs: string[] = [];
  return { fs, logs, store: new ReportStore({ dir: '/reports', fs, retention: () => retention, log: (m) => logs.push(m) }) };
};

test('save then list returns newest first and rewriting an id replaces it', async () => {
  const { store } = make();
  await store.save(report('a', 100));
  await store.save(report('b', 300));
  await store.save(report('c', 200));
  await store.save({ ...report('a', 100), headlineMs: 42 });
  const all = await store.list();
  assert.deepStrictEqual(all.map((r) => r.id), ['b', 'c', 'a']);
  assert.strictEqual(all[2].headlineMs, 42);
});

test('save prunes the oldest reports beyond the retention limit', async () => {
  const { store } = make(2);
  for (const [id, t] of [['a', 1], ['b', 2], ['c', 3]] as const) await store.save(report(id, t));
  assert.deepStrictEqual((await store.list()).map((r) => r.id), ['c', 'b']);
});

test('corrupt, truncated and future-version files are skipped and never deleted', async () => {
  const { store, fs } = make(1);
  fs.files.set(path.join('/reports', 'bad.json'), '{ not json');
  fs.files.set(path.join('/reports', 'future.json'), JSON.stringify({ ...report('f', 1), schemaVersion: 99 }));
  fs.files.set(path.join('/reports', 'notes.txt'), 'x');
  await store.save(report('a', 10));
  await store.save(report('b', 20));
  assert.deepStrictEqual((await store.list()).map((r) => r.id), ['b']);
  assert.ok(fs.files.has(path.join('/reports', 'bad.json')));
  assert.ok(fs.files.has(path.join('/reports', 'future.json')));
  assert.ok(fs.files.has(path.join('/reports', 'notes.txt')));
});

test('an unsafe id cannot escape the reports folder', async () => {
  const { store, fs } = make();
  await store.save(report('../../evil', 1));
  assert.ok([...fs.files.keys()].every((k) => path.dirname(k) === path.normalize('/reports')));
});

test('clear removes the stored reports', async () => {
  const { store } = make();
  await store.save(report('a', 1));
  await store.clear();
  assert.deepStrictEqual(await store.list(), []);
});

test('a missing folder lists as empty', async () => {
  const fs = memFs();
  fs.readdir = async () => { throw new Error('ENOENT'); };
  const store = new ReportStore({ dir: '/nope', fs, retention: () => 5, log: () => {} });
  assert.deepStrictEqual(await store.list(), []);
});
```

Add `out/test/reportStore.test.js` to the `test` script.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 3: Implement `src/reportStore.ts`**

```ts
'use strict';

import * as path from 'path';
import { Report, SCHEMA_VERSION } from './types';

export interface StoreFs {
  mkdir(dir: string): Promise<void>;
  readdir(dir: string): Promise<string[]>;
  readFile(file: string): Promise<string>;
  writeFile(file: string, data: string): Promise<void>;
  unlink(file: string): Promise<void>;
}

export interface StoreDeps {
  dir: string;
  fs: StoreFs;
  retention: () => number;
  log: (message: string) => void;
}

function isReport(v: unknown): v is Report {
  const r = v as Partial<Report> | null;
  return (
    typeof r === 'object' && r !== null && r.schemaVersion === SCHEMA_VERSION && typeof r.id === 'string' &&
    typeof r.takenAt === 'number' && Array.isArray(r.milestones) && Array.isArray(r.phases) && Array.isArray(r.extensions)
  );
}

/** One JSON file per launch and window. Files that do not parse as a current report are left alone. */
export class ReportStore {
  constructor(private readonly deps: StoreDeps) {}

  private fileFor(id: string): string {
    return path.join(this.deps.dir, `${id.replace(/[^\w.-]/g, '_')}.json`);
  }

  async save(report: Report): Promise<void> {
    await this.deps.fs.mkdir(this.deps.dir);
    await this.deps.fs.writeFile(this.fileFor(report.id), JSON.stringify(report));
    await this.prune();
  }

  /** Newest first. */
  async list(): Promise<Report[]> {
    return (await this.readAll()).map((e) => e.report).sort((a, b) => b.takenAt - a.takenAt);
  }

  async clear(): Promise<void> {
    for (const { file } of await this.readAll()) await this.deps.fs.unlink(file).catch(() => undefined);
  }

  private async prune(): Promise<void> {
    const all = (await this.readAll()).sort((a, b) => b.report.takenAt - a.report.takenAt);
    for (const { file } of all.slice(Math.max(1, this.deps.retention()))) await this.deps.fs.unlink(file).catch(() => undefined);
  }

  private async readAll(): Promise<{ file: string; report: Report }[]> {
    let names: string[];
    try {
      names = await this.deps.fs.readdir(this.deps.dir);
    } catch {
      return [];
    }
    const out: { file: string; report: Report }[] = [];
    for (const name of names.filter((n) => n.endsWith('.json'))) {
      const file = path.join(this.deps.dir, name);
      try {
        const parsed: unknown = JSON.parse(await this.deps.fs.readFile(file));
        if (isReport(parsed)) out.push({ file, report: parsed });
      } catch (err) {
        this.deps.log(`skipping unreadable report ${name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return out;
  }
}
```
(`clear()` deletes only files that parse as current reports; unknown or corrupt files are left, matching the spec's "never deleted by the reader".)

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src
git commit -m "feat(null-startup): bounded on-disk report history (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Capture, snapshot source, extension entry

**Files:**
- Create: `extensions/null-startup/src/capture.ts`, `src/snapshotSource.ts`
- Modify: `extensions/null-startup/src/extension.ts` (replace stub)
- Test: `extensions/null-startup/src/test/capture.test.ts`
- Modify: `extensions/null-startup/package.json` (`test` script: add `out/test/capture.test.js`)

**Interfaces:**
- Consumes: `buildReport`, `Snapshot`, `Report`, `ReportStore`, `normalizeRetention`, `parseSnapshot`.
- Produces: `class Capture { constructor(deps: CaptureDeps); run(): Promise<void>; dispose(): void }`, `interface CaptureDeps { snapshot(): Promise<Snapshot | undefined>; save(report: Report): Promise<void>; now(): number; windowId: string; schedule(fn: () => void, ms: number): { dispose(): void }; log(m: string): void; onSaved(): void }`, `SETTLE_DELAY_MS = 30_000`; `takeSnapshot(log: (m: string) => void): Promise<Snapshot | undefined>` and `SNAPSHOT_COMMAND` (`snapshotSource.ts`).

- [ ] **Step 1: Write the failing test**

`src/test/capture.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { Capture, CaptureDeps, SETTLE_DELAY_MS } from '../capture';
import { Report, Snapshot } from '../types';

const snap = (extra = 0): Snapshot => ({
  schemaVersion: 1, takenAt: 5000, appVersion: '1', initialStartup: true, metrics: {}, contributions: [],
  marks: [{ source: 'main', name: 'code/didStartMain', startTime: 1000 }, { source: 'renderer', name: 'code/didRestoreEditors', startTime: 2000 }],
  extensions: Array.from({ length: extra }, (_, i) => ({ id: `p.e${i}`, activationEvent: '*', reason: '', eager: true })),
});

function harness(results: (Snapshot | undefined | Error)[]) {
  const saved: Report[] = [];
  const scheduled: { fn: () => void; ms: number; disposed: boolean }[] = [];
  const logs: string[] = [];
  let calls = 0;
  const deps: CaptureDeps = {
    snapshot: async () => {
      const r = results[Math.min(calls++, results.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    save: async (r) => void saved.push(r),
    now: () => 777,
    windowId: 'win',
    schedule: (fn, ms) => {
      const entry = { fn, ms, disposed: false };
      scheduled.push(entry);
      return { dispose: () => void (entry.disposed = true) };
    },
    log: (m) => void logs.push(m),
    onSaved: () => {},
  };
  return { capture: new Capture(deps), saved, scheduled, logs };
}

test('saves a report at once and rewrites the same id after the settle delay', async () => {
  const h = harness([snap(0), snap(2)]);
  await h.capture.run();
  assert.strictEqual(h.saved.length, 1);
  assert.strictEqual(h.saved[0].id, '777-win');
  assert.strictEqual(h.scheduled[0].ms, SETTLE_DELAY_MS);
  h.scheduled[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.saved.length, 2);
  assert.strictEqual(h.saved[1].id, '777-win');
  assert.strictEqual(h.saved[1].extensions.length, 2, 'the later snapshot supersedes the first');
});

test('no snapshot (stock VS Code): nothing saved, nothing scheduled', async () => {
  const h = harness([undefined]);
  await h.capture.run();
  assert.deepStrictEqual([h.saved.length, h.scheduled.length], [0, 0]);
});

test('a failing second snapshot keeps the first report', async () => {
  const h = harness([snap(1), new Error('boom')]);
  await h.capture.run();
  h.scheduled[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(h.saved.length, 1);
  assert.ok(h.logs.some((l) => l.includes('boom')));
});

test('dispose cancels the pending second snapshot', async () => {
  const h = harness([snap(0)]);
  await h.capture.run();
  h.capture.dispose();
  assert.strictEqual(h.scheduled[0].disposed, true);
});
```

Add `out/test/capture.test.js` to the `test` script.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 3: Implement `src/capture.ts`**

```ts
'use strict';

import { buildReport } from './buildReport';
import { Report, Snapshot } from './types';

export const SETTLE_DELAY_MS = 30_000;

export interface CaptureDeps {
  snapshot(): Promise<Snapshot | undefined>;
  save(report: Report): Promise<void>;
  now(): number;
  windowId: string;
  schedule(fn: () => void, ms: number): { dispose(): void };
  log(message: string): void;
  onSaved(): void;
}

/**
 * One report per launch: written right after startup, then rewritten under the same id once late
 * activations have settled. Extension status is cumulative, so the later snapshot supersedes the first.
 */
export class Capture {
  private timer: { dispose(): void } | undefined;

  constructor(private readonly deps: CaptureDeps) {}

  async run(): Promise<void> {
    const id = `${this.deps.now()}-${this.deps.windowId}`;
    if (!(await this.write(id))) return;
    this.timer = this.deps.schedule(() => void this.write(id), SETTLE_DELAY_MS);
  }

  dispose(): void {
    this.timer?.dispose();
  }

  private async write(id: string): Promise<boolean> {
    try {
      const snapshot = await this.deps.snapshot();
      if (!snapshot) return false;
      await this.deps.save(buildReport(snapshot, { id, windowId: this.deps.windowId }));
      this.deps.onSaved();
      return true;
    } catch (err) {
      this.deps.log(`startup report failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Implement `src/snapshotSource.ts` and `src/extension.ts`**

`src/snapshotSource.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { parseSnapshot } from './snapshot';
import { Snapshot } from './types';

export const SNAPSHOT_COMMAND = '_null.startup.snapshot';
const TIMEOUT_MS = 10_000;

/** Calls the internal command added by patch 010; on a build without it, logs once and returns undefined. */
export async function takeSnapshot(log: (message: string) => void): Promise<Snapshot | undefined> {
  try {
    const raw = await Promise.race([
      Promise.resolve(vscode.commands.executeCommand<unknown>(SNAPSHOT_COMMAND)),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), TIMEOUT_MS)),
    ]);
    const snapshot = parseSnapshot(raw);
    if (!snapshot) log('startup snapshot had an unexpected shape; ignored');
    return snapshot;
  } catch (err) {
    log(`startup snapshot unavailable (needs a Null IDE build with patch 010): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}
```

`src/extension.ts` (commands and the panel are added in Tasks 8 and 10 — leave a TODO-free minimal version now):

```ts
'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Capture } from './capture';
import { ReportStore } from './reportStore';
import { normalizeRetention } from './settings';
import { takeSnapshot } from './snapshotSource';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Null Startup');
  const log = (message: string) => output.appendLine(message);
  const config = () => vscode.workspace.getConfiguration('null-startup');

  const store = new ReportStore({
    dir: path.join(context.globalStorageUri.fsPath, 'reports'),
    fs: {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
      readdir: (dir) => fs.readdir(dir),
      readFile: (file) => fs.readFile(file, 'utf8'),
      writeFile: (file, data) => fs.writeFile(file, data, 'utf8'),
      unlink: (file) => fs.unlink(file),
    },
    retention: () => normalizeRetention(config().get('retention')),
    log,
  });
  context.subscriptions.push(output);

  if (config().get('enabled') === false) return;

  const capture = new Capture({
    snapshot: () => takeSnapshot(log),
    save: (report) => store.save(report),
    now: () => Date.now(),
    windowId: crypto.randomBytes(4).toString('hex'),
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return { dispose: () => clearTimeout(t) };
    },
    log,
    onSaved: () => {},
  });
  context.subscriptions.push({ dispose: () => capture.dispose() });
  void capture.run();
}

export function deactivate(): void {}
```

- [ ] **Step 6: Compile** — `npm run compile` → no errors.

- [ ] **Step 7: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src
git commit -m "feat(null-startup): capture a report after startup and again once it settles (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Comparison (pure)

**Files:**
- Create: `extensions/null-startup/src/protocol.ts` (shared with the webview; this task adds the types it needs, Task 9 adds the rest), `src/compare.ts`, `src/format.ts`
- Test: `extensions/null-startup/src/test/compare.test.ts`
- Modify: `package.json` (`test` script: add `out/test/compare.test.js`)

**Interfaces:**
- Consumes: `Report`.
- Produces (`protocol.ts`, global types, no imports/exports): `DeltaVM { id: string; label: string; baseMs?: number; currentMs?: number; deltaMs?: number; regression: boolean }`, `ComparisonVM { baseLabel: string; headline: DeltaVM; phases: DeltaVM[]; extensions: DeltaVM[] }`, `type BaselineKind = 'previous' | 'median' | 'none'`.
- Produces (`compare.ts`): `interface Baseline { headlineMs?: number; phases: Record<string, number>; extensions: Record<string, number> }`, `baselineOf(r: Report): Baseline`, `medianBaseline(rs: Report[]): Baseline`, `compare(current: Report, base: Baseline, baseLabel: string): ComparisonVM`, `MIN_REGRESSION_MS = 50`, `MIN_REGRESSION_RATIO = 0.1`.
- Produces (`format.ts`): `fmtMs(ms: number | undefined): string`, `stamp(epochMs: number): string` (`YYYY-MM-DD HH:mm`, local time).

- [ ] **Step 1: Write the failing test**

`src/test/compare.test.ts`:

```ts
/// <reference path="../protocol.ts" />
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { baselineOf, compare, medianBaseline } from '../compare';
import { fmtMs, stamp } from '../format';
import { Report } from '../types';

const report = (id: string, headline: number | undefined, phases: Record<string, number>, exts: Record<string, number>): Report => ({
  schemaVersion: 1, id, windowId: 'w', takenAt: 1, appVersion: '1', initialStartup: true, partial: false, headlineMs: headline,
  milestones: [],
  phases: Object.entries(phases).map(([id, durationMs]) => ({ id, label: id.toUpperCase(), process: 'renderer' as const, durationMs })),
  extensions: Object.entries(exts).map(([id, totalMs]) => ({ id, activationEvent: '*', reason: id, eager: true, deferred: false, totalMs })),
});

test('a slowdown above both thresholds is a regression; small or relative-tiny ones are not', () => {
  const base = baselineOf(report('a', 1000, { storage: 100, big: 2000 }, { 'p.x': 40 }));
  const cur = report('b', 1300, { storage: 110, big: 2100 }, { 'p.x': 160 });
  const c = compare(cur, base, 'previous');
  assert.strictEqual(c.headline.deltaMs, 300);
  assert.strictEqual(c.headline.regression, true);
  const phase = Object.fromEntries(c.phases.map((p) => [p.id, p]));
  assert.strictEqual(phase['storage'].regression, false, '+10 ms is under 50 ms');
  assert.strictEqual(phase['big'].regression, false, '+100 ms but only 5 %');
  assert.strictEqual(c.extensions[0].id, 'p.x');
  assert.strictEqual(c.extensions[0].regression, true);
  assert.strictEqual(c.baseLabel, 'previous');
});

test('rows are sorted by slowdown and keep entries present on only one side', () => {
  const base = baselineOf(report('a', 1000, { gone: 50 }, {}));
  const cur = report('b', undefined, { fresh: 70 }, {});
  const c = compare(cur, base, 'x');
  const gone = c.phases.find((p) => p.id === 'gone')!;
  const fresh = c.phases.find((p) => p.id === 'fresh')!;
  assert.strictEqual(gone.deltaMs, undefined);
  assert.strictEqual(fresh.deltaMs, undefined);
  assert.strictEqual(fresh.label, 'FRESH');
  assert.strictEqual(c.headline.deltaMs, undefined);
  assert.strictEqual(c.headline.regression, false);
});

test('medianBaseline takes the median per key over the launches that have it', () => {
  const m = medianBaseline([
    report('a', 100, { p: 10 }, { e: 1 }), report('b', 300, { p: 30 }, {}), report('c', 200, {}, { e: 5 }), report('d', 400, { p: 20 }, {}),
  ]);
  assert.strictEqual(m.headlineMs, 250);
  assert.strictEqual(m.phases['p'], 20);
  assert.strictEqual(m.extensions['e'], 3);
  assert.deepStrictEqual(medianBaseline([]), { headlineMs: undefined, phases: {}, extensions: {} });
});

test('format helpers', () => {
  assert.strictEqual(fmtMs(undefined), 'n/a');
  assert.strictEqual(fmtMs(12.4), '12 ms');
  assert.strictEqual(fmtMs(1500), '1.50 s');
  assert.match(stamp(Date.now()), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
```

Add `out/test/compare.test.js` to the `test` script.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 3: Implement**

`src/protocol.ts` (global script, no imports/exports; Task 9 extends it):

```ts
'use strict';

// Types only, shared by the host (via `/// <reference path>`) and the webview bundle.
// No imports/exports: this file is a global script (module: none).

type BaselineKind = 'previous' | 'median' | 'none';

interface DeltaVM {
  id: string;
  label: string;
  baseMs?: number;
  currentMs?: number;
  /** current − base; undefined when either side is missing. */
  deltaMs?: number;
  regression: boolean;
}

interface ComparisonVM {
  baseLabel: string;
  headline: DeltaVM;
  phases: DeltaVM[];
  extensions: DeltaVM[];
}
```

`src/format.ts`:

```ts
'use strict';

export function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

const two = (n: number) => String(n).padStart(2, '0');

/** Local `YYYY-MM-DD HH:mm`. */
export function stamp(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`;
}
```

`src/compare.ts`:

```ts
/// <reference path="./protocol.ts" />
'use strict';

import { Report } from './types';

/** A slowdown is a regression only if it is both noticeable in absolute terms and relative to the baseline. */
export const MIN_REGRESSION_MS = 50;
export const MIN_REGRESSION_RATIO = 0.1;

export interface Baseline {
  headlineMs?: number;
  phases: Record<string, number>;
  extensions: Record<string, number>;
}

const defined = (e: [string, number | undefined]): e is [string, number] => e[1] !== undefined;

export function baselineOf(r: Report): Baseline {
  return {
    headlineMs: r.headlineMs,
    phases: Object.fromEntries(r.phases.map((p): [string, number | undefined] => [p.id, p.durationMs]).filter(defined)),
    extensions: Object.fromEntries(r.extensions.map((e): [string, number | undefined] => [e.id, e.totalMs]).filter(defined)),
  };
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function medians(maps: Record<string, number>[]): Record<string, number> {
  const keys = new Set(maps.flatMap((m) => Object.keys(m)));
  const out: Record<string, number> = {};
  for (const k of keys) {
    const m = median(maps.map((x) => x[k]).filter((v) => v !== undefined));
    if (m !== undefined) out[k] = m;
  }
  return out;
}

export function medianBaseline(rs: Report[]): Baseline {
  const bs = rs.map(baselineOf);
  return {
    headlineMs: median(bs.map((b) => b.headlineMs).filter((v): v is number => v !== undefined)),
    phases: medians(bs.map((b) => b.phases)),
    extensions: medians(bs.map((b) => b.extensions)),
  };
}

function row(id: string, label: string, baseMs: number | undefined, currentMs: number | undefined): DeltaVM {
  const deltaMs = baseMs !== undefined && currentMs !== undefined ? currentMs - baseMs : undefined;
  const regression =
    deltaMs !== undefined && deltaMs >= MIN_REGRESSION_MS && (baseMs === 0 || deltaMs / (baseMs as number) >= MIN_REGRESSION_RATIO);
  return { id, label, baseMs, currentMs, deltaMs, regression };
}

const bySlowdown = (a: DeltaVM, b: DeltaVM) => (b.deltaMs ?? -Infinity) - (a.deltaMs ?? -Infinity);

export function compare(current: Report, base: Baseline, baseLabel: string): ComparisonVM {
  const phaseNow = new Map(current.phases.map((p) => [p.id, p]));
  const extNow = new Map(current.extensions.map((e) => [e.id, e]));
  const phaseIds = [...new Set([...phaseNow.keys(), ...Object.keys(base.phases)])];
  const extIds = [...new Set([...extNow.keys(), ...Object.keys(base.extensions)])];
  return {
    baseLabel,
    headline: row('headline', 'Startup (workspace restored)', base.headlineMs, current.headlineMs),
    phases: phaseIds.map((id) => row(id, phaseNow.get(id)?.label ?? id, base.phases[id], phaseNow.get(id)?.durationMs)).sort(bySlowdown),
    extensions: extIds.map((id) => row(id, id, base.extensions[id], extNow.get(id)?.totalMs)).sort(bySlowdown),
  };
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src
git commit -m "feat(null-startup): compare launches against the previous one or the median (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Export — Markdown and JSON

**Files:**
- Create: `extensions/null-startup/src/exportReport.ts`
- Test: `extensions/null-startup/src/test/exportReport.test.ts`
- Modify: `package.json` (`test` script: add `out/test/exportReport.test.js`)

**Interfaces:**
- Consumes: `Report`, `fmtMs`, `stamp`.
- Produces: `reportToJson(r: Report): string`, `reportToMarkdown(r: Report, slowMs: number): string`.

- [ ] **Step 1: Write the failing test**

`src/test/exportReport.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { buildReport } from '../buildReport';
import { reportToJson, reportToMarkdown } from '../exportReport';
import { Snapshot } from '../types';

const snap: Snapshot = {
  schemaVersion: 1, takenAt: 5000, appVersion: '1.2.3', initialStartup: true, metrics: {}, contributions: [],
  marks: [
    { source: 'main', name: 'code/didStartMain', startTime: 1000 },
    { source: 'renderer', name: 'code/didRestoreEditors', startTime: 2500 },
  ],
  extensions: [
    { id: 'p.slow', activationEvent: 'workspaceContains:C:\\Users\\me\\secret-project\\x', reason: 'p.slow', eager: true, startMs: 1100, endMs: 1500, loadMs: 100, callMs: 100, resolveMs: 100 },
    { id: 'p.quick', activationEvent: 'onLanguage:rust', reason: 'p.quick', eager: false, loadMs: 1, callMs: 1, resolveMs: 1 },
  ],
};
const report = buildReport(snap, { id: 'r', windowId: 'w' });

test('markdown names the headline, flags slow extensions and renders missing data as n/a', () => {
  const md = reportToMarkdown(report, 100);
  assert.match(md, /Startup \(workspace restored\): \*\*1\.50 s\*\*/);
  assert.match(md, /\| p\.slow \|.*slow/);
  assert.doesNotMatch(md, /\| p\.quick \|.*slow/);
  assert.match(md, /n\/a/);
});

test('no export format carries a path or workspace name', () => {
  for (const text of [reportToMarkdown(report, 100), reportToJson(report)]) {
    assert.doesNotMatch(text, /secret-project|Users|C:\\\\|C:\//);
  }
});

test('json round-trips to the same report', () => {
  assert.deepStrictEqual(JSON.parse(reportToJson(report)), JSON.parse(JSON.stringify(report)));
});

test('pipes in cells cannot break the table', () => {
  const r = { ...report, extensions: [{ ...report.extensions[0], id: 'a|b' }] };
  assert.match(reportToMarkdown(r, 100), /a\\\|b/);
});
```

Add `out/test/exportReport.test.js` to the `test` script.

- [ ] **Step 2: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 3: Implement `src/exportReport.ts`**

```ts
'use strict';

import { fmtMs, stamp } from './format';
import { Report } from './types';

const cell = (s: string) => s.replace(/\|/g, '\\|');

function table(head: string[], rows: string[][], numericFrom = 1): string[] {
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map((_, i) => (i >= numericFrom ? '---:' : '---')).join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
}

/** The JSON export is the stored report itself: it is already sanitized when built. */
export function reportToJson(r: Report): string {
  return JSON.stringify(r, null, 2);
}

export function reportToMarkdown(r: Report, slowMs: number): string {
  const phases = r.phases.filter((p) => p.impactMs !== undefined).sort((a, b) => (b.impactMs ?? 0) - (a.impactMs ?? 0)).slice(0, 5);
  const exts = [...r.extensions].sort((a, b) => (b.totalMs ?? -1) - (a.totalMs ?? -1)).slice(0, 10);
  return [
    '# Null IDE startup report',
    '',
    `- Launch: ${stamp(r.takenAt)} · app ${r.appVersion || 'n/a'}${r.initialStartup ? '' : ' · additional window'}${r.partial ? ' · partial data' : ''}`,
    `- Startup (workspace restored): **${fmtMs(r.headlineMs)}**`,
    '',
    '## Milestones',
    '',
    ...table(['Milestone', 'Since launch'], r.milestones.map((m) => [m.label, fmtMs(m.atMs)])),
    '',
    '## Slowest phases (wall-clock impact)',
    '',
    ...table(['Phase', 'Process', 'Duration', 'Impact'], phases.map((p) => [p.label, p.process, fmtMs(p.durationMs), fmtMs(p.impactMs)]), 2),
    '',
    `## Slowest extension activations (flagged at ${slowMs} ms)`,
    '',
    ...table(
      ['Extension', 'Event', 'When', 'Total', 'Flag'],
      exts.map((e) => [e.id, e.activationEvent || 'n/a', e.deferred ? 'deferred' : 'startup', fmtMs(e.totalMs), e.totalMs !== undefined && e.totalMs >= slowMs ? 'slow' : '']),
      3,
    ),
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src
git commit -m "feat(null-startup): Markdown and JSON export of a startup report (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: View model and protocol

**Files:**
- Modify: `extensions/null-startup/src/protocol.ts` (add the view-model and message types)
- Create: `extensions/null-startup/src/reportModel.ts`
- Test: `extensions/null-startup/src/test/reportModel.test.ts`
- Modify: `package.json` (`test` script: add `out/test/reportModel.test.js`)

**Interfaces:**
- Consumes: `Report`, `baselineOf`, `medianBaseline`, `compare`, `assignLanes`, `fmtMs`, `stamp`; protocol types.
- Produces (`protocol.ts`): `MilestoneVM`, `PhaseVM`, `ExtensionVM`, `LaunchOption`, `ReportViewModel`, `HostToWebview`, `WebviewToHost` (below).
- Produces (`reportModel.ts`): `buildViewModel(history: Report[], opts: { selectedId?: string; baseline: BaselineKind; slowMs: number }): ReportViewModel`; `parseWebviewMessage(raw: unknown): WebviewToHost | undefined`.

- [ ] **Step 1: Extend `src/protocol.ts`** (append after `ComparisonVM`)

```ts
interface MilestoneVM {
  id: string;
  label: string;
  atMs?: number;
}

interface PhaseVM {
  id: string;
  label: string;
  process: string;
  startMs?: number;
  endMs?: number;
  durationMs?: number;
  impactMs?: number;
}

interface ExtensionVM {
  id: string;
  activationEvent: string;
  reason: string;
  deferred: boolean;
  startMs?: number;
  endMs?: number;
  loadMs?: number;
  callMs?: number;
  resolveMs?: number;
  totalMs?: number;
  impactMs?: number;
  /** totalMs >= the slow threshold. A flag, not a verdict. */
  slow: boolean;
  /** Timeline lane; 0 when the activation has no start/end stamps. */
  lane: number;
}

interface LaunchOption {
  id: string;
  label: string;
}

interface ReportViewModel {
  hasReport: boolean;
  reportId?: string;
  launches: LaunchOption[];
  baseline: BaselineKind;
  appVersion?: string;
  partial: boolean;
  headlineMs?: number;
  /** Timeline width in ms (≥ 1). */
  spanMs: number;
  slowMs: number;
  milestones: MilestoneVM[];
  phases: PhaseVM[];
  extensions: ExtensionVM[];
  slowestPhases: PhaseVM[];
  slowestExtensions: ExtensionVM[];
  comparison?: ComparisonVM;
}

type HostToWebview = { type: 'model'; model: ReportViewModel };

type WebviewToHost =
  | { type: 'ready' }
  | { type: 'select'; reportId: string }
  | { type: 'setBaseline'; baseline: BaselineKind }
  | { type: 'copy' }
  | { type: 'export' };
```

- [ ] **Step 2: Write the failing test**

`src/test/reportModel.test.ts`:

```ts
/// <reference path="../protocol.ts" />
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { buildViewModel, parseWebviewMessage } from '../reportModel';
import { Report } from '../types';

const report = (id: string, takenAt: number, headlineMs: number | undefined, over: Partial<Report> = {}): Report => ({
  schemaVersion: 1, id, windowId: 'w', takenAt, appVersion: '1.0', initialStartup: true, partial: false, headlineMs,
  milestones: [{ id: 'workspaceRestored', label: 'Workspace restored', atMs: headlineMs }],
  phases: [
    { id: 'p1', label: 'Phase 1', process: 'renderer', startMs: 0, endMs: 300, durationMs: 300, impactMs: 300 },
    { id: 'p2', label: 'Phase 2', process: 'renderer', startMs: 100, endMs: 150, durationMs: 50, impactMs: 0 },
    { id: 'p3', label: 'Phase 3', process: 'main' },
  ],
  extensions: [
    { id: 'p.a', activationEvent: '*', reason: '', eager: true, deferred: false, startMs: 0, endMs: 400, totalMs: 400, impactMs: 400 },
    { id: 'p.b', activationEvent: '*', reason: '', eager: true, deferred: false, startMs: 100, endMs: 200, totalMs: 30, impactMs: 0 },
    { id: 'p.c', activationEvent: '*', reason: '', eager: false, deferred: true },
  ],
  ...over,
});

const history = [report('c', 3000, 1200), report('b', 2000, 1000), report('a', 1000, 900)];

test('no history gives an empty, usable model', () => {
  const m = buildViewModel([], { baseline: 'previous', slowMs: 100 });
  assert.strictEqual(m.hasReport, false);
  assert.deepStrictEqual([m.phases, m.extensions, m.launches], [[], [], []]);
  assert.ok(m.spanMs >= 1);
});

test('selects the newest report by default, flags slow extensions, assigns lanes, ranks the slowest', () => {
  const m = buildViewModel(history, { baseline: 'none', slowMs: 100 });
  assert.strictEqual(m.reportId, 'c');
  assert.strictEqual(m.headlineMs, 1200);
  assert.strictEqual(m.launches.length, 3);
  const e = Object.fromEntries(m.extensions.map((x) => [x.id, x]));
  assert.strictEqual(e['p.a'].slow, true);
  assert.strictEqual(e['p.b'].slow, false);
  assert.strictEqual(e['p.c'].slow, false, 'unknown total is never slow');
  assert.deepStrictEqual([e['p.a'].lane, e['p.b'].lane], [0, 1], 'overlapping activations get separate lanes');
  assert.deepStrictEqual(m.slowestPhases.map((p) => p.id), ['p1'], 'p2 is fully covered by p1, so it adds no wall-clock time');
  assert.deepStrictEqual(m.slowestExtensions.map((x) => x.id), ['p.a', 'p.b']);
  assert.strictEqual(m.spanMs, 1200);
  assert.strictEqual(m.comparison, undefined);
});

test('baseline previous compares with the next older launch; median with all others', () => {
  const prev = buildViewModel(history, { baseline: 'previous', slowMs: 100 });
  assert.strictEqual(prev.comparison!.headline.baseMs, 1000);
  assert.strictEqual(prev.comparison!.headline.deltaMs, 200);
  const med = buildViewModel(history, { baseline: 'median', slowMs: 100 });
  assert.strictEqual(med.comparison!.headline.baseMs, 950);
  const oldest = buildViewModel(history, { selectedId: 'a', baseline: 'previous', slowMs: 100 });
  assert.strictEqual(oldest.comparison, undefined, 'nothing older to compare with');
});

test('a selected id that no longer exists falls back to the newest', () => {
  assert.strictEqual(buildViewModel(history, { selectedId: 'gone', baseline: 'none', slowMs: 100 }).reportId, 'c');
});

test('parseWebviewMessage accepts only well-formed intents', () => {
  assert.deepStrictEqual(parseWebviewMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'copy' }), { type: 'copy' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'select', reportId: 'a' }), { type: 'select', reportId: 'a' });
  assert.deepStrictEqual(parseWebviewMessage({ type: 'setBaseline', baseline: 'median' }), { type: 'setBaseline', baseline: 'median' });
  for (const bad of [null, 'x', {}, { type: 'select' }, { type: 'select', reportId: 5 }, { type: 'setBaseline', baseline: 'weird' }, { type: 'nope' }]) {
    assert.strictEqual(parseWebviewMessage(bad), undefined);
  }
});
```

Add `out/test/reportModel.test.js` to the `test` script.

- [ ] **Step 3: Run to verify failure** — `npm test` → FAIL.

- [ ] **Step 4: Implement `src/reportModel.ts`**

```ts
/// <reference path="./protocol.ts" />
'use strict';

import { baselineOf, compare, medianBaseline } from './compare';
import { fmtMs, stamp } from './format';
import { assignLanes } from './intervals';
import { Report } from './types';

const BASELINES: BaselineKind[] = ['previous', 'median', 'none'];

export function parseWebviewMessage(raw: unknown): WebviewToHost | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as { type?: unknown; reportId?: unknown; baseline?: unknown };
  switch (m.type) {
    case 'ready':
    case 'copy':
    case 'export':
      return { type: m.type };
    case 'select':
      return typeof m.reportId === 'string' ? { type: 'select', reportId: m.reportId } : undefined;
    case 'setBaseline':
      return BASELINES.includes(m.baseline as BaselineKind) ? { type: 'setBaseline', baseline: m.baseline as BaselineKind } : undefined;
    default:
      return undefined;
  }
}

const launchLabel = (r: Report) => `${stamp(r.takenAt)} · ${fmtMs(r.headlineMs)}${r.partial ? ' (partial)' : ''}`;

/** `history` is newest first. */
export function buildViewModel(history: Report[], opts: { selectedId?: string; baseline: BaselineKind; slowMs: number }): ReportViewModel {
  const launches = history.map((r) => ({ id: r.id, label: launchLabel(r) }));
  const current = history.find((r) => r.id === opts.selectedId) ?? history[0];
  if (!current) {
    return {
      hasReport: false, launches, baseline: opts.baseline, partial: false, spanMs: 1, slowMs: opts.slowMs,
      milestones: [], phases: [], extensions: [], slowestPhases: [], slowestExtensions: [],
    };
  }

  const lanes = assignLanes(current.extensions.map((e) => (e.startMs !== undefined && e.endMs !== undefined ? { start: e.startMs, end: e.endMs } : undefined)));
  const extensions: ExtensionVM[] = current.extensions.map((e, i) => ({
    id: e.id, activationEvent: e.activationEvent, reason: e.reason, deferred: e.deferred,
    startMs: e.startMs, endMs: e.endMs, loadMs: e.loadMs, callMs: e.callMs, resolveMs: e.resolveMs, totalMs: e.totalMs, impactMs: e.impactMs,
    slow: e.totalMs !== undefined && e.totalMs >= opts.slowMs,
    lane: lanes[i],
  }));
  const phases: PhaseVM[] = current.phases.map((p) => ({ ...p }));
  const milestones: MilestoneVM[] = current.milestones.map((m) => ({ ...m }));

  const ends = [...phases.map((p) => p.endMs), ...extensions.map((e) => e.endMs), ...milestones.map((m) => m.atMs)];
  const spanMs = Math.max(1, ...ends.filter((v): v is number => v !== undefined));

  const older = history.filter((r) => r.takenAt < current.takenAt);
  const others = history.filter((r) => r.id !== current.id);
  let comparison: ComparisonVM | undefined;
  if (opts.baseline === 'previous' && older.length) comparison = compare(current, baselineOf(older[0]), `previous launch (${stamp(older[0].takenAt)})`);
  else if (opts.baseline === 'median' && others.length) comparison = compare(current, medianBaseline(others), `median of ${others.length} other launch${others.length === 1 ? '' : 'es'}`);

  return {
    hasReport: true,
    reportId: current.id,
    launches,
    baseline: opts.baseline,
    appVersion: current.appVersion,
    partial: current.partial,
    headlineMs: current.headlineMs,
    spanMs,
    slowMs: opts.slowMs,
    milestones,
    phases,
    extensions,
    slowestPhases: phases.filter((p) => (p.impactMs ?? 0) > 0).sort((a, b) => (b.impactMs ?? 0) - (a.impactMs ?? 0)).slice(0, 3),
    slowestExtensions: extensions.filter((e) => e.totalMs !== undefined).sort((a, b) => (b.totalMs ?? 0) - (a.totalMs ?? 0)).slice(0, 3),
    comparison,
  };
}
```

- [ ] **Step 5: Run to verify pass** — `npm test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src
git commit -m "feat(null-startup): report view model and webview protocol (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Webview UI, panel, commands

**Files:**
- Create: `extensions/null-startup/src/reportHtml.ts`, `src/reportPanel.ts`, `src/commands.ts`
- Create: `extensions/null-startup/src/webview/report/dom.ts`, `model.ts`, `tables.ts`, `timeline.ts`, `main.ts`
- Create: `extensions/null-startup/lib/report.css` (hand-written)
- Create: `extensions/null-startup/tsconfig.webview-report.json`, `tsconfig.webview-report-shared.json`
- Modify: `extensions/null-startup/src/extension.ts`, `package.json` (compile/test scripts), `scripts/sync-local.ps1` if `lib` was deferred in Task 2
- Test: `extensions/null-startup/src/test/reportWebviewModel.test.ts`, `src/test/reportHtml.test.ts`

**Interfaces:**
- Consumes: protocol types, `ReportStore`, `buildViewModel`, `parseWebviewMessage`, `reportToMarkdown`, `reportToJson`, `normalizeSlowMs`, `stamp`.
- Produces: `getReportHtml(nonce, cspSource, scriptUri, styleUri): string`; `class ReportPanel { constructor(ctx, store, slowMs: () => number); reveal(): void; refresh(): void; selectedReport(): Promise<Report | undefined>; dispose(): void }`; `registerCommands(context, store, panel, slowMs)`.
- Webview globals (top-level functions, `vm`-tested): `formatMs(ms)`, `formatDelta(ms)`, `pct(ms, spanMs)`, `sortBy(rows, key, dir)`, `h`, `s`.

- [ ] **Step 1: tsconfigs**

`tsconfig.webview-report.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./lib/report.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/protocol.ts",
    "src/webview/report/dom.ts",
    "src/webview/report/model.ts",
    "src/webview/report/tables.ts",
    "src/webview/report/timeline.ts",
    "src/webview/report/main.ts"
  ]
}
```

`tsconfig.webview-report-shared.json`:

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "module": "none",
    "lib": ["ES2017", "DOM"],
    "outFile": "./out/webview-report-shared.js",
    "strict": true,
    "sourceMap": false,
    "skipLibCheck": true
  },
  "include": [
    "src/protocol.ts",
    "src/webview/report/dom.ts",
    "src/webview/report/model.ts"
  ]
}
```

In `package.json` set:
```json
    "compile": "tsc -p tsconfig.json && tsc -p tsconfig.webview-report-shared.json && tsc -p tsconfig.webview-report.json",
    "test": "tsc -p tsconfig.json && tsc -p tsconfig.webview-report-shared.json && tsc -p tsconfig.webview-report.json && node --test out/test/snapshot.test.js out/test/settings.test.js out/test/intervals.test.js out/test/sanitize.test.js out/test/buildReport.test.js out/test/reportStore.test.js out/test/capture.test.js out/test/compare.test.js out/test/exportReport.test.js out/test/reportModel.test.js out/test/reportWebviewModel.test.js out/test/reportHtml.test.js",
```

- [ ] **Step 2: Write the failing tests**

`src/test/reportWebviewModel.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

// The webview bundle is a plain script: load the compiled shared file into a sandbox and read its
// top-level functions back. dom.ts only touches `document` when called, so an empty context is enough.
const sandbox = vm.createContext({});
vm.runInContext(readFileSync(path.join(__dirname, '..', 'webview-report-shared.js'), 'utf8'), sandbox);
const w = sandbox as unknown as {
  formatMs(ms: number | undefined): string;
  formatDelta(ms: number | undefined): string;
  pct(ms: number, spanMs: number): number;
  sortBy<T>(rows: T[], key: (r: T) => number | string | undefined, dir: 1 | -1): T[];
};

test('formatMs and formatDelta', () => {
  assert.strictEqual(w.formatMs(undefined), 'n/a');
  assert.strictEqual(w.formatMs(12.4), '12 ms');
  assert.strictEqual(w.formatMs(1500), '1.50 s');
  assert.strictEqual(w.formatDelta(undefined), 'n/a');
  assert.strictEqual(w.formatDelta(0), '0 ms');
  assert.strictEqual(w.formatDelta(200), '+200 ms');
  assert.strictEqual(w.formatDelta(-1500), '−1.50 s');
});

test('pct clamps to 0..100 and survives a zero span', () => {
  assert.strictEqual(w.pct(50, 200), 25);
  assert.strictEqual(w.pct(500, 200), 100);
  assert.strictEqual(w.pct(-5, 200), 0);
  assert.strictEqual(w.pct(5, 0), 0);
});

test('sortBy orders by key in both directions and always puts undefined last', () => {
  const rows = [{ v: 2 }, { v: undefined }, { v: 1 }, { v: 3 }];
  const key = (r: { v: number | undefined }) => r.v;
  assert.deepStrictEqual(w.sortBy(rows, key, 1).map(key), [1, 2, 3, undefined]);
  assert.deepStrictEqual(w.sortBy(rows, key, -1).map(key), [3, 2, 1, undefined]);
  assert.deepStrictEqual(rows.map(key), [2, undefined, 1, 3], 'input is not mutated');
  assert.deepStrictEqual(w.sortBy([{ v: 'b' }, { v: 'a' }], (r) => r.v, 1).map((r) => r.v), ['a', 'b']);
});
```

`src/test/reportHtml.test.ts`:

```ts
'use strict';

import assert from 'node:assert';
import { test } from 'node:test';
import { getReportHtml } from '../reportHtml';

test('the shell sets a nonce-only script CSP and loads the bundle', () => {
  const html = getReportHtml('N0NC3', 'vscode-resource:', 'script.js', 'style.css');
  assert.match(html, /script-src 'nonce-N0NC3'/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /<script nonce="N0NC3" src="script.js">/);
  assert.match(html, /href="style.css"/);
  assert.doesNotMatch(html, /unsafe-inline/);
});
```

- [ ] **Step 3: Implement the shared webview files**

`src/webview/report/dom.ts` (same helpers as the null-activity dashboard; top-level `function` declarations only):

```ts
'use strict';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined> | null;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Sets attributes and appends children as text nodes or elements, so data (extension ids, events)
 * is never parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and
 * children are skipped. Never pass `style`: the CSP forbids inline style attributes.
 */
function fill<T extends Element>(el: T, attrs: Attrs | undefined, children: Child[]): T {
  if (attrs) {
    for (const name of Object.keys(attrs)) {
      const v = attrs[name];
      if (v === null || v === undefined || v === false) continue;
      el.setAttribute(name, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

function h(tag: string, attrs?: Attrs, ...children: Child[]): HTMLElement {
  return fill(document.createElement(tag), attrs, children);
}

function s(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  return fill(document.createElementNS(SVG_NS, tag) as SVGElement, attrs, children);
}
```

`src/webview/report/model.ts`:

```ts
'use strict';

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
}

function formatDelta(ms: number | undefined): string {
  if (ms === undefined) return 'n/a';
  if (ms === 0) return '0 ms';
  return (ms > 0 ? '+' : '−') + formatMs(Math.abs(ms));
}

/** Position of `ms` on a `spanMs` wide axis, clamped to 0..100. */
function pct(ms: number, spanMs: number): number {
  return spanMs > 0 ? Math.min(100, Math.max(0, (ms / spanMs) * 100)) : 0;
}

/** Stable copy sorted by `key`; rows without a value go last in either direction. */
function sortBy<T>(rows: T[], key: (row: T) => number | string | undefined, dir: 1 | -1): T[] {
  return rows.slice().sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === undefined && y === undefined) return 0;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    return x < y ? -dir : x > y ? dir : 0;
  });
}
```

`src/reportHtml.ts`:

```ts
'use strict';

/** The whole UI is built by lib/report.js; this page only sets the CSP and loads it. */
export function getReportHtml(nonce: string, cspSource: string, scriptUri: string, styleUri: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Startup Performance</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
```

- [ ] **Step 4: Run to verify the tests pass**

Run: `cd extensions/null-startup && npm test`
Expected: PASS — the `webview-report-shared` compile succeeds once `protocol.ts`, `dom.ts`, `model.ts` exist (the `webview-report` compile needs `tables.ts`/`timeline.ts`/`main.ts`, created next — create them before running if `npm test` aborts on the second tsc).

- [ ] **Step 5: Implement the rest of the webview**

`src/webview/report/tables.ts`:

```ts
'use strict';

interface Column<T> {
  title: string;
  value: (row: T) => number | string | undefined;
  text: (row: T) => string;
  numeric?: boolean;
}

interface SortState {
  key: number;
  dir: 1 | -1;
}

function renderTable<T>(rows: T[], columns: Column<T>[], sort: SortState, onSort: () => void, flag?: (row: T) => string): HTMLElement {
  const sorted = sortBy(rows, columns[sort.key].value, sort.dir);
  const head = columns.map((c, i) => {
    const arrow = i === sort.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const button = h('button', { type: 'button', class: 'sort' }, c.title + arrow);
    button.addEventListener('click', () => {
      if (sort.key === i) sort.dir = sort.dir === 1 ? -1 : 1;
      else {
        sort.key = i;
        sort.dir = c.numeric ? -1 : 1;
      }
      onSort();
    });
    return h('th', { class: c.numeric ? 'num' : null, 'aria-sort': i === sort.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none' }, button);
  });
  const body = sorted.map((r) => h('tr', { class: flag ? flag(r) : null }, ...columns.map((c) => h('td', { class: c.numeric ? 'num' : null }, c.text(r)))));
  return h('table', null, h('thead', null, h('tr', null, ...head)), h('tbody', null, ...body));
}
```

`src/webview/report/timeline.ts`:

```ts
'use strict';

function timelineBar(x1: number, x2: number, y: number, cls: string, title: string): SVGElement {
  return s('rect', { x: x1, y, width: Math.max(1.5, x2 - x1), height: 14, class: cls }, s('title', null, title));
}

/** Gantt strip: one row per measured phase, then packed lanes of extension activations, milestones as vertical lines. */
function renderTimeline(m: ReportViewModel): SVGElement {
  const W = 1000;
  const ROW = 17;
  const TOP = 18;
  const x = (ms: number) => (pct(ms, m.spanMs) / 100) * W;

  const phases = m.phases.filter((p) => p.startMs !== undefined && p.endMs !== undefined);
  const exts = m.extensions.filter((e) => e.startMs !== undefined && e.endMs !== undefined);
  const lanes = exts.reduce((n, e) => Math.max(n, e.lane + 1), 0);
  const H = TOP + (phases.length + lanes) * ROW + 6;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img', 'aria-label': 'Startup timeline' });
  phases.forEach((p, i) => svg.appendChild(timelineBar(x(p.startMs!), x(p.endMs!), TOP + i * ROW, 'bar phase', `${p.label}: ${formatMs(p.durationMs)}`)));
  exts.forEach((e) => {
    const cls = 'bar ext' + (e.deferred ? ' deferred' : '') + (e.slow ? ' slow' : '');
    svg.appendChild(timelineBar(x(e.startMs!), x(e.endMs!), TOP + (phases.length + e.lane) * ROW, cls, `${e.id}: ${formatMs(e.totalMs)}${e.deferred ? ' (deferred)' : ''}`));
  });
  m.milestones.forEach((ms) => {
    if (ms.atMs === undefined) return;
    const mx = x(ms.atMs);
    svg.appendChild(s('line', { x1: mx, x2: mx, y1: 12, y2: H, class: 'milestone' }));
    svg.appendChild(s('text', { x: Math.min(mx + 3, W - 90), y: 10, class: 'milestone-label' }, ms.label));
  });
  return svg;
}
```

`src/webview/report/main.ts`:

```ts
'use strict';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };

const vscodeApi = acquireVsCodeApi();
const appRoot = document.getElementById('app') as HTMLElement;
let model: ReportViewModel | undefined;

const phaseSort: SortState = { key: 3, dir: -1 };
const extSort: SortState = { key: 4, dir: -1 };

function send(message: WebviewToHost): void {
  vscodeApi.postMessage(message);
}

function button(text: string, message: WebviewToHost): HTMLElement {
  const b = h('button', { type: 'button', class: 'action' }, text);
  b.addEventListener('click', () => send(message));
  return b;
}

function renderControls(m: ReportViewModel): HTMLElement {
  const launches = h('select', { 'aria-label': 'Launch' }, ...m.launches.map((l) => h('option', { value: l.id, selected: l.id === m.reportId }, l.label)));
  launches.addEventListener('change', () => send({ type: 'select', reportId: (launches as HTMLSelectElement).value }));
  const options: { id: BaselineKind; label: string }[] = [
    { id: 'previous', label: 'Compare with previous launch' },
    { id: 'median', label: 'Compare with median' },
    { id: 'none', label: 'No comparison' },
  ];
  const baseline = h('select', { 'aria-label': 'Comparison' }, ...options.map((o) => h('option', { value: o.id, selected: o.id === m.baseline }, o.label)));
  baseline.addEventListener('change', () => send({ type: 'setBaseline', baseline: (baseline as HTMLSelectElement).value as BaselineKind }));
  return h('div', { class: 'controls' }, launches, baseline, button('Copy report', { type: 'copy' }), button('Export JSON…', { type: 'export' }));
}

function renderSummary(m: ReportViewModel): HTMLElement {
  const list = (title: string, items: string[]) => h('div', { class: 'slowest' }, h('h3', null, title), h('ol', null, ...(items.length ? items.map((t) => h('li', null, t)) : [h('li', null, 'n/a')])));
  return h(
    'section',
    { class: 'summary' },
    h('div', { class: 'headline' }, h('span', { class: 'big' }, formatMs(m.headlineMs)), h('span', { class: 'sub' }, 'until the workspace was restored' + (m.partial ? ' (partial data)' : ''))),
    h('div', { class: 'milestones' }, ...m.milestones.map((ms) => h('span', { class: 'chip' }, `${ms.label} ${formatMs(ms.atMs)}`))),
    list('Slowest phases', m.slowestPhases.map((p) => `${p.label} — ${formatMs(p.impactMs)}`)),
    list('Slowest extensions', m.slowestExtensions.map((e) => `${e.id} — ${formatMs(e.totalMs)}${e.slow ? ' (slow)' : ''}`)),
  );
}

function renderComparison(c: ComparisonVM): HTMLElement {
  const columns: Column<DeltaVM>[] = [
    { title: 'Name', value: (r) => r.label, text: (r) => r.label },
    { title: 'Before', value: (r) => r.baseMs, text: (r) => formatMs(r.baseMs), numeric: true },
    { title: 'Now', value: (r) => r.currentMs, text: (r) => formatMs(r.currentMs), numeric: true },
    { title: 'Change', value: (r) => r.deltaMs, text: (r) => formatDelta(r.deltaMs) + (r.regression ? ' ⚠' : ''), numeric: true },
  ];
  const state: SortState = { key: 3, dir: -1 };
  const flag = (r: DeltaVM) => (r.regression ? 'regression' : '');
  const holder = h('div', { class: 'cmp-tables' });
  const draw = () => {
    holder.replaceChildren(
      h('h3', null, 'Phases'), renderTable(c.phases, columns, state, draw, flag),
      h('h3', null, 'Extensions'), renderTable(c.extensions.slice(0, 15), columns, state, draw, flag),
    );
  };
  draw();
  return h('section', null, h('h2', null, `Compared with ${c.baseLabel}`), h('p', { class: flag(c.headline) }, `Startup ${formatMs(c.headline.baseMs)} → ${formatMs(c.headline.currentMs)} (${formatDelta(c.headline.deltaMs)})${c.headline.regression ? ' ⚠ regression' : ''}`), holder);
}

function render(): void {
  if (!model) return;
  const m = model;
  if (!m.hasReport) {
    appRoot.replaceChildren(h('h1', null, 'Startup Performance'), h('p', { class: 'empty' }, 'No startup report yet. A report is recorded after each launch of a Null IDE build that includes startup instrumentation.'));
    return;
  }
  const phaseColumns: Column<PhaseVM>[] = [
    { title: 'Phase', value: (r) => r.label, text: (r) => r.label },
    { title: 'Process', value: (r) => r.process, text: (r) => r.process },
    { title: 'Start', value: (r) => r.startMs, text: (r) => formatMs(r.startMs), numeric: true },
    { title: 'Impact', value: (r) => r.impactMs, text: (r) => formatMs(r.impactMs), numeric: true },
    { title: 'Duration', value: (r) => r.durationMs, text: (r) => formatMs(r.durationMs), numeric: true },
  ];
  const extColumns: Column<ExtensionVM>[] = [
    { title: 'Extension', value: (r) => r.id, text: (r) => r.id },
    { title: 'When', value: (r) => (r.deferred ? 'deferred' : 'startup'), text: (r) => (r.deferred ? 'deferred' : 'startup') },
    { title: 'Event', value: (r) => r.activationEvent, text: (r) => r.activationEvent || 'n/a' },
    { title: 'Start', value: (r) => r.startMs, text: (r) => formatMs(r.startMs), numeric: true },
    { title: 'Total', value: (r) => r.totalMs, text: (r) => formatMs(r.totalMs) + (r.slow ? ' · slow' : ''), numeric: true },
    { title: 'Load', value: (r) => r.loadMs, text: (r) => formatMs(r.loadMs), numeric: true },
    { title: 'Activate', value: (r) => r.callMs, text: (r) => formatMs(r.callMs), numeric: true },
    { title: 'Resolve', value: (r) => r.resolveMs, text: (r) => formatMs(r.resolveMs), numeric: true },
  ];
  appRoot.replaceChildren(
    h('h1', null, 'Startup Performance'),
    renderControls(m),
    renderSummary(m),
    m.comparison ? renderComparison(m.comparison) : null,
    h('section', null, h('h2', null, 'Timeline'), renderTimeline(m), h('p', { class: 'legend' }, 'Phases on top, then extension activations (lighter = deferred, outlined = slow). Overlapping bars ran concurrently.')),
    h('section', null, h('h2', null, 'Phases'), renderTable(m.phases, phaseColumns, phaseSort, render)),
    h('section', null, h('h2', null, `Extensions (slow ≥ ${m.slowMs} ms)`), renderTable(m.extensions, extColumns, extSort, render, (r) => (r.slow ? 'slow' : ''))),
  );
}

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as HostToWebview;
  if (message && message.type === 'model') {
    model = message.model;
    render();
  }
});

send({ type: 'ready' });
```

`lib/report.css` (hand-written):

```css
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px 20px 32px; }
h1 { font-size: 1.5em; font-weight: 600; margin: 0 0 12px; }
h2 { font-size: 1.15em; margin: 24px 0 8px; }
h3 { font-size: 1em; margin: 12px 0 4px; color: var(--vscode-descriptionForeground); }
.controls { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
select, button.action { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border, transparent); padding: 3px 8px; font: inherit; }
button.action { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); cursor: pointer; }
.summary { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
.headline { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 12px; }
.big { font-size: 2.2em; font-weight: 600; }
.sub, .legend, .empty { color: var(--vscode-descriptionForeground); }
.milestones { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 10px; padding: 1px 10px; }
.slowest ol { margin: 0; padding-left: 20px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,.25)); }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
button.sort { all: unset; cursor: pointer; font-weight: 600; }
button.sort:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
tr.slow td:first-child, tr.regression td:first-child { box-shadow: inset 3px 0 var(--vscode-editorWarning-foreground); }
p.regression { color: var(--vscode-editorWarning-foreground); }
.timeline { width: 100%; height: auto; }
.timeline .bar { fill: var(--vscode-charts-blue); }
.timeline .bar.ext { fill: var(--vscode-charts-green); }
.timeline .bar.deferred { opacity: .45; }
.timeline .bar.slow { stroke: var(--vscode-editorWarning-foreground); stroke-width: 2; }
.timeline .milestone { stroke: var(--vscode-editorWarning-foreground); stroke-dasharray: 3 3; }
.timeline .milestone-label { fill: var(--vscode-foreground); font-size: 10px; }
```

- [ ] **Step 6: Implement the panel and commands**

`src/reportPanel.ts`:

```ts
/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getReportHtml } from './reportHtml';
import { buildViewModel, parseWebviewMessage } from './reportModel';
import { ReportStore } from './reportStore';
import { Report } from './types';

const VIEW_TYPE = 'null-startup.report';
const BASELINE_KEY = 'null-startup.report.baseline';

/** Owns the single, reused report tab. All data logic lives in reportModel.ts. */
export class ReportPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private selectedId: string | undefined;
  private baseline: BaselineKind;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ReportStore,
    private readonly slowMs: () => number,
  ) {
    const saved = context.workspaceState.get<unknown>(BASELINE_KEY);
    this.baseline = saved === 'median' || saved === 'none' ? saved : 'previous';
  }

  reveal(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Startup Performance', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [lib] });
    this.panel = panel;
    const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
    panel.webview.html = getReportHtml(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('report.js'), asset('report.css'));
    this.disposables.push(
      panel.webview.onDidReceiveMessage((raw) => this.onMessage(raw)),
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.disposables.splice(0).forEach((d) => d.dispose());
      }),
    );
  }

  /** Re-reads the history and pushes it if the tab is open. */
  refresh(): void {
    if (this.panel) void this.push();
  }

  /** The report the tab shows, or the newest one when the tab was never used. */
  async selectedReport(): Promise<Report | undefined> {
    const all = await this.store.list();
    return all.find((r) => r.id === this.selectedId) ?? all[0];
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private async push(): Promise<void> {
    const history = await this.store.list();
    void this.panel?.webview.postMessage({ type: 'model', model: buildViewModel(history, { selectedId: this.selectedId, baseline: this.baseline, slowMs: this.slowMs() }) } satisfies HostToWebview);
  }

  private onMessage(raw: unknown): void {
    const message = parseWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        void this.push();
        break;
      case 'select':
        this.selectedId = message.reportId;
        void this.push();
        break;
      case 'setBaseline':
        this.baseline = message.baseline;
        void this.context.workspaceState.update(BASELINE_KEY, message.baseline);
        void this.push();
        break;
      case 'copy':
        void vscode.commands.executeCommand('null-startup.copyReport');
        break;
      case 'export':
        void vscode.commands.executeCommand('null-startup.exportReport');
        break;
    }
  }
}
```

`src/commands.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import { reportToJson, reportToMarkdown } from './exportReport';
import { ReportPanel } from './reportPanel';
import { ReportStore } from './reportStore';
import { stamp } from './format';

export function registerCommands(context: vscode.ExtensionContext, store: ReportStore, panel: ReportPanel, slowMs: () => number): void {
  const none = () => vscode.window.showInformationMessage('No startup report has been recorded yet.');
  context.subscriptions.push(
    vscode.commands.registerCommand('null-startup.openReport', () => panel.reveal()),

    vscode.commands.registerCommand('null-startup.copyReport', async () => {
      const report = await panel.selectedReport();
      if (!report) return void none();
      await vscode.env.clipboard.writeText(reportToMarkdown(report, slowMs()));
      void vscode.window.showInformationMessage('Startup report copied to the clipboard.');
    }),

    vscode.commands.registerCommand('null-startup.exportReport', async () => {
      const report = await panel.selectedReport();
      if (!report) return void none();
      const name = `null-startup-${stamp(report.takenAt).replace(/[: ]/g, '-')}.json`;
      const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(name), filters: { JSON: ['json'] } });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(reportToJson(report), 'utf8'));
    }),

    vscode.commands.registerCommand('null-startup.clearHistory', async () => {
      const confirm = await vscode.window.showWarningMessage('Delete all stored startup reports?', { modal: true }, 'Delete');
      if (confirm !== 'Delete') return;
      await store.clear();
      panel.refresh();
    }),
  );
}
```

Update `src/extension.ts`: add imports `ReportPanel` and `registerCommands`/`normalizeSlowMs`; after the `store` creation (before the `enabled` early return) add:

```ts
  const slowMs = () => normalizeSlowMs(config().get('slowExtensionMs'));
  const panel = new ReportPanel(context, store, slowMs);
  context.subscriptions.push(output, panel);
  registerCommands(context, store, panel, slowMs);
```
(remove `context.subscriptions.push(output)` duplicate) and change `Capture`'s `onSaved: () => {}` to `onSaved: () => panel.refresh()`.

- [ ] **Step 7: Build and test**

Run: `cd extensions/null-startup && npm test`
Expected: PASS — all test files (about 40 tests), and `lib/report.js` produced by `tsc -p tsconfig.webview-report.json` with no type errors.

- [ ] **Step 8: Commit**

```bash
git add extensions/null-startup/package.json extensions/null-startup/src extensions/null-startup/lib/report.css extensions/null-startup/tsconfig.webview-report.json extensions/null-startup/tsconfig.webview-report-shared.json scripts/sync-local.ps1
git commit -m "feat(null-startup): startup performance report panel and commands (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Integration spec, compiled output, docs, manual verification

**Files:**
- Create: `extensions/null-startup/src/test/runTest.ts`, `src/test/suite/index.ts`, `src/test/suite/activation.spec.ts`
- Modify: `extensions/null-startup/package.json` (nothing new; `test:integration` already present)
- Modify: `CLAUDE.md` (project)
- Modify: tracked `extensions/null-startup/out/`, `lib/report.js` (compiled output)

- [ ] **Step 1: Integration runner and spec**

```bash
cd extensions/null-startup
mkdir -p src/test/suite
sed "s/null-activity/null-startup/g" ../null-activity/src/test/runTest.ts > src/test/runTest.ts
cp ../null-activity/src/test/suite/index.ts src/test/suite/index.ts
```

`src/test/suite/activation.spec.ts`:

```ts
'use strict';

import * as assert from 'assert';
import * as vscode from 'vscode';

// The integration runner uses a vanilla VS Code build, which has no patch 010, so this spec covers
// the degradation path: the extension stays active and quiet, and the report tab still opens.
suite('null-startup', () => {
  test('activates, registers its commands, and copies nothing on a build without the snapshot command', async function () {
    this.timeout(30_000);
    await vscode.extensions.getExtension('null.null-startup')!.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['null-startup.openReport', 'null-startup.copyReport', 'null-startup.exportReport', 'null-startup.clearHistory']) {
      assert.ok(commands.includes(id), `${id} registered`);
    }
    await vscode.commands.executeCommand('null-startup.openReport');
    await vscode.commands.executeCommand('null-startup.copyReport');
    assert.strictEqual((await vscode.env.clipboard.readText()).includes('Null IDE startup report'), false);
  });
});
```

- [ ] **Step 2: Compile, refresh tracked output, run unit tests**

```bash
cd extensions/null-startup && npm run compile && npm test
```
Expected: PASS. Then `git status extensions/null-startup` shows new `out/` and `lib/report.js`.

- [ ] **Step 3: Commit the spec and compiled output**

```bash
git add extensions/null-startup/src/test extensions/null-startup/out extensions/null-startup/lib/report.js
git commit -m "chore: refresh null-startup compiled output (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Verify in a real Null IDE (needs patch 010 — cannot run in CI-free local sync alone)**

Patch 010 only exists in a built Null IDE. If your installed Null IDE predates the patch, the report stays empty — that is the intended degradation. To see real data you need a build that includes patch 010 (a normal tag/dispatch build, which needs your explicit go-ahead; do not trigger it yourself).

On a patched build: run `/verify-local null-startup` (syncs the extension and runs the integration spec), reload via `scripts/reload-local.ps1`, wait 35 s, run **Null Startup: Open Startup Report** and check: a headline number, four milestones in order, 12 phase rows (`n/a` where a mark is absent), extension rows with *startup*/*deferred*, a timeline with overlapping bars on separate lanes, the comparison dropdown after a second launch, **Copy** and **Export** producing text/JSON with no paths. Compare the headline against **Developer: Startup Performance** (`uiInteractive` should match its "elapsed"; the headline is later by the editor restore).

- [ ] **Step 5: Document**

In `CLAUDE.md` (project):
- Overview: change "Ten built-in extensions" to "Eleven" and add `null-startup` to the list; "an eleventh built-in extension" (Code Spell Checker) becomes "a twelfth"; build step 5 "all ten" → "all eleven"; step 4's list of compiled TS extensions gains `null-startup`.
- Add a `### null-startup (extensions/null-startup/)` section after `null-activity`, summarising: activated on `onStartupFinished`; reads `_null.startup.snapshot` (patch 010; absent on stock VS Code → logs once, empty panel); `Capture` writes one report per launch immediately and rewrites it after 30 s; milestones and headline definition; `buildReport` / `intervals` / `compare` / `reportModel` pure; `ReportStore` one JSON per launch+window under `globalStorageUri/reports`, retention, skips unknown files; only `snapshotSource.ts`, `reportPanel.ts`, `commands.ts`, `extension.ts` import `vscode`; webview in `src/webview/report/` compiled to tracked `lib/report.js`, `lib/report.css` hand-written; settings and commands; privacy rule (sanitized events, no paths); spec and plan paths.
- Patches list: add `- 010-startup-snapshot.patch — stamps extension activations (\`activationStartedAt\`/\`activationEndedAt\`) and registers the internal command \`_null.startup.snapshot\` for null-startup; pure builder tested by \`node --test patches/test/*.test.mjs\``.

Then:

```bash
git add CLAUDE.md
git commit -m "docs: document null-startup and patch 010 (#19)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: Update the graph and finish**

Run `graphify update .` (AST-only, no cost). Do not commit `graphify-out/` unless the repo already tracks it (`git status` will tell). Then report the commits to your human partner and offer `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage** (spec section → task): patch 010 stamps + command → T1; `snapshotSource` → T6; `buildReport` / milestones / startup vs deferred / `partial` → T4; `intervals` (concurrency, no double counting) → T3 (+ used in T4); `compare` → T7; `reportStore` + retention + unknown-version skipping + per-window files → T5, T6 (`windowId` in id); `exportReport` (Markdown + JSON, one sanitized report) → T8; `reportModel` + `protocol` + `parseWebviewMessage` → T9; panel, webview, summary / phases / extensions / timeline / compare → T10; commands (`openReport`, `copyReport`, `exportReport`, `clearHistory`) → T10; settings (`enabled`, `retention`, `slowExtensionMs`) → T2, T10; privacy (`sanitize`) → T3, T8 tests; missing data → T4, T9 tests; testing section → every task (unit), T1 (patch test), T11 (integration degradation spec + manual real-build check); docs → T11.

**Deliberate deviations from the spec** (the spec carries the same corrections):
1. *Slow flag* is a flat threshold (`totalMs >= slowExtensionMs`), not "median plus threshold" — simpler and predictable; add a median rule only if the flat one proves noisy.
2. *Phase rows do not expand to raw marks* — the table already shows start, impact and duration, and raw marks are not stored (keeps reports small and path-free).
3. *No `partial` report on snapshot failure* — a failed or timed-out snapshot saves nothing and keeps the previous report; `partial` instead means "no launch-start mark".
4. The integration spec asserts the degradation path only (vanilla VS Code lacks patch 010); the real command is checked by the pure-builder test (T1) and the manual check (T11 step 4).

**Placeholder scan:** no TBD/TODO; every code step has code; the only prose-only steps are doc edits (T11 step 5) whose content is enumerated.

**Type consistency:** `Snapshot`/`Report`/`PhaseEntry`/`ExtensionEntry` (T2) are used unchanged in T4–T9; `ExtensionEntry.eager` and `.impactMs` are defined in T2 and filled in T4; `buildReport(snapshot, { id, windowId })` (T4) matches `Capture` (T6); `Baseline`/`compare(current, base, baseLabel)` (T7) matches `buildViewModel` (T9); `ReportViewModel` fields used in `main.ts` (T10) exist in `protocol.ts` (T9); `Column`/`SortState` are declared in `tables.ts`, loaded before `main.ts` in the tsconfig `include` order.
