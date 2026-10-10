'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const accountsMenuModel_1 = require("./accountsMenuModel");
const acct = (id, host = 'github.com') => ({ id, provider: 'github', host, username: id, email: `${id}@e.com`, authMethod: 'oauth' });
const ADD = { label: 'Add Account…', command: accountsMenuModel_1.ADD_ACCOUNT_COMMAND };
const MANAGE = { label: 'Manage Accounts…', command: accountsMenuModel_1.MANAGE_COMMAND };
(0, node_test_1.test)('no accounts: just Add and Manage, no leading separator', () => {
    node_assert_1.default.deepStrictEqual((0, accountsMenuModel_1.accountsMenuModel)([]), [ADD, MANAGE]);
});
(0, node_test_1.test)('each account becomes a row that binds the folder to it, then a separator, then Add and Manage', () => {
    const m = (0, accountsMenuModel_1.accountsMenuModel)([acct('octo'), acct('hub', 'ghe.example.org')]);
    node_assert_1.default.deepStrictEqual(m, [
        { label: 'octo', description: 'github.com', checked: false, command: accountsMenuModel_1.BIND_COMMAND, args: ['octo'] },
        { label: 'hub', description: 'ghe.example.org', checked: false, command: accountsMenuModel_1.BIND_COMMAND, args: ['hub'] },
        'separator',
        ADD,
        MANAGE,
    ]);
});
(0, node_test_1.test)('only the current account is checked', () => {
    const m = (0, accountsMenuModel_1.accountsMenuModel)([acct('a1'), acct('a2'), acct('a3')], 'a2');
    const checked = m.filter(e => e !== 'separator' && e.checked).map(e => e.args?.[0]);
    node_assert_1.default.deepStrictEqual(checked, ['a2']);
});
(0, node_test_1.test)('a current id that is not in the list (removed account) checks nothing', () => {
    const m = (0, accountsMenuModel_1.accountsMenuModel)([acct('a1')], 'gone');
    node_assert_1.default.ok(m.every(e => e === 'separator' || !e.checked));
});
(0, node_test_1.test)('a row carries its picture only when there is one', () => {
    const m = (0, accountsMenuModel_1.accountsMenuModel)([acct('a1'), acct('a2')], undefined, id => (id === 'a2' ? 'data:image/png;base64,AQID' : undefined));
    node_assert_1.default.ok(!('avatar' in m[0]));
    node_assert_1.default.strictEqual(m[1].avatar, 'data:image/png;base64,AQID');
});
(0, node_test_1.test)('the activity bar picture is the current account\'s, else the first one found, else empty', () => {
    const pics = { a2: 'two', a3: 'three' };
    const of = (id) => pics[id];
    const all = [acct('a1'), acct('a2'), acct('a3')];
    node_assert_1.default.strictEqual((0, accountsMenuModel_1.activityAvatar)(all, 'a3', of), 'three');
    node_assert_1.default.strictEqual((0, accountsMenuModel_1.activityAvatar)(all, 'a1', of), 'two');
    node_assert_1.default.strictEqual((0, accountsMenuModel_1.activityAvatar)(all, undefined, of), 'two');
    node_assert_1.default.strictEqual((0, accountsMenuModel_1.activityAvatar)([acct('a1')], undefined, of), '');
});
//# sourceMappingURL=accountsMenuModel.test.js.map