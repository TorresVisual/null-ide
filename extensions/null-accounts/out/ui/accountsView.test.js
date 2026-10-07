'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const accountsView_1 = require("./accountsView");
const acct = (id) => ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });
const exists = (key) => ({ path: key, exists: true });
(0, node_test_1.test)('projects are grouped under their account and sorted by name, ignoring case', () => {
    const rows = (0, accountsView_1.buildRows)([acct('a1'), acct('a2')], [['/work/zeta', 'a1'], ['/work/Alpha', 'a1'], ['/work/mid', 'a2']], exists);
    node_assert_1.default.deepStrictEqual(rows[0].projects.map(p => p.name), ['Alpha', 'zeta']);
    node_assert_1.default.deepStrictEqual(rows[1].projects.map(p => p.name), ['mid']);
    node_assert_1.default.strictEqual(rows[0].projects[0].key, '/work/Alpha');
});
(0, node_test_1.test)('accounts with no projects get an empty list; bindings to unknown accounts are ignored', () => {
    const rows = (0, accountsView_1.buildRows)([acct('a1')], [['/work/x', 'ghost']], exists);
    node_assert_1.default.strictEqual(rows.length, 1);
    node_assert_1.default.deepStrictEqual(rows[0].projects, []);
});
(0, node_test_1.test)('the resolved (real-cased) path is shown; a missing or throwing folder falls back to its key', () => {
    const rows = (0, accountsView_1.buildRows)([acct('a1')], [['c:/work/myrepo', 'a1'], ['c:/gone', 'a1'], ['c:/broken', 'a1']], key => {
        if (key === 'c:/work/myrepo') {
            return { path: 'C:\\Work\\MyRepo', exists: true };
        }
        if (key === 'c:/broken') {
            throw new Error('EPERM');
        }
        return { path: key, exists: false };
    });
    const byKey = Object.fromEntries(rows[0].projects.map(p => [p.key, p]));
    node_assert_1.default.deepStrictEqual(byKey['c:/work/myrepo'], { key: 'c:/work/myrepo', path: 'C:\\Work\\MyRepo', name: 'MyRepo', exists: true });
    node_assert_1.default.strictEqual(byKey['c:/gone'].exists, false);
    node_assert_1.default.strictEqual(byKey['c:/broken'].exists, false);
    node_assert_1.default.strictEqual(byKey['c:/broken'].name, 'broken');
});
(0, node_test_1.test)('rows carry only display fields — no secrets or provider internals', () => {
    const rows = (0, accountsView_1.buildRows)([{ ...acct('a1'), externalId: 'ext-1' }], [], exists);
    node_assert_1.default.deepStrictEqual(Object.keys(rows[0]).sort(), ['authMethod', 'email', 'host', 'id', 'projects', 'provider', 'username']);
});
(0, node_test_1.test)('removeConfirmation counts projects with correct plurals and never claims to sign out', () => {
    const none = (0, accountsView_1.removeConfirmation)({ username: 'octo', host: 'github.com' }, 0);
    node_assert_1.default.strictEqual(none.message, 'Remove octo@github.com?');
    node_assert_1.default.doesNotMatch(none.detail, /project/);
    node_assert_1.default.match((0, accountsView_1.removeConfirmation)({ username: 'o', host: 'h' }, 1).detail, /1 project will lose/);
    node_assert_1.default.match((0, accountsView_1.removeConfirmation)({ username: 'o', host: 'h' }, 3).detail, /3 projects will lose/);
    node_assert_1.default.match(none.detail, /not affected/);
});
//# sourceMappingURL=accountsView.test.js.map