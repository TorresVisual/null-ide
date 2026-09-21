'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatIssueAsPrompt = formatIssueAsPrompt;
function formatIssueAsPrompt(issue) {
    const header = `#${issue.number} ${issue.title}`;
    const body = issue.body?.trim();
    const parts = body ? [header, body, issue.html_url] : [header, issue.html_url];
    return parts.join('\n\n');
}
//# sourceMappingURL=promptFormat.js.map