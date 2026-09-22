'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const promptFormat_1 = require("./promptFormat");
function makeIssue(overrides) {
    return {
        number: 1,
        title: 'Untitled',
        body: '',
        state: 'open',
        html_url: 'https://github.com/o/r/issues/1',
        labels: [],
        assignees: [],
        user: { login: 'author', avatar_url: '' },
        comments: 0,
        updated_at: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}
(0, node_test_1.default)('formatIssueAsPrompt includes number, title, body, and link', () => {
    const text = (0, promptFormat_1.formatIssueAsPrompt)(makeIssue({
        number: 43, title: 'Add issues panel', body: 'Some body text',
        html_url: 'https://github.com/x/y/issues/43',
    }));
    node_assert_1.default.strictEqual(text, '#43 Add issues panel\n\nSome body text\n\nhttps://github.com/x/y/issues/43');
});
(0, node_test_1.default)('formatIssueAsPrompt handles an empty body without a dangling blank section', () => {
    const text = (0, promptFormat_1.formatIssueAsPrompt)(makeIssue({
        number: 5, title: 'No description', body: '',
        html_url: 'https://github.com/x/y/issues/5',
    }));
    node_assert_1.default.strictEqual(text, '#5 No description\n\nhttps://github.com/x/y/issues/5');
});
//# sourceMappingURL=promptFormat.test.js.map