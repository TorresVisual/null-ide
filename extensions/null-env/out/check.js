"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.check = check;
exports.requiredSignature = requiredSignature;
exports.visibleRequired = visibleRequired;
const rules_1 = require("./rules");
/** Requirements that apply to `languages` and are not satisfied by `probes`. Empty means nothing to show. */
function check(languages, probes, rules = rules_1.RULES) {
    const present = new Set(languages);
    return rules
        .filter(r => r.languages === 'all' || r.languages.some(l => present.has(l)))
        .filter(r => !r.anyOf.some(x => (r.kind === 'extension' ? probes.hasExtension(x) : probes.hasTool(x))))
        .map(({ languages: _languages, ...finding }) => finding);
}
/** Identifies the set of missing required items, so a snooze can tell "same problem" from "a new one". */
function requiredSignature(findings) {
    return findings
        .filter(f => f.severity === 'required')
        .map(f => f.id)
        .sort()
        .join(',');
}
/** The required findings to warn about; none while the user's snooze still matches the current set. */
function visibleRequired(findings, snoozedSignature) {
    const required = findings.filter(f => f.severity === 'required');
    return required.length > 0 && requiredSignature(required) === snoozedSignature ? [] : required;
}
//# sourceMappingURL=check.js.map