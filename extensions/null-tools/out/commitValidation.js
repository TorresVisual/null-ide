'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMIT_TYPES = void 0;
exports.validateCommitMessage = validateCommitMessage;
exports.COMMIT_TYPES = ['feat', 'fix', 'docs', 'refactor', 'test', 'build', 'ci', 'perf', 'style', 'chore'];
const EXAMPLE = 'e.g. "fix(git): handle missing remote" or "feat(api)!: remove deprecated endpoint"';
// Git-generated and autosquash subjects are never conventional; commitlint skips them too.
const IGNORED = /^(Merge |Revert "|(fixup|squash|amend)! )/;
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
    if (!exports.COMMIT_TYPES.includes(type))
        return `Unknown type "${type}". Use one of: ${exports.COMMIT_TYPES.join(', ')}.`;
    if (scope !== undefined && !scope.trim())
        return 'The scope in parentheses is empty. Name it, e.g. "fix(git): …", or drop the parentheses.';
    if (!description)
        return `Add a description after the colon, ${EXAMPLE}.`;
    if (!space)
        return `Add a space after the colon: "${type}: ${description}".`;
    return undefined;
}
//# sourceMappingURL=commitValidation.js.map