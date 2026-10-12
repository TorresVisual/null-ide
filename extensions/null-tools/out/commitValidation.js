'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMIT_TYPES = void 0;
exports.suggestType = suggestType;
exports.validateCommitMessage = validateCommitMessage;
exports.COMMIT_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'build', 'ci', 'perf', 'style', 'chore'];
const EXAMPLE = 'e.g. "fix(git): handle missing remote" or "feat(api)!: remove deprecated endpoint"';
// Git-generated and autosquash subjects are never conventional; commitlint skips them too.
const IGNORED = /^(Merge |Revert "|(fixup|squash|amend)! )/;
// Common wrong words that are too far from the real type for edit distance to catch.
const ALIASES = {
    feature: 'feat', features: 'feat', add: 'feat', bugfix: 'fix', hotfix: 'fix', bug: 'fix', doc: 'docs',
    documentation: 'docs', refactoring: 'refactor', tests: 'test', testing: 'test', performance: 'perf',
    optimize: 'perf', formatting: 'style', chores: 'chore', update: 'chore',
};
function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++)
            row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = row;
    }
    return prev[b.length];
}
/** Closest known type for a mistyped one (case, alias, or a typo within 1 edit, 2 for longer words). */
function suggestType(type) {
    const t = type.toLowerCase();
    if (exports.COMMIT_TYPES.includes(t))
        return t;
    if (ALIASES[t])
        return ALIASES[t];
    const limit = t.length > 4 ? 2 : 1;
    return exports.COMMIT_TYPES.map(c => [c, editDistance(t, c)]).filter(([, d]) => d <= limit).sort((x, y) => x[1] - y[1])[0]?.[0];
}
const HEADER = /^([^\s:(!]+)(?:\(([^()]*)\))?(!)?:(\s*)(.*)$/;
/** Checks the subject line against Conventional Commits. Returns how to fix it, or undefined when valid (or empty). */
function validateCommitMessage(message) {
    const subject = message.split('\n')[0].trim();
    if (!subject || IGNORED.test(subject))
        return undefined;
    const m = HEADER.exec(subject);
    if (!m)
        return `Start with "type: description" or "type(scope): description", ${EXAMPLE}.`;
    const [, type, scope, , space, description] = m;
    if (!exports.COMMIT_TYPES.includes(type)) {
        const guess = suggestType(type);
        return `Unknown type "${type}".${guess ? ` Did you mean "${guess}"?` : ''} Valid types: ${exports.COMMIT_TYPES.join(', ')}.`;
    }
    if (scope !== undefined && !scope.trim())
        return 'The scope in parentheses is empty. Name it, e.g. "fix(git): …", or drop the parentheses.';
    if (!description)
        return `Add a description after the colon, ${EXAMPLE}.`;
    if (!space)
        return `Add a space after the colon: "${type}: ${description}".`;
    return undefined;
}
//# sourceMappingURL=commitValidation.js.map