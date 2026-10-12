# Safe Mode Implementation Plan (#18)

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** `null --safe-mode` (and a command, a Start Menu shortcut and a startup-failure dialog) launches Null IDE with user extensions and all Null-owned built-in extensions disabled, with a visible indicator and a one-click way back.

**Architecture:** One new overlay patch, `patches/009-safe-mode.patch`, against the VS Code source. It adds a `safe-mode` CLI argument that the existing extension-enablement check understands, renderer UI (status bar item, title suffix, commands, notification) that lives in core so it works with no extensions, and a main-process failed-start counter that offers safe mode after three failed launches. The installer script gets a Start Menu shortcut.

**Tech Stack:** TypeScript (VS Code source), `node --test` (type-stripping, Node 24) for the pure modules, PowerShell (installer).

**Spec:** [docs/specs/safe-mode-design.md](../specs/safe-mode-design.md)

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [ ] Current branch (no isolation)
- [x] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Safe mode disables: all non-built-in extensions, and built-ins whose publisher is `null` (case-insensitive, exact match) or whose id is `streetsidesoftware.code-spell-checker`. Upstream built-ins stay enabled.
- Nothing is persisted to settings or extension state; a launch without the flag is a normal launch.
- Failed-start threshold: 3 earlier launches without a clean quit or 60 s of uptime. Healthy uptime: 60 s (`HEALTHY_UPTIME_MS = 60_000`). State file: `safe-mode-state.json` in the user data dir.
- A safe-mode launch never prompts and never increments the counter.
- Do not run `scripts/build-local.ps1` or any full build unless the user asks (CLAUDE.md scope constraint).
- Do not hand-edit anything under `extensions/*/out/`; this plan does not touch extensions.
- Commits: end each message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; stage only the files named in the task; never `--no-verify`; do not push.
- `vscode-src/` is git-ignored scratch. It already has VSCodium's patches and overlay patches 001–008 applied but uncommitted, so the patch is exported as a diff of only this plan's edits (see Task 1, Step 2).
- All paths below are relative to the repo root `D:\Coding\Apps\null-ide`. Run bash commands from the repo root.

## Review Focus

Input classes the spec implies that are most likely to bite, most likely first:

1. Missing, empty, corrupt, negative or non-integer `safe-mode-state.json` → treated as 0 attempts; startup is never blocked. (Task 1 test)
2. A safe-mode launch while the counter is ≥ 3 → no dialog, counter unchanged: no restart loop. (Task 1 test)
3. A built-in whose publisher merely starts with "null" (e.g. `nullable`) is not disabled; matching is exact. (Task 1 test)
4. `Restart Normally`, then a plain `Reload Window` stays normal; a second `null --safe-mode` while a normal window is open only makes the new window safe. (Task 3 manual check)
5. Windows reorders dialog buttons through `buttonIndeces`; the chosen button must be mapped back. (Task 5 manual check)

## File Structure

| File (inside `vscode-src/`) | Change | Responsibility |
|---|---|---|
| `src/vs/platform/environment/common/safeMode.ts` | create | Pure predicate: which extensions safe mode disables |
| `src/vs/code/electron-main/safeModeState.ts` | create | Pure failed-start counter rules + tiny file IO (only imports `fs`) |
| `src/vs/workbench/contrib/safeMode/electron-browser/safeMode.contribution.ts` | create | Status bar item, notification, context key, two commands |
| `src/vs/platform/environment/common/argv.ts`, `node/argv.ts` | modify | `safe-mode` argument |
| `src/vs/platform/environment/common/environment.ts`, `environmentService.ts` | modify | `isSafeMode` |
| `src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts` | modify | Apply the predicate in `_isDisabledInEnv` |
| `src/vs/platform/native/common/native.ts`, `src/vs/workbench/services/host/electron-browser/nativeHostService.ts`, `src/vs/platform/native/electron-main/nativeHostMainService.ts`, `src/vs/platform/windows/electron-main/windowImpl.ts` | modify | `reload({ safeMode })` plumbing |
| `src/vs/workbench/browser/parts/titlebar/windowTitle.ts` | modify | `[Safe Mode]` title suffix |
| `src/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.ts` | modify | Skip the `null-dashboard:` page in safe mode |
| `src/vs/workbench/workbench.desktop.main.ts` | modify | Import the contribution |
| `src/vs/code/electron-main/main.ts` | modify | Startup dialog, counter writes |

