'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const githubApi_1 = require("./githubApi");
(0, node_test_1.default)('formatApiError: REST validation error lists each field error', () => {
    const body = JSON.stringify({
        message: 'Validation Failed',
        errors: [{ resource: 'Issue', code: 'invalid', field: 'assignees' }],
    });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(422, body), 'GitHub API 422: Validation Failed · assignees invalid');
});
(0, node_test_1.default)("formatApiError: prefers an error entry's own message", () => {
    const body = JSON.stringify({
        message: 'Validation Failed',
        errors: [{ message: "Could not resolve to a User with the login of 'ghost'." }],
    });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(422, body), "GitHub API 422: Validation Failed · Could not resolve to a User with the login of 'ghost'.");
});
(0, node_test_1.default)('formatApiError: plain message, documentation_url ignored', () => {
    const body = JSON.stringify({ message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(401, body), 'GitHub API 401: Bad credentials');
});
(0, node_test_1.default)('formatApiError: string entries in errors[]', () => {
    const body = JSON.stringify({ message: 'Validation Failed', errors: ['title is too long'] });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(422, body), 'GitHub API 422: Validation Failed · title is too long');
});
(0, node_test_1.default)('formatApiError: GraphQL errors on a 200 response', () => {
    const body = JSON.stringify({ errors: [{ message: "Field 'foo' doesn't exist on type 'Issue'" }] });
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(200, body), "GitHub API error: Field 'foo' doesn't exist on type 'Issue'");
});
(0, node_test_1.default)('formatApiError: non-JSON body (proxy HTML) shows only the status', () => {
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(502, '<html><body>Bad gateway</body></html>'), 'GitHub API 502');
});
(0, node_test_1.default)('formatApiError: empty or null body', () => {
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(404, ''), 'GitHub API 404');
    node_assert_1.default.strictEqual((0, githubApi_1.formatApiError)(500, 'null'), 'GitHub API 500');
});
//# sourceMappingURL=githubApi.test.js.map