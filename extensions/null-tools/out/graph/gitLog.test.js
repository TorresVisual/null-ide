'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const gitLog_1 = require("./gitLog");
const sha = (c) => c.repeat(40);
const record = (fields) => fields.join('\x1f');
(0, node_test_1.default)('parseLog: a merge, a commit with awkward characters, and a root commit', () => {
    const out = [
        record([sha('a'), `${sha('b')} ${sha('c')}`, 'Ann', 'ann@x.io', '1700000000',
            'HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD', 'Merge x']),
        record([sha('b'), sha('d'), 'Bob', 'bob@x.io', '1699999999', '', 'Fix "quotes" and \'ticks\' — ünïcode ✓']),
        record([sha('d'), '', 'Cy', 'cy@x.io', '1', '', 'root']),
    ].join('\0') + '\0';
    const commits = (0, gitLog_1.parseLog)(out);
    node_assert_1.default.strictEqual(commits.length, 3);
    node_assert_1.default.deepStrictEqual(commits[0].parents, [sha('b'), sha('c')]);
    node_assert_1.default.deepStrictEqual(commits[0].refs, [
        { name: 'main', kind: 'branch', current: true },
        { name: 'v1', kind: 'tag' },
        { name: 'origin/main', kind: 'remote' },
    ]);
    node_assert_1.default.strictEqual(commits[1].subject, 'Fix "quotes" and \'ticks\' — ünïcode ✓');
    node_assert_1.default.strictEqual(commits[1].author, 'Bob');
    node_assert_1.default.deepStrictEqual(commits[2].parents, []);
    node_assert_1.default.strictEqual(commits[2].time, 1);
});
(0, node_test_1.default)('parseLog ignores empty and malformed records', () => {
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseLog)(''), []);
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseLog)('garbage\0\0'), []);
});
(0, node_test_1.default)('parseDecoration: detached HEAD, plain branches; notes, pull refs and refs/stash are ignored', () => {
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseDecoration)('HEAD, refs/heads/dev, refs/notes/commits, refs/pull/1/head, refs/stash'), [{ name: 'HEAD', kind: 'head', current: true }, { name: 'dev', kind: 'branch', current: false }]);
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseDecoration)(''), []);
});
function commit(shaValue, parents, subject) {
    return { sha: shaValue, parents, author: 'a', email: 'e', time: 1, refs: [], subject };
}
(0, node_test_1.default)('applyStashes labels stashes by position, keeps the first parent and drops index/untracked commits', () => {
    const base = sha('1');
    const commits = [
        commit(sha('s'), [base, sha('i'), sha('u')], 'On main: wip'),
        commit(sha('i'), [base], 'index on main'),
        commit(sha('u'), [], 'untracked files on main'),
        commit(base, [], 'base'),
        commit(sha('t'), [base, sha('j')], 'On main: older'),
        commit(sha('j'), [base], 'index on main'),
    ];
    const out = (0, gitLog_1.applyStashes)(commits, [
        { sha: sha('s'), parents: [base, sha('i'), sha('u')] },
        { sha: sha('t'), parents: [base, sha('j')] },
    ]);
    node_assert_1.default.deepStrictEqual(out.map((c) => c.sha), [sha('s'), base, sha('t')]);
    node_assert_1.default.deepStrictEqual(out[0].parents, [base]);
    node_assert_1.default.deepStrictEqual(out[0].refs, [{ name: 'stash@{0}', kind: 'stash' }]);
    node_assert_1.default.deepStrictEqual(out[2].refs, [{ name: 'stash@{1}', kind: 'stash' }]);
});
(0, node_test_1.default)('applyStashes with no stashes returns the commits unchanged', () => {
    const commits = [commit(sha('a'), [], 'x')];
    node_assert_1.default.deepStrictEqual((0, gitLog_1.applyStashes)(commits, []), commits);
});
(0, node_test_1.default)('parseNameStatus: spaces, unicode, a leading dash, renames', () => {
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseNameStatus)('M\0a b.txt\0A\0dir/é.txt\0R100\0old.txt\0new.txt\0D\0-dash.txt\0'), [
        { status: 'M', path: 'a b.txt' },
        { status: 'A', path: 'dir/é.txt' },
        { status: 'R', oldPath: 'old.txt', path: 'new.txt' },
        { status: 'D', path: '-dash.txt' },
    ]);
    node_assert_1.default.deepStrictEqual((0, gitLog_1.parseNameStatus)(''), []);
});
(0, node_test_1.default)('formatAge', () => {
    const now = 10_000_000;
    const ago = (s) => (0, gitLog_1.formatAge)(now - s, now);
    node_assert_1.default.strictEqual(ago(30), 'now');
    node_assert_1.default.strictEqual(ago(300), '5m');
    node_assert_1.default.strictEqual(ago(7200), '2h');
    node_assert_1.default.strictEqual(ago(3 * 86400), '3d');
    node_assert_1.default.strictEqual(ago(21 * 86400), '3w');
    node_assert_1.default.strictEqual(ago(90 * 86400), '3mo');
    node_assert_1.default.strictEqual(ago(800 * 86400), '2y');
    node_assert_1.default.strictEqual((0, gitLog_1.formatAge)(now + 500, now), 'now');
});
//# sourceMappingURL=gitLog.test.js.map