Repo files: `patches/009-safe-mode.patch`, `patches/test/safeMode.test.mjs`, `scripts/install-null-ide.ps1`, `README.md`, `CLAUDE.md`.

---

### Task 1: Pure modules with tests, patch scaffold

**Files:**
- Create: `vscode-src/src/vs/platform/environment/common/safeMode.ts`
- Create: `vscode-src/src/vs/code/electron-main/safeModeState.ts`
- Create: `patches/test/safeMode.test.mjs`
- Create: `patches/009-safe-mode.patch` (by export)

**Interfaces:**
- Produces (`safeMode.ts`): `isDisabledInSafeMode(extension: { isBuiltin: boolean; identifier: { id: string }; manifest: { publisher?: string } }): boolean`
- Produces (`safeModeState.ts`): `MAX_FAILED_STARTS = 3`, `HEALTHY_UPTIME_MS = 60_000`, `shouldOfferSafeMode(attempts: number, safeMode: boolean): boolean`, `nextAttempts(attempts: number, safeMode: boolean, choice: 'safe' | 'normal' | undefined): number`, `readAttempts(file: string): Promise<number>`, `writeAttempts(file: string, attempts: number): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `patches/test/safeMode.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const src = new URL('../../vscode-src/src/vs/', import.meta.url);
const skip = !existsSync(new URL('platform/environment/common/', src)) && 'vscode-src not present';

// These modules are plain TypeScript with no VS Code imports, so Node's type stripping loads them directly.
const load = (rel) => import(new URL(rel, src).href);

test('isDisabledInSafeMode', { skip }, async () => {
	const { isDisabledInSafeMode } = await load('platform/environment/common/safeMode.ts');
	const ext = (isBuiltin, id, publisher) => ({ isBuiltin, identifier: { id }, manifest: { publisher } });

	assert.equal(isDisabledInSafeMode(ext(false, 'someone.thing', 'someone')), true, 'user extension');
	assert.equal(isDisabledInSafeMode(ext(true, 'null.null-tools', 'null')), true, 'null built-in');
	assert.equal(isDisabledInSafeMode(ext(true, 'Null.null-tools', 'Null')), true, 'publisher case');
	assert.equal(isDisabledInSafeMode(ext(true, 'streetsidesoftware.Code-Spell-Checker', 'streetsidesoftware')), true, 'cspell');
	assert.equal(isDisabledInSafeMode(ext(true, 'vscode.git', 'vscode')), false, 'upstream built-in');
	assert.equal(isDisabledInSafeMode(ext(true, 'nullable.foo', 'nullable')), false, 'publisher prefix only');
	assert.equal(isDisabledInSafeMode(ext(true, 'x.y', undefined)), false, 'missing publisher');
});

test('failed-start rules', { skip }, async () => {
	const { MAX_FAILED_STARTS, shouldOfferSafeMode, nextAttempts } = await load('code/electron-main/safeModeState.ts');
	assert.equal(MAX_FAILED_STARTS, 3);

	assert.equal(shouldOfferSafeMode(2, false), false);
	assert.equal(shouldOfferSafeMode(3, false), true);
	assert.equal(shouldOfferSafeMode(9, false), true);
	assert.equal(shouldOfferSafeMode(9, true), false, 'safe-mode launch never prompts');

	assert.equal(nextAttempts(1, false, undefined), 2, 'normal start counts');
	assert.equal(nextAttempts(3, false, 'safe'), 0, 'chose safe mode resets');
	assert.equal(nextAttempts(3, false, 'normal'), 1, 'chose normal counts this start');
	assert.equal(nextAttempts(5, true, undefined), 5, 'safe-mode launch never counts');
});

