'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSuggestion = void 0;
exports.matchIssues = matchIssues;
const toSuggestion = (i) => ({ number: i.number, title: i.title, state: i.state });
exports.toSuggestion = toSuggestion;
/**
 * Issues for the composer's `#` popup. A typed number matches issue numbers by prefix (`#12` finds 12, 120, 123) and
 * titles containing it; other text matches titles; nothing typed lists the newest. Each number once, newest first.
 */
function matchIssues(issues, prefix, limit = 8) {
    const byNumber = new Map();
    for (const i of issues)
        byNumber.set(i.number, i);
    const p = prefix.toLowerCase();
    const numeric = /^\d+$/.test(p);
    return [...byNumber.values()]
        .filter(i => !p || (numeric && String(i.number).startsWith(p)) || i.title.toLowerCase().includes(p))
        .sort((a, b) => b.number - a.number)
        .slice(0, limit)
        .map(exports.toSuggestion);
}
//# sourceMappingURL=issueSuggest.js.map