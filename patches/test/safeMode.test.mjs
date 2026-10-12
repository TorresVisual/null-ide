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