test('state file', { skip }, async () => {
	const { readAttempts, writeAttempts } = await load('code/electron-main/safeModeState.ts');
	const dir = mkdtempSync(join(tmpdir(), 'safe-mode-'));
	const file = join(dir, 'safe-mode-state.json');

	assert.equal(await readAttempts(file), 0, 'missing');
	for (const bad of ['', 'not json', '{}', '{"startupAttempts":-1}', '{"startupAttempts":1.5}', '{"startupAttempts":"3"}', 'null']) {
		writeFileSync(file, bad);
		assert.equal(await readAttempts(file), 0, `corrupt: ${bad}`);
	}

	await writeAttempts(file, 2);
	assert.equal(await readAttempts(file), 2);
	assert.deepEqual(readdirSync(dir), ['safe-mode-state.json'], 'no temp file left behind');
});
```

- [ ] **Step 2: Baseline the tree, then run the test to see it fail**

The patch is a diff against the index, so stage the current (already-patched) content of the whole scratch tree once. This only touches the git-ignored `vscode-src` index, and from now on `git diff` there shows only this plan's edits.

```bash
cd vscode-src && git add -A && cd ..
node --test patches/test/
```

Expected: FAIL (`Cannot find module .../safeMode.ts`).

**Export command** (reused at the end of every task; run from the repo root):

```bash
cd vscode-src && git add -N   src/vs/platform/environment/common/safeMode.ts   src/vs/code/electron-main/safeModeState.ts   $(ls src/vs/workbench/contrib/safeMode/electron-browser/safeMode.contribution.ts 2>/dev/null); git diff > ../patches/009-safe-mode.patch; cd ..
```

(`add -N` makes the new files appear in the diff; the contribution file only exists from Task 4 on, which is why it is listed through `ls`.)

- [ ] **Step 3: Implement `safeMode.ts`**

Create `vscode-src/src/vs/platform/environment/common/safeMode.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const NULL_PUBLISHER = 'null';
const NULL_BUNDLED_EXTENSION_IDS = ['streetsidesoftware.code-spell-checker'];

/**
 * Safe mode disables every extension except VS Code's own built-ins:
 * user-installed extensions, Null IDE's built-ins (publisher `null`) and
 * the bundled Code Spell Checker.
 */
export function isDisabledInSafeMode(extension: { isBuiltin: boolean; identifier: { id: string }; manifest: { publisher?: string } }): boolean {
	if (!extension.isBuiltin) {
		return true;
	}
	return extension.manifest.publisher?.toLowerCase() === NULL_PUBLISHER
		|| NULL_BUNDLED_EXTENSION_IDS.includes(extension.identifier.id.toLowerCase());
}
```

- [ ] **Step 4: Implement `safeModeState.ts`**

Create `vscode-src/src/vs/code/electron-main/safeModeState.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';

/** Earlier launches that ended without a clean quit or HEALTHY_UPTIME_MS of uptime before safe mode is offered. */
export const MAX_FAILED_STARTS = 3;
export const HEALTHY_UPTIME_MS = 60_000;

export function shouldOfferSafeMode(attempts: number, safeMode: boolean): boolean {
	return !safeMode && attempts >= MAX_FAILED_STARTS;
}

/** The counter value to store at launch, after the user (if asked) chose how to proceed. */
export function nextAttempts(attempts: number, safeMode: boolean, choice: 'safe' | 'normal' | undefined): number {
	if (safeMode) {
		return attempts; // safe-mode launches never count
	}
	if (choice === 'safe') {
		return 0;
	}
	if (choice === 'normal') {
		return 1; // this start counts
	}
	return attempts + 1;
}

/** Missing, unreadable or malformed state is 0: recovery must never block startup. */
export async function readAttempts(file: string): Promise<number> {
	try {
		const value = JSON.parse(await promises.readFile(file, 'utf8'))?.startupAttempts;
		return Number.isInteger(value) && value >= 0 ? value : 0;
	} catch {
		return 0;
	}
}

