'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const issueDrafts_1 = require("./issueDrafts");
(0, node_test_1.default)('draftKey names the unsent text per repo and per issue, or the New issue form', () => {
    const repo = { owner: 'TorresVisual', repo: 'null-ide' };
    node_assert_1.default.strictEqual((0, issueDrafts_1.draftKey)(repo, 106), 'null.issues.draft:TorresVisual/null-ide#106');
    node_assert_1.default.strictEqual((0, issueDrafts_1.draftKey)(repo, 'new'), 'null.issues.draft:TorresVisual/null-ide#new');
    node_assert_1.default.notStrictEqual((0, issueDrafts_1.draftKey)(repo, 1), (0, issueDrafts_1.draftKey)({ owner: 'TorresVisual', repo: 'other' }, 1));
});
//# sourceMappingURL=issueDrafts.test.js.map