'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const pickItems_1 = require("./pickItems");
const acct = (id) => ({ id, provider: 'github', host: 'github.com', username: id, email: `${id}@e.com`, authMethod: 'oauth' });
(0, node_test_1.test)('the suggested account comes first and is marked; the add action is always last', () => {
    const items = (0, pickItems_1.buildPickItems)([acct('a1'), acct('a2'), acct('a3')], 'a2');
    node_assert_1.default.deepStrictEqual(items.map(i => i.account?.id), ['a2', 'a1', 'a3', undefined]);
    node_assert_1.default.match(items[0].detail ?? '', /suggested/i);
    node_assert_1.default.strictEqual(items[1].detail, undefined);
    node_assert_1.default.strictEqual(items[3].label, pickItems_1.ADD_GITHUB_LABEL);
});
(0, node_test_1.test)('without a suggestion the order is unchanged, and with no accounts only the add action remains', () => {
    node_assert_1.default.deepStrictEqual((0, pickItems_1.buildPickItems)([acct('a1'), acct('a2')]).map(i => i.account?.id), ['a1', 'a2', undefined]);
    const only = (0, pickItems_1.buildPickItems)([]);
    node_assert_1.default.strictEqual(only.length, 1);
    node_assert_1.default.strictEqual(only[0].account, undefined);
});
//# sourceMappingURL=pickItems.test.js.map