export async function writeAttempts(file: string, attempts: number): Promise<void> {
	const tmp = `${file}.tmp`;
	await promises.writeFile(tmp, JSON.stringify({ startupAttempts: attempts }));
	await promises.rename(tmp, file);
}
```

- [ ] **Step 5: Run the tests**

Run: `node --test patches/test/`
Expected: 3 tests PASS (an `ExperimentalWarning` about type stripping may print; ignore it).

- [ ] **Step 6: Export the patch and commit**

Run the **Export command**, then:

```bash
git apply -R --check --ignore-whitespace patches/009-safe-mode.patch   # patch matches the tree
git add patches/009-safe-mode.patch patches/test/safeMode.test.mjs
git commit -m "feat(patch): safe mode pure modules and tests (#18)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

Expected: `--check` prints nothing and exits 0.

---

### Task 2: `--safe-mode` argument and extension gating

**Files (inside `vscode-src/`):**
- Modify: `src/vs/platform/environment/common/argv.ts:96`
- Modify: `src/vs/platform/environment/node/argv.ts:148`
- Modify: `src/vs/platform/environment/common/environment.ts:74`
- Modify: `src/vs/platform/environment/common/environmentService.ts:200`
- Modify: `src/vs/workbench/services/extensionManagement/browser/extensionEnablementService.ts:517-520`

**Interfaces:**
- Consumes: `isDisabledInSafeMode` from Task 1.
- Produces: `NativeParsedArgs['safe-mode']?: boolean`; `IEnvironmentService.isSafeMode?: boolean` (optional so the web and standalone environment services need no change).

- [ ] **Step 1: Declare the argument**

In `src/vs/platform/environment/common/argv.ts`, after the `'disable-extension'?: string[];` line add:

```ts
	'safe-mode'?: boolean;
```

In `src/vs/platform/environment/node/argv.ts`, after the `'disable-extension'` entry (line 149) add:

```ts
	'safe-mode': { type: 'boolean', cat: 't', description: localize('safeMode', "Start with all installed and built-in Null IDE extensions disabled. This option is not persisted and is effective only when the command opens a new window.") },
```

- [ ] **Step 2: Expose `isSafeMode`**

In `src/vs/platform/environment/common/environment.ts`, directly under `disableExtensions: boolean | string[];` add:

```ts
	isSafeMode?: boolean;
```

In `src/vs/platform/environment/common/environmentService.ts`, directly above `get disableExtensions()` add:

```ts
	get isSafeMode(): boolean { return !!this.args['safe-mode']; }

```

- [ ] **Step 3: Gate extensions**

In `extensionEnablementService.ts` add the import next to the other `platform/environment` imports:

```ts
import { isDisabledInSafeMode } from '../../../../platform/environment/common/safeMode.js';
```

and in `_isDisabledInEnv`, after the `allUserExtensionsDisabled` block (which ends at the `}` before `const disabledExtensions`), add:

```ts
		if (this.environmentService.isSafeMode && isDisabledInSafeMode(extension) && !isResolverExtension(extension.manifest, this.environmentService.remoteAuthority)) {
			return true;
		}

```

- [ ] **Step 4: Type-check**

