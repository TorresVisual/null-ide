'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const gitBranch_1 = require("./gitBranch");
(0, node_test_1.default)('branchNameForIssue slugifies the title and caps length', () => {
    node_assert_1.default.strictEqual((0, gitBranch_1.branchNameForIssue)(43, 'Add Issues Panel: split view!'), 'issue-43-add-issues-panel-split-view');
});
(0, node_test_1.default)('branchNameForIssue strips shell metacharacters entirely', () => {
    node_assert_1.default.strictEqual((0, gitBranch_1.branchNameForIssue)(7, '; rm -rf ~ && echo pwned $(whoami)'), 'issue-7-rm-rf-echo-pwned-whoami');
});
(0, node_test_1.default)('branchNameForIssue falls back to just the number for an empty slug', () => {
    node_assert_1.default.strictEqual((0, gitBranch_1.branchNameForIssue)(9, '!!!'), 'issue-9');
});
//# sourceMappingURL=gitBranch.test.js.map