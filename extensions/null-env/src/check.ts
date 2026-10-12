import { RULES } from './rules';
import type { Finding, Language, Probes, Requirement } from './types';

/** Requirements that apply to `languages` and are not satisfied by `probes`. Empty means nothing to show. */
export function check(languages: readonly Language[], probes: Probes, rules: readonly Requirement[] = RULES): Finding[] {
  const present = new Set(languages);
  return rules
    .filter(r => r.languages === 'all' || r.languages.some(l => present.has(l)))
    .filter(r => !r.anyOf.some(x => (r.kind === 'extension' ? probes.hasExtension(x) : probes.hasTool(x))))
    .map(({ languages: _languages, ...finding }) => finding);
}

/** Identifies the set of missing required items, so a snooze can tell "same problem" from "a new one". */
export function requiredSignature(findings: readonly Finding[]): string {
  return findings
    .filter(f => f.severity === 'required')
    .map(f => f.id)
    .sort()
    .join(',');
}

/** The required findings to warn about; none while the user's snooze still matches the current set. */
export function visibleRequired(findings: readonly Finding[], snoozedSignature: string | undefined): Finding[] {
  const required = findings.filter(f => f.severity === 'required');
  return required.length > 0 && requiredSignature(required) === snoozedSignature ? [] : required;
}
