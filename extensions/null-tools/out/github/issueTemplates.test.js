'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const issueTemplates_1 = require("./issueTemplates");
(0, node_test_1.default)('parseIssueTemplate reads name, title, and labels from frontmatter', () => {
    const raw = [
        '---',
        'name: Bug report',
        "title: 'Bug: '",
        'labels: bug, needs-triage',
        '---',
        'Describe the bug here.',
    ].join('\n');
    node_assert_1.default.deepStrictEqual((0, issueTemplates_1.parseIssueTemplate)(raw, 'bug_report'), {
        name: 'Bug report',
        title: 'Bug: ',
        body: 'Describe the bug here.',
        labels: ['bug', 'needs-triage'],
    });
});
(0, node_test_1.default)('parseIssueTemplate falls back to filename and empty fields with no frontmatter', () => {
    node_assert_1.default.deepStrictEqual((0, issueTemplates_1.parseIssueTemplate)('Just a body.', 'blank'), {
        name: 'blank',
        title: '',
        body: 'Just a body.',
        labels: [],
    });
});
(0, node_test_1.default)('parseIssueTemplate defaults missing frontmatter fields', () => {
    const raw = ['---', 'about: no name or labels here', '---', 'Body text.'].join('\n');
    node_assert_1.default.deepStrictEqual((0, issueTemplates_1.parseIssueTemplate)(raw, 'feature_request'), {
        name: 'feature_request',
        title: '',
        body: 'Body text.',
        labels: [],
    });
});
//# sourceMappingURL=issueTemplates.test.js.map