Run: `cd vscode-src && npx tsc -p src/tsconfig.json --noEmit 2>&1 | head -20; cd ..`
Expected: no errors mentioning the files above. (If the full check is too slow or the tsconfig differs, run `npx tsc --noEmit -p src/tsconfig.json` once and filter with `grep -E "safeMode|argv|environment|extensionEnablement"`; pre-existing unrelated errors are not this task's concern.)

- [ ] **Step 5: Export and commit**

Run the **Export command** from Task 1, then:

```bash
git apply -R --check --ignore-whitespace patches/009-safe-mode.patch
git add patches/009-safe-mode.patch
git commit -m "feat(patch): --safe-mode disables user and Null built-in extensions (#18)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `reload({ safeMode })` plumbing

**Files (inside `vscode-src/`):**
- Modify: `src/vs/platform/native/common/native.ts:356`
- Modify: `src/vs/workbench/services/host/electron-browser/nativeHostService.ts:209`
- Modify: `src/vs/platform/native/electron-main/nativeHostMainService.ts:1088-1108`
- Modify: `src/vs/platform/windows/electron-main/windowImpl.ts` (`reload`, after the extension-development block)

**Interfaces:**
- Produces: `INativeHostService.reload(options?: { disableExtensions?: boolean; safeMode?: boolean })`. `safeMode: true` reloads the window in safe mode, `false` reloads it normally. The setting is sticky for that window and for windows opened afterwards by the same app instance until the opposite call or an app restart.

- [ ] **Step 1: Widen the option type**

In `native.ts` line 356 and `nativeHostService.ts` line 209 change `options?: { disableExtensions?: boolean }` to `options?: { disableExtensions?: boolean; safeMode?: boolean }`. (`IHostService` in `host.ts` is left alone: the commands use `INativeHostService`.)

- [ ] **Step 2: Main-process handling**

In `nativeHostMainService.ts`, in `reload`, replace the final `return this.lifecycleMainService.reload(...)` with:

```ts
			// Safe mode is sticky: remember it for windows opened later by this instance too
			if (options?.safeMode !== undefined) {
				this.environmentMainService.args['safe-mode'] = options.safeMode;
				return this.lifecycleMainService.reload(window, { _: [], 'safe-mode': options.safeMode });
			}

			return this.lifecycleMainService.reload(window, options?.disableExtensions !== undefined ? { _: [], 'disable-extensions': options.disableExtensions } : undefined);
```

and widen that method's signature the same way as Step 1 (`options?: { disableExtensions?: boolean; safeMode?: boolean }`).

- [ ] **Step 3: Carry it into the reloaded window's config**

In `windowImpl.ts` `reload(cli)`, immediately before `configuration.accessibilitySupport = ...`, add:

```ts
		// Safe mode is kept on the window config (unlike disable-extensions) so a later plain reload stays in the same mode
		if (cli?.['safe-mode'] !== undefined) {
			configuration['safe-mode'] = cli['safe-mode'];
		}

```

- [ ] **Step 4: Type-check**

Run: `cd vscode-src && npx tsc -p src/tsconfig.json --noEmit 2>&1 | grep -E "native|windowImpl" | head; cd ..`
Expected: no output.

- [ ] **Step 5: Export and commit**

Run the **Export command**, `git apply -R --check ...`, then commit `patches/009-safe-mode.patch` with message `feat(patch): reload(safeMode) plumbing (#18)` (plus the Co-Authored-By trailer).

---

### Task 4: Indicator, commands, title, dashboard guard

**Files (inside `vscode-src/`):**
- Create: `src/vs/workbench/contrib/safeMode/electron-browser/safeMode.contribution.ts`
- Modify: `src/vs/workbench/workbench.desktop.main.ts` (after the `contrib/issue/electron-browser/issue.contribution.js` import, line 134)
- Modify: `src/vs/workbench/browser/parts/titlebar/windowTitle.ts:361`
- Modify: `src/vs/workbench/contrib/welcomeGettingStarted/browser/startupPage.ts:209`

**Interfaces:**
- Consumes: `IWorkbenchEnvironmentService.isSafeMode`, `INativeHostService.reload({ safeMode })`.
- Produces: commands `workbench.action.restartInSafeMode` and `workbench.action.restartNormally`; context key `isSafeMode`.

- [ ] **Step 1: Write the contribution**

Create `safeMode.contribution.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { INotificationService, NotificationPriority, Severity } from '../../../../platform/notification/common/notification.js';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';

const IsSafeModeContext = new RawContextKey<boolean>('isSafeMode', false);
const RESTART_IN_SAFE_MODE = 'workbench.action.restartInSafeMode';
const RESTART_NORMALLY = 'workbench.action.restartNormally';

class SafeModeIndicator extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.safeModeIndicator';

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStatusbarService statusbarService: IStatusbarService,
		@INotificationService notificationService: INotificationService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@INativeHostService nativeHostService: INativeHostService
	) {
		super();

		const isSafeMode = !!environmentService.isSafeMode;
		IsSafeModeContext.bindTo(contextKeyService).set(isSafeMode);
		if (!isSafeMode) {
			return;
		}

		this._register(statusbarService.addEntry({
			name: localize('safeModeStatusName', "Safe Mode"),
			text: `$(shield) ${localize('safeModeStatus', "Safe Mode")}`,
			ariaLabel: localize('safeModeStatusAria', "Safe Mode: extensions are disabled. Click to restart normally."),
			tooltip: localize('safeModeStatusTooltip', "Extensions are disabled. Click to restart normally."),
			kind: 'warning',
			command: RESTART_NORMALLY
		}, 'status.safeMode', StatusbarAlignment.LEFT, 1000));

		lifecycleService.when(LifecyclePhase.Eventually).then(() => {
			notificationService.prompt(
				Severity.Warning,
				localize('safeModeNotice', "Safe Mode: all installed extensions and Null IDE's built-in extensions are disabled. Your extensions and settings are unchanged."),
				[{
					label: localize('restartNormally', "Restart Normally"),
					run: () => nativeHostService.reload({ safeMode: false })
				}],
				{ sticky: true, priority: NotificationPriority.URGENT }
			);
		});
	}
}

registerWorkbenchContribution2(SafeModeIndicator.ID, SafeModeIndicator, WorkbenchPhase.BlockRestore);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RESTART_IN_SAFE_MODE,
			title: localize2('restartInSafeMode', "Restart in Safe Mode"),
			category: localize2('safeModeCategory', "Null"),
			f1: true,
			precondition: IsSafeModeContext.negate(),
			menu: { id: MenuId.MenubarHelpMenu, group: '5_tools', order: 2, when: IsSafeModeContext.negate() }
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(INativeHostService).reload({ safeMode: true });
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: RESTART_NORMALLY,
			title: localize2('restartNormallyCommand', "Restart Normally"),
			category: localize2('safeModeCategory', "Null"),
			f1: true,
			precondition: IsSafeModeContext,
			menu: { id: MenuId.MenubarHelpMenu, group: '5_tools', order: 2, when: IsSafeModeContext }
		});
	}
	run(accessor: ServicesAccessor): Promise<void> {
		return accessor.get(INativeHostService).reload({ safeMode: false });
	}
});
```

- [ ] **Step 2: Register it**

In `workbench.desktop.main.ts` after line 134 add:

```ts
import './contrib/safeMode/electron-browser/safeMode.contribution.js';
```

- [ ] **Step 3: Title suffix**

In `windowTitle.ts` line 361 change

```ts
		const appName = this.productService.nameLong;
```

to

```ts
		const appName = this.productService.nameLong + (this.environmentService.isSafeMode ? localize('safeModeTitle', " [Safe Mode]") : '');
```

- [ ] **Step 4: Dashboard guard**

In `startupPage.ts` line 209 change

```ts
				resource: URI.from({ scheme: 'null-dashboard', path: '/Dashboard' }),
```

to

```ts
				// null-dashboard is served by null-tools, which is disabled in safe mode
				resource: this.environmentService.isSafeMode ? GettingStartedInput.RESOURCE : URI.from({ scheme: 'null-dashboard', path: '/Dashboard' }),
```

- [ ] **Step 5: Type-check**

Run: `cd vscode-src && npx tsc -p src/tsconfig.json --noEmit 2>&1 | grep -E "safeMode|windowTitle|startupPage" | head; cd ..`
Expected: no output. If an import path is wrong (for example `ILifecycleService` or `IStatusbarService`), `tsc` names it; fix the path rather than the call.

- [ ] **Step 6: Export and commit**

Run the **Export command** (it now also picks up the contribution file), `git apply -R --check --ignore-whitespace patches/009-safe-mode.patch`, then commit `patches/009-safe-mode.patch` with message `feat(patch): safe mode indicator, commands and dashboard guard (#18)` (plus the trailer).

---

### Task 5: Startup-failure dialog and counter

**Files (inside `vscode-src/`):**
- Modify: `src/vs/code/electron-main/main.ts` (imports; the `onWillShutdown` handler at line ~146; before the final `return instantiationService.createInstance(CodeApplication, ...)` at line ~160)

**Interfaces:**
- Consumes: `MAX_FAILED_STARTS`, `HEALTHY_UPTIME_MS`, `shouldOfferSafeMode`, `nextAttempts`, `readAttempts`, `writeAttempts` from Task 1; `massageMessageBoxOptions(...)` returns `{ options, buttonIndeces }`.

- [ ] **Step 1: Import**

In `main.ts` add near the other local imports:

```ts
import { HEALTHY_UPTIME_MS, MAX_FAILED_STARTS, nextAttempts, readAttempts, shouldOfferSafeMode, writeAttempts } from './safeModeState.js';
```

(`app`, `dialog`, `join`, `localize` and `massageMessageBoxOptions` are already imported in this file.)

- [ ] **Step 2: Clean quit resets the counter**

Inside the existing `Event.once(lifecycleMainService.onWillShutdown)(evt => { ... })` handler, after the `instanceLockfile` join, add:

```ts
					evt.join('safeModeState', writeAttempts(safeModeStateFile, 0).catch(() => { /* ignored */ }));
```

and declare the path above that handler (right after the `bufferLogger.logger = ...` line, so it is in scope for both):

```ts
				const safeModeStateFile = join(environmentMainService.userDataPath, 'safe-mode-state.json');
```

- [ ] **Step 3: Offer safe mode and count this start**

Immediately before `return instantiationService.createInstance(CodeApplication, mainProcessNodeIpcServer, instanceEnvironment).startup();` add:

```ts
				// Safe mode: offer it after repeated failed starts, and count this start
				const safeMode = !!environmentMainService.args['safe-mode'];
				const attempts = await readAttempts(safeModeStateFile);
				let choice: 'safe' | 'normal' | undefined;
				if (shouldOfferSafeMode(attempts, safeMode)) {
					await app.whenReady();
					const dialogOptions = massageMessageBoxOptions({
						type: 'warning',
						buttons: [
							localize({ key: 'startSafeMode', comment: ['&& denotes a mnemonic'] }, "Start in &&Safe Mode"),
							localize({ key: 'startNormally', comment: ['&& denotes a mnemonic'] }, "Start &&Normally")
						],
						defaultId: 0,
						cancelId: 1,
						message: localize('startupFailed', "{0} has not started successfully {1} times.", productService.nameShort, MAX_FAILED_STARTS),
						detail: localize('startupFailedDetail', "Safe Mode starts without extensions so you can find out whether one of them is the cause. Your extensions and settings are not changed.")
					}, productService);
					const { response } = await dialog.showMessageBox(dialogOptions.options);
					choice = dialogOptions.buttonIndeces[response] === 0 ? 'safe' : 'normal';
					if (choice === 'safe') {
						environmentMainService.args['safe-mode'] = true;
					}
				}
				await writeAttempts(safeModeStateFile, nextAttempts(attempts, safeMode, choice)).catch(() => { /* never block startup */ });

				// A run that stays up long enough was a healthy start
				setTimeout(() => writeAttempts(safeModeStateFile, 0).catch(() => { /* ignored */ }), HEALTHY_UPTIME_MS).unref();

```

- [ ] **Step 4: Type-check**

Run: `cd vscode-src && npx tsc -p src/tsconfig.json --noEmit 2>&1 | grep -E "main.ts|safeModeState" | head; cd ..`
Expected: no output.

- [ ] **Step 5: Re-run the unit tests, export and commit**

```bash
node --test patches/test/
```

Run the **Export command**, `git apply -R --check --ignore-whitespace patches/009-safe-mode.patch`, then commit `patches/009-safe-mode.patch` with message `feat(patch): offer safe mode after repeated failed starts (#18)` (plus the trailer).

---

### Task 6: Start Menu shortcut, docs, final check

**Files:**
- Modify: `scripts/install-null-ide.ps1` (lines 219-237 `New-Shortcut`; lines 826-830 Start Menu block)
- Modify: `README.md` (Usage block, line ~91)
- Modify: `CLAUDE.md` (Patches list, after `008-...`; install script bullets)

**Interfaces:**
- Consumes: the `--safe-mode` argument from Task 2.

- [ ] **Step 1: Add an `Arguments` parameter to `New-Shortcut`**

Read lines 219-237 first. Add `[string]$Arguments = ""` to the function's `param(...)` and, after `$shortcut.WorkingDirectory = $WorkingDirectory`, add:

```powershell
    if ($Arguments) { $shortcut.Arguments = $Arguments }
```

- [ ] **Step 2: Create the shortcut**

Inside the existing `if (-not $NoStartMenuShortcut) { ... }` block, after the `Null IDE.lnk` call, add:

```powershell
            New-Shortcut -ShortcutPath (Join-Path ([Environment]::GetFolderPath("Programs")) "Null IDE\Null IDE (Safe Mode).lnk") `
                         -TargetPath $target -WorkingDirectory $destinationFullPath -Arguments "--safe-mode"
```

- [ ] **Step 3: Verify the shortcut function**

Dot-sourcing the whole script would install, so extract and run just the function:

```powershell
$src = Get-Content scripts/install-null-ide.ps1 -Raw
$fn = [regex]::Match($src, '(?s)function New-Shortcut \{.*?\n\}\n').Value
Invoke-Expression $fn
$p = Join-Path $env:TEMP 'safe-mode-test.lnk'
New-Shortcut -ShortcutPath $p -TargetPath "$env:WINDIR\notepad.exe" -WorkingDirectory $env:TEMP -Arguments "--safe-mode"
(New-Object -ComObject WScript.Shell).CreateShortcut($p).Arguments
Remove-Item $p
```

Expected output: `--safe-mode`.

- [ ] **Step 4: Docs**

In `README.md`'s Usage block add:

```
null --safe-mode            # start with all extensions disabled (also: Start Menu > Null IDE (Safe Mode))
```

and a sentence after the paragraph below it: "Safe Mode disables installed extensions and Null IDE's built-in extensions without changing them; use **Restart Normally** (status bar, notification or Help menu) to come back. Null IDE also offers Safe Mode on its own after three failed starts in a row."

In `CLAUDE.md`, add to the Patches list after the 008 line:

```
- `009-safe-mode.patch` — `--safe-mode`: the enablement check disables user extensions and Null-owned built-ins (`isDisabledInSafeMode`); core status bar item, `[Safe Mode]` title suffix and Restart in Safe Mode / Restart Normally commands; `reload({ safeMode })`; main-process failed-start counter (`safe-mode-state.json`, offers safe mode after 3 failed starts). Pure parts have `node --test patches/test/`. Design `docs/specs/safe-mode-design.md`
```

and in the `install-null-ide.ps1` bullets add: "Creates a Start Menu shortcut `Null IDE (Safe Mode)` (`--safe-mode`)".

- [ ] **Step 5: Final verification**

```bash
node --test patches/test/
git apply -R --check --ignore-whitespace patches/009-safe-mode.patch
git diff --stat
```

Expected: 3 tests pass; `--check` silent; the diff stat lists only the three files in this task.

- [ ] **Step 6: Commit**

```bash
git add scripts/install-null-ide.ps1 README.md CLAUDE.md
git commit -m "feat: Start Menu safe mode shortcut and docs (#18)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Hand off the real-build check**

The behaviour of a core patch can only be proven in a real build, and `/verify-local` cannot reach it. Tell the user the checklist and ask before running `scripts/build-local.ps1` (tens of minutes) or pushing to CI:

1. `null --safe-mode .` → status bar shows Safe Mode; title ends `[Safe Mode]`; the Extensions view shows null-tools disabled; the Getting Started page opens instead of the dashboard.
2. Click **Restart Normally**, then run **Reload Window** → extensions are back and stay on.
3. Run **Null: Restart in Safe Mode**, then **Reload Window** → stays in safe mode.
4. With a normal window open, run the Start Menu "Null IDE (Safe Mode)" shortcut → only the new window is in safe mode.
5. Set `{"startupAttempts":3}` in `%APPDATA%\Null\safe-mode-state.json` and launch → the dialog appears; "Start in Safe Mode" opens safe mode and does not prompt on the next launch; "Start Normally" leaves the counter at 1.
6. Quit cleanly → the file contains `{"startupAttempts":0}`.
