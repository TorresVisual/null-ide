'use strict';

import assert from 'node:assert';
import test from 'node:test';
import {
  GONE_NOTICE, NOT_YET_NOTICE, TRUNCATED_NOTICE, cleanLog, firstFailedStep, locateStep, pathRefs, renderJobDoc, repoRelative, segmentLog,
} from './jobLog';
import { WorkflowJob, WorkflowStep } from './workflowsModel';
import { REAL_LOG, REAL_STEPS, SKIPPED_LOG, SKIPPED_STEPS } from './realLog.fixture';

const ts = '2026-10-01T10:00:00.1234567Z ';
const step = (number: number, name: string, conclusion: string | null = 'success', status = 'completed'): WorkflowStep =>
  ({ number, name, status, conclusion, startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:00:02Z' });
const job = (steps: WorkflowStep[], over: Partial<WorkflowJob> = {}): WorkflowJob => ({
  id: 5, name: 'build', status: 'completed', conclusion: 'success', startedAt: '2026-10-01T10:00:00Z',
  completedAt: '2026-10-01T10:00:30Z', url: 'https://github.com/o/r/actions/runs/1/job/5', steps, ...over,
});

const LOG = [
  `${ts}Current runner version: '2.300.0'`,
  `${ts}##[group]Operating System`,
  `${ts}Ubuntu`,
  `${ts}##[endgroup]`,
  `${ts}##[group]Run echo hi`,
  `${ts}echo hi`,
  `${ts}##[endgroup]`,
  `${ts}hi`,
  `${ts}##[group]Run make`,
  `${ts}make`,
  `${ts}##[endgroup]`,
  `${ts}##[error]Process completed with exit code 2.`,
  `${ts}Post job cleanup.`,
  `${ts}Cleaning up orphan processes`,
].join('\n');

test('cleanLog strips timestamps, turns groups into headings and drops endgroup', () => {
  const lines = cleanLog(LOG);
  assert.strictEqual(lines[0], "Current runner version: '2.300.0'");
  assert.strictEqual(lines[1], '▶ Operating System');
  assert.ok(!lines.some(l => l.includes('##[endgroup]') || /^\d{4}-/.test(l)));
  assert.ok(lines.includes('##[error]Process completed with exit code 2.'), '##[error] lines are kept');
});

test('cleanLog tolerates no timestamps, CRLF, a BOM and trailing blank lines', () => {
  assert.deepStrictEqual(cleanLog('a\r\nb\r\n\r\n'), ['a', 'b']);
  assert.deepStrictEqual(cleanLog('﻿2026-10-01T10:00:00Zx\nplain'), ['x', 'plain']);
  assert.deepStrictEqual(cleanLog(''), []);
});

test('cleanLog strips ANSI colour escapes', () => {
  assert.deepStrictEqual(cleanLog(`${ts}\u001b[36;1mecho hi\u001b[0m`), ['echo hi']);
});

test('segmentLog splits at step markers; the first segment is the set-up step', () => {
  const lines = cleanLog(LOG);
  const segs = segmentLog(lines);
  assert.strictEqual(segs.length, 5);
  assert.deepStrictEqual(segs[0], { start: 0, end: 3 });
  assert.strictEqual(lines[segs[1].start], '▶ Run echo hi');
  assert.strictEqual(segs[4].end, lines.length);
});

test('locateStep: exact when segments and logged steps line up, a skipped step writes nothing', () => {
  const lines = cleanLog(LOG);
  const steps = [step(1, 'Set up job'), step(2, 'a'), step(3, 'skipped one', 'skipped'), step(4, 'b', 'failure'), step(5, 'Post x'), step(6, 'Complete job')];
  const a = locateStep(lines, steps, 2);
  assert.strictEqual(a.exact, true);
  assert.strictEqual(lines[a.start], '▶ Run echo hi');
  const b = locateStep(lines, steps, 4);
  assert.strictEqual(lines[b.start], '▶ Run make');
  assert.ok(lines.slice(b.start, b.end).includes('##[error]Process completed with exit code 2.'));
});

test('locateStep: a running job\'s not-yet-started steps do not break the match', () => {
  const lines = cleanLog(LOG.split('\n').slice(0, 8).join('\n'));
  const steps = [step(1, 'Set up job'), step(2, 'a', null, 'in_progress'), step(3, 'b', null, 'queued'), step(4, 'Complete job', null, 'queued')];
  const at = locateStep(lines, steps, 2);
  assert.strictEqual(at.exact, true);
  assert.strictEqual(lines[at.start], '▶ Run echo hi');
});

test('locateStep: a mismatch or a bad step number falls back to the full log at the nearest heading, never throws', () => {
  const lines = cleanLog(LOG);
  const fewer = locateStep(lines, [step(1, 'x'), step(2, 'y')], 2);
  assert.strictEqual(fewer.exact, false);
  assert.strictEqual(fewer.end, lines.length);
  const missing = locateStep(lines, [step(1, 'x')], 99);
  assert.strictEqual(missing.exact, false);
  assert.strictEqual(missing.start, 0);
  assert.deepStrictEqual(locateStep([], [step(1, 'x')], 1), { start: 0, end: 0, exact: true });
});

test('real captured logs: one segment per step that wrote a log, and every such step resolves exactly (Task 1)', () => {
  for (const [name, log, steps] of [['failing run', REAL_LOG, REAL_STEPS], ['run with a skipped step', SKIPPED_LOG, SKIPPED_STEPS]] as const) {
    const lines = cleanLog(log);
    assert.ok(lines.length > 0, name);
    assert.ok(!lines.some(l => /^\d{4}-\d\d-\d\dT/.test(l)), `${name}: every timestamp was stripped`);
    const full: WorkflowStep[] = steps.map(s => ({ ...s, startedAt: null, completedAt: null }));
    const logged = full.filter(s => s.conclusion !== 'skipped');
    assert.strictEqual(segmentLog(lines).length, logged.length, `${name}: one segment per step that wrote a log`);
    for (const s of logged) assert.ok(locateStep(lines, full, s.number).exact, `${name}: step ${s.number} (${s.name}) resolves exactly`);
  }
  assert.ok(SKIPPED_STEPS.some(s => s.conclusion === 'skipped'), 'the skipped-step capture really has a skipped step');
  assert.ok(cleanLog(REAL_LOG).some(l => l.startsWith('##[error]')), 'the failing capture keeps its ##[error] lines');
});

test('pathRefs: path:line:col and path(line,col), nothing from urls or windows paths', () => {
  assert.deepStrictEqual(pathRefs('##[error]src/a.ts(3,4): error TS2304'), [{ path: 'src/a.ts', line: 3, col: 4, start: 9, end: 22 }]);
  assert.deepStrictEqual(pathRefs('src/b.c:10:5: error: x').map(r => [r.path, r.line, r.col]), [['src/b.c', 10, 5]]);
  assert.deepStrictEqual(pathRefs('lib/c.py:7 failed').map(r => [r.path, r.line, r.col]), [['lib/c.py', 7, null]]);
  assert.deepStrictEqual(pathRefs('see https://example.com/a.js:3 for more'), []);
  assert.deepStrictEqual(pathRefs(['D:', 'a', 'r', 'r', 'src', 'x.ts:3'].join(String.fromCharCode(92))), []);
  assert.deepStrictEqual(pathRefs('plain text, nothing here 12:30'), []);
});

test('repoRelative refuses anything that could leave the repo', () => {
  assert.strictEqual(repoRelative('src/a.ts'), 'src/a.ts');
  assert.strictEqual(repoRelative('./src/a.ts'), 'src/a.ts');
  assert.strictEqual(repoRelative('/home/runner/work/repo/repo/src/a.ts'), 'src/a.ts');
  for (const bad of ['../etc/passwd', 'a/../../b', '/etc/passwd', '', 'a//b', '/home/runner/work/repo/repo/../x']) assert.strictEqual(repoRelative(bad), null, bad);
});

test('renderJobDoc: a finished job shows the cleaned log, or the step segment', () => {
  const steps = [step(1, 'Set up job'), step(2, 'a'), step(3, 'b', 'failure'), step(4, 'Post x'), step(5, 'Complete job')];
  const whole = renderJobDoc({ job: job(steps), log: LOG, truncated: false, step: null, gone: false, now: 0 });
  assert.ok(whole.includes('▶ Run make') && whole.includes('hi'));
  const one = renderJobDoc({ job: job(steps), log: LOG, truncated: false, step: 3, gone: false, now: 0 });
  assert.ok(one.startsWith('▶ Run make') && !one.includes('echo hi'));
});

test('renderJobDoc: truncation notice is line 1; no log says why', () => {
  const t = renderJobDoc({ job: job([]), log: 'x\ny', truncated: true, step: null, gone: false, now: 0 });
  assert.strictEqual(t.split('\n')[0], TRUNCATED_NOTICE);
  assert.ok(renderJobDoc({ job: job([]), log: null, truncated: false, step: null, gone: true, now: 0 }).includes(GONE_NOTICE));
  assert.ok(renderJobDoc({ job: job([]), log: '', truncated: false, step: null, gone: false, now: 0 }).length > 0, 'an empty finished log is not an empty document');
});

test('renderJobDoc: a running job shows its steps and waits for the log', () => {
  const running = job([step(1, 'Set up job'), step(2, 'Slow', null, 'in_progress'), step(3, 'Later', null, 'queued')], { status: 'in_progress', conclusion: null, completedAt: null });
  const none = renderJobDoc({ job: running, log: null, truncated: false, step: null, gone: false, now: Date.parse('2026-10-01T10:00:10Z') });
  assert.ok(none.includes('build') && none.includes('Slow') && none.includes(NOT_YET_NOTICE));
  const some = renderJobDoc({ job: running, log: `${ts}tick 1`, truncated: false, step: null, gone: false, now: 0 });
  assert.ok(some.includes('tick 1') && !some.includes(NOT_YET_NOTICE));
  const gone404 = renderJobDoc({ job: running, log: null, truncated: false, step: null, gone: true, now: 0 });
  assert.ok(gone404.includes(NOT_YET_NOTICE) && !gone404.includes(GONE_NOTICE), 'a 404 on a running job is "not yet", never "no longer available"');
});

test('firstFailedStep', () => {
  assert.strictEqual(firstFailedStep(job([step(1, 'a'), step(2, 'b', 'failure'), step(3, 'c', 'failure')]))?.number, 2);
  assert.strictEqual(firstFailedStep(job([step(1, 'a')])), undefined);
});
