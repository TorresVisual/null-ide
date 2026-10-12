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
