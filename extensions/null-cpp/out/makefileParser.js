"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMakeTargets = parseMakeTargets;
const TARGET_LINE = /^([A-Za-z][A-Za-z0-9_-]*)\s*:(?!=)(.*)$/;
const PHONY_LINE = /^\.PHONY\s*:(.*)$/;
/**
 * Extracts runnable targets from arbitrary Makefile text. Prefers targets self-documented with
 * a `## description` comment (the common `awk`-based `make help` convention, used by e.g.
 * university-provided Makefiles) since that's the author's own curated command list. Falls back
 * to `.PHONY` targets (our own generated Makefile has no `##` comments) to exclude file/pattern
 * targets like `build/%.o` or a `build:` mkdir helper that aren't meant to be run directly.
 */
function parseMakeTargets(content) {
    const phony = new Set();
    const all = [];
    const documented = [];
    const seen = new Set();
    for (const line of content.split(/\r?\n/)) {
        const phonyMatch = PHONY_LINE.exec(line);
        if (phonyMatch) {
            for (const name of phonyMatch[1].trim().split(/\s+/)) {
                if (name) {
                    phony.add(name);
                }
            }
            continue;
        }
        const m = TARGET_LINE.exec(line);
        if (!m || seen.has(m[1])) {
            continue;
        }
        seen.add(m[1]);
        const hashIdx = m[2].indexOf('##');
        const description = hashIdx >= 0 ? m[2].slice(hashIdx + 2).trim() || undefined : undefined;
        const target = description ? { name: m[1], description } : { name: m[1] };
        all.push(target);
        if (description) {
            documented.push(target);
        }
    }
    if (documented.length > 0) {
        return documented;
    }
    if (phony.size > 0) {
        return all.filter((t) => phony.has(t.name));
    }
    return all;
}
//# sourceMappingURL=makefileParser.js.map