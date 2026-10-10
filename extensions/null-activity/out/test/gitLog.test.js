'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const gitLog_1 = require("../gitLog");
const stats_1 = require("../stats");
const EMAIL = 'me@example.com';
const range = { from: Date.parse('2026-10-05T00:00:00Z'), to: Date.parse('2026-10-12T00:00:00Z') };
const sec = (iso) => Date.parse(iso) / 1000;
/** What `--format=@%ct%x09%ae` prints for one commit: header, blank line, numstat lines. */
const commit = (iso, email, ...stats) => `@${sec(iso)}\t${email}\n\n${stats.join('\n')}\n`;
const ZERO = { commits: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
(0, node_test_1.test)('sums commits and lines; a file touched twice counts once', () => {
    const out = commit('2026-10-06T10:00:00Z', EMAIL, '3\t1\ta.ts', '2\t0\tb.ts') + commit('2026-10-07T10:00:00Z', EMAIL, '5\t2\ta.ts');
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)(out, EMAIL, range), { commits: 2, filesChanged: 2, linesAdded: 10, linesRemoved: 3 });
});
(0, node_test_1.test)('author match is exact and case-insensitive; other authors contribute nothing', () => {
    const out = commit('2026-10-06T10:00:00Z', 'ME@Example.com', '1\t0\ta.ts') +
        commit('2026-10-06T11:00:00Z', 'xme@example.com', '100\t100\tb.ts') +
        commit('2026-10-06T12:00:00Z', 'me@example.com.au', '100\t100\tc.ts');
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)(out, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});
(0, node_test_1.test)('range is half-open: a commit at `from` counts, one at `to` does not', () => {
    const out = commit('2026-10-05T00:00:00Z', EMAIL, '1\t0\ta.ts') + commit('2026-10-12T00:00:00Z', EMAIL, '1\t0\tb.ts') + commit('2026-10-04T23:59:59Z', EMAIL, '1\t0\tc.ts');
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)(out, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});
(0, node_test_1.test)('binary files count as a changed file but add no lines', () => {
    const out = commit('2026-10-06T10:00:00Z', EMAIL, '-\t-\tlogo.png', '4\t1\ta.ts');
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)(out, EMAIL, range), { commits: 1, filesChanged: 2, linesAdded: 4, linesRemoved: 1 });
});
(0, node_test_1.test)('paths with spaces and CRLF line endings', () => {
    const out = commit('2026-10-06T10:00:00Z', EMAIL, '2\t0\tmy docs/read me.md', '1\t1\tunicodé/ü.ts').replace(/\n/g, '\r\n');
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)(out, EMAIL, range), { commits: 1, filesChanged: 2, linesAdded: 3, linesRemoved: 1 });
});
(0, node_test_1.test)('empty output, garbage and torn lines give zeros and never throw', () => {
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)('', EMAIL, range), ZERO);
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)('warning: something\nnot a header\n', EMAIL, range), ZERO);
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)('@nonsense\tme@example.com\n1\t0\ta.ts\n', EMAIL, range), ZERO);
    const torn = commit('2026-10-06T10:00:00Z', EMAIL, '1\t0\ta.ts') + '@1790';
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseGitLog)(torn, EMAIL, range), { commits: 1, filesChanged: 1, linesAdded: 1, linesRemoved: 0 });
});
(0, node_test_1.test)('gitLogArgs: bounded range adds --since/--until in seconds, ALL_TIME adds neither', () => {
    const bounded = (0, gitLog_1.gitLogArgs)(range, EMAIL);
    node_assert_1.default.ok(bounded.includes(`--since=${sec('2026-10-05T00:00:00Z')}`));
    node_assert_1.default.ok(bounded.includes(`--until=${sec('2026-10-12T00:00:00Z')}`));
    for (const flag of ['--branches', '--no-merges', '--no-renames', '--numstat', '-F', `--author=${EMAIL}`])
        node_assert_1.default.ok(bounded.includes(flag), flag);
    const all = (0, gitLog_1.gitLogArgs)(stats_1.ALL_TIME, EMAIL);
    node_assert_1.default.ok(!all.some((a) => a.startsWith('--since') || a.startsWith('--until')));
});
//# sourceMappingURL=gitLog.test.js.map