'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const jobLog_1 = require("./jobLog");
const realLog_fixture_1 = require("./realLog.fixture");
const ts = '2026-10-01T10:00:00.1234567Z ';
const step = (number, name, conclusion = 'success', status = 'completed') => ({ number, name, status, conclusion, startedAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:00:02Z' });
const job = (steps, over = {}) => ({
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
(0, node_test_1.default)('cleanLog strips timestamps, turns groups into headings and drops endgroup', () => {
    const lines = (0, jobLog_1.cleanLog)(LOG);
    node_assert_1.default.strictEqual(lines[0], "Current runner version: '2.300.0'");
    node_assert_1.default.strictEqual(lines[1], '▶ Operating System');
    node_assert_1.default.ok(!lines.some(l => l.includes('##[endgroup]') || /^\d{4}-/.test(l)));
    node_assert_1.default.ok(lines.includes('##[error]Process completed with exit code 2.'), '##[error] lines are kept');
});
(0, node_test_1.default)('cleanLog tolerates no timestamps, CRLF, a BOM and trailing blank lines', () => {
    node_assert_1.default.deepStrictEqual((0, jobLog_1.cleanLog)('a\r\nb\r\n\r\n'), ['a', 'b']);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.cleanLog)('﻿2026-10-01T10:00:00Zx\nplain'), ['x', 'plain']);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.cleanLog)(''), []);
});
(0, node_test_1.default)('cleanLog strips ANSI colour escapes', () => {
    node_assert_1.default.deepStrictEqual((0, jobLog_1.cleanLog)(`${ts}\u001b[36;1mecho hi\u001b[0m`), ['echo hi']);
});
(0, node_test_1.default)('segmentLog splits at step markers; the first segment is the set-up step', () => {
    const lines = (0, jobLog_1.cleanLog)(LOG);
    const segs = (0, jobLog_1.segmentLog)(lines);
    node_assert_1.default.strictEqual(segs.length, 5);
    node_assert_1.default.deepStrictEqual(segs[0], { start: 0, end: 3 });
    node_assert_1.default.strictEqual(lines[segs[1].start], '▶ Run echo hi');
    node_assert_1.default.strictEqual(segs[4].end, lines.length);
});
(0, node_test_1.default)('locateStep: exact when segments and logged steps line up, a skipped step writes nothing', () => {
    const lines = (0, jobLog_1.cleanLog)(LOG);
    const steps = [step(1, 'Set up job'), step(2, 'a'), step(3, 'skipped one', 'skipped'), step(4, 'b', 'failure'), step(5, 'Post x'), step(6, 'Complete job')];
    const a = (0, jobLog_1.locateStep)(lines, steps, 2);
    node_assert_1.default.strictEqual(a.exact, true);
    node_assert_1.default.strictEqual(lines[a.start], '▶ Run echo hi');
    const b = (0, jobLog_1.locateStep)(lines, steps, 4);
    node_assert_1.default.strictEqual(lines[b.start], '▶ Run make');
    node_assert_1.default.ok(lines.slice(b.start, b.end).includes('##[error]Process completed with exit code 2.'));
});
(0, node_test_1.default)('locateStep: a running job\'s not-yet-started steps do not break the match', () => {
    const lines = (0, jobLog_1.cleanLog)(LOG.split('\n').slice(0, 8).join('\n'));
    const steps = [step(1, 'Set up job'), step(2, 'a', null, 'in_progress'), step(3, 'b', null, 'queued'), step(4, 'Complete job', null, 'queued')];
    const at = (0, jobLog_1.locateStep)(lines, steps, 2);
    node_assert_1.default.strictEqual(at.exact, true);
    node_assert_1.default.strictEqual(lines[at.start], '▶ Run echo hi');
});
(0, node_test_1.default)('locateStep: a mismatch or a bad step number falls back to the full log at the nearest heading, never throws', () => {
    const lines = (0, jobLog_1.cleanLog)(LOG);
    const fewer = (0, jobLog_1.locateStep)(lines, [step(1, 'x'), step(2, 'y')], 2);
    node_assert_1.default.strictEqual(fewer.exact, false);
    node_assert_1.default.strictEqual(fewer.end, lines.length);
    const missing = (0, jobLog_1.locateStep)(lines, [step(1, 'x')], 99);
    node_assert_1.default.strictEqual(missing.exact, false);
    node_assert_1.default.strictEqual(missing.start, 0);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.locateStep)([], [step(1, 'x')], 1), { start: 0, end: 0, exact: true });
});
(0, node_test_1.default)('real captured logs: one segment per step that wrote a log, and every such step resolves exactly (Task 1)', () => {
    for (const [name, log, steps] of [['failing run', realLog_fixture_1.REAL_LOG, realLog_fixture_1.REAL_STEPS], ['run with a skipped step', realLog_fixture_1.SKIPPED_LOG, realLog_fixture_1.SKIPPED_STEPS]]) {
        const lines = (0, jobLog_1.cleanLog)(log);
        node_assert_1.default.ok(lines.length > 0, name);
        node_assert_1.default.ok(!lines.some(l => /^\d{4}-\d\d-\d\dT/.test(l)), `${name}: every timestamp was stripped`);
        const full = steps.map(s => ({ ...s, startedAt: null, completedAt: null }));
        const logged = full.filter(s => s.conclusion !== 'skipped');
        node_assert_1.default.strictEqual((0, jobLog_1.segmentLog)(lines).length, logged.length, `${name}: one segment per step that wrote a log`);
        for (const s of logged)
            node_assert_1.default.ok((0, jobLog_1.locateStep)(lines, full, s.number).exact, `${name}: step ${s.number} (${s.name}) resolves exactly`);
    }
    node_assert_1.default.ok(realLog_fixture_1.SKIPPED_STEPS.some(s => s.conclusion === 'skipped'), 'the skipped-step capture really has a skipped step');
    node_assert_1.default.ok((0, jobLog_1.cleanLog)(realLog_fixture_1.REAL_LOG).some(l => l.startsWith('##[error]')), 'the failing capture keeps its ##[error] lines');
});
(0, node_test_1.default)('pathRefs: path:line:col and path(line,col), nothing from urls or windows paths', () => {
    node_assert_1.default.deepStrictEqual((0, jobLog_1.pathRefs)('##[error]src/a.ts(3,4): error TS2304'), [{ path: 'src/a.ts', line: 3, col: 4, start: 9, end: 22 }]);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.pathRefs)('src/b.c:10:5: error: x').map(r => [r.path, r.line, r.col]), [['src/b.c', 10, 5]]);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.pathRefs)('lib/c.py:7 failed').map(r => [r.path, r.line, r.col]), [['lib/c.py', 7, null]]);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.pathRefs)('see https://example.com/a.js:3 for more'), []);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.pathRefs)(['D:', 'a', 'r', 'r', 'src', 'x.ts:3'].join(String.fromCharCode(92))), []);
    node_assert_1.default.deepStrictEqual((0, jobLog_1.pathRefs)('plain text, nothing here 12:30'), []);
});
(0, node_test_1.default)('repoRelative refuses anything that could leave the repo', () => {
    node_assert_1.default.strictEqual((0, jobLog_1.repoRelative)('src/a.ts'), 'src/a.ts');
    node_assert_1.default.strictEqual((0, jobLog_1.repoRelative)('./src/a.ts'), 'src/a.ts');
    node_assert_1.default.strictEqual((0, jobLog_1.repoRelative)('/home/runner/work/repo/repo/src/a.ts'), 'src/a.ts');
    for (const bad of ['../etc/passwd', 'a/../../b', '/etc/passwd', '', 'a//b', '/home/runner/work/repo/repo/../x'])
        node_assert_1.default.strictEqual((0, jobLog_1.repoRelative)(bad), null, bad);
});
(0, node_test_1.default)('renderJobDoc: a finished job shows the cleaned log, or the step segment', () => {
    const steps = [step(1, 'Set up job'), step(2, 'a'), step(3, 'b', 'failure'), step(4, 'Post x'), step(5, 'Complete job')];
    const whole = (0, jobLog_1.renderJobDoc)({ job: job(steps), log: LOG, truncated: false, step: null, gone: false, now: 0 });
    node_assert_1.default.ok(whole.includes('▶ Run make') && whole.includes('hi'));
    const one = (0, jobLog_1.renderJobDoc)({ job: job(steps), log: LOG, truncated: false, step: 3, gone: false, now: 0 });
    node_assert_1.default.ok(one.startsWith('▶ Run make') && !one.includes('echo hi'));
});
(0, node_test_1.default)('renderJobDoc: truncation notice is line 1; no log says why', () => {
    const t = (0, jobLog_1.renderJobDoc)({ job: job([]), log: 'x\ny', truncated: true, step: null, gone: false, now: 0 });
    node_assert_1.default.strictEqual(t.split('\n')[0], jobLog_1.TRUNCATED_NOTICE);
    node_assert_1.default.ok((0, jobLog_1.renderJobDoc)({ job: job([]), log: null, truncated: false, step: null, gone: true, now: 0 }).includes(jobLog_1.GONE_NOTICE));
    node_assert_1.default.ok((0, jobLog_1.renderJobDoc)({ job: job([]), log: '', truncated: false, step: null, gone: false, now: 0 }).length > 0, 'an empty finished log is not an empty document');
});
(0, node_test_1.default)('renderJobDoc: a running job shows its steps and waits for the log', () => {
    const running = job([step(1, 'Set up job'), step(2, 'Slow', null, 'in_progress'), step(3, 'Later', null, 'queued')], { status: 'in_progress', conclusion: null, completedAt: null });
    const none = (0, jobLog_1.renderJobDoc)({ job: running, log: null, truncated: false, step: null, gone: false, now: Date.parse('2026-10-01T10:00:10Z') });
    node_assert_1.default.ok(none.includes('build') && none.includes('Slow') && none.includes(jobLog_1.NOT_YET_NOTICE));
    const some = (0, jobLog_1.renderJobDoc)({ job: running, log: `${ts}tick 1`, truncated: false, step: null, gone: false, now: 0 });
    node_assert_1.default.ok(some.includes('tick 1') && !some.includes(jobLog_1.NOT_YET_NOTICE));
    const gone404 = (0, jobLog_1.renderJobDoc)({ job: running, log: null, truncated: false, step: null, gone: true, now: 0 });
    node_assert_1.default.ok(gone404.includes(jobLog_1.NOT_YET_NOTICE) && !gone404.includes(jobLog_1.GONE_NOTICE), 'a 404 on a running job is "not yet", never "no longer available"');
});
(0, node_test_1.default)('firstFailedStep', () => {
    node_assert_1.default.strictEqual((0, jobLog_1.firstFailedStep)(job([step(1, 'a'), step(2, 'b', 'failure'), step(3, 'c', 'failure')]))?.number, 2);
    node_assert_1.default.strictEqual((0, jobLog_1.firstFailedStep)(job([step(1, 'a')])), undefined);
});
//# sourceMappingURL=jobLog.test.js.map