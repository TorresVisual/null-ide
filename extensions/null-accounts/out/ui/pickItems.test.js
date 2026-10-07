'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const pickItems_1 = require("./pickItems");
const acct = (id) => ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });
const kinds = (items) => items.map(i => (i.action.kind === 'account' ? i.action.account.id : i.action.kind));
(0, node_test_1.test)('the suggested account comes first and is marked; the add action is always last when unbound', () => {
    const items = (0, pickItems_1.buildPickItems)([acct('a1'), acct('a2'), acct('a3')], { suggestedId: 'a2' });
    node_assert_1.default.deepStrictEqual(kinds(items), ['a2', 'a1', 'a3', 'add']);
    node_assert_1.default.match(items[0].detail ?? '', /suggested/i);
    node_assert_1.default.strictEqual(items[1].detail, undefined);
    node_assert_1.default.strictEqual(items[3].label, pickItems_1.ADD_ACCOUNT_LABEL);
});
(0, node_test_1.test)('the current account comes first and is marked, followed by add and "no account"', () => {
    const items = (0, pickItems_1.buildPickItems)([acct('a1'), acct('a2')], { currentId: 'a2', suggestedId: 'a1' });
    node_assert_1.default.deepStrictEqual(kinds(items), ['a2', 'a1', 'add', 'unbind']);
    node_assert_1.default.strictEqual(items[0].detail, 'Current');
    node_assert_1.default.match(items[1].detail ?? '', /suggested/i);
    node_assert_1.default.strictEqual(items[3].label, pickItems_1.UNBIND_LABEL);
});
(0, node_test_1.test)('"no account" is offered only when the current account still exists', () => {
    node_assert_1.default.deepStrictEqual(kinds((0, pickItems_1.buildPickItems)([acct('a1')])), ['a1', 'add']);
    node_assert_1.default.deepStrictEqual(kinds((0, pickItems_1.buildPickItems)([acct('a1')], { currentId: 'deleted' })), ['a1', 'add']);
});
(0, node_test_1.test)('with no accounts only the add action remains', () => {
    node_assert_1.default.deepStrictEqual(kinds((0, pickItems_1.buildPickItems)([])), ['add']);
});
(0, node_test_1.test)('the provider choices are GitHub, gitlab.com and self-hosted GitLab, in that order', () => {
    node_assert_1.default.deepStrictEqual((0, pickItems_1.providerPickItems)().map(p => p.choice), ['github', 'gitlab', 'gitlab-self-hosted']);
    node_assert_1.default.strictEqual(pickItems_1.ADD_ACCOUNT_LABEL, '$(add) Add account…');
});
//# sourceMappingURL=pickItems.test.js.map