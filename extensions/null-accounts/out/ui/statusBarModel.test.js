'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const statusBarModel_1 = require("./statusBarModel");
(0, node_test_1.test)('a bound folder shows the account and explains the click', () => {
    const m = (0, statusBarModel_1.statusBarModel)('my-repo', {
        id: 'a1', provider: 'github', host: 'github.com', username: 'octo', email: 'o@e.com', authMethod: 'oauth',
    });
    node_assert_1.default.strictEqual(m.text, '$(account) octo');
    node_assert_1.default.match(m.tooltip, /my-repo uses octo@github\.com/);
    node_assert_1.default.match(m.tooltip, /switch/i);
});
(0, node_test_1.test)('an unbound folder reads "No account" and invites a choice', () => {
    const m = (0, statusBarModel_1.statusBarModel)('my-repo', undefined);
    node_assert_1.default.strictEqual(m.text, '$(account) No account');
    node_assert_1.default.match(m.tooltip, /my-repo has no account/);
});
//# sourceMappingURL=statusBarModel.test.js.map