'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSection = buildSection;
exports.buildProjects = buildProjects;
const widgetTypes_1 = require("./widgetTypes");
function buildSection(outcomes, previous, rank, max) {
    const kept = new Map();
    const failed = [];
    for (const o of outcomes) {
        const key = o.repo.toLowerCase();
        if (o.rows) {
            kept.set(key, o.rows);
            continue;
        }
        kept.set(key, previous.get(key) ?? []); // keep the last good rows
        failed.push({ repo: o.repo, reason: o.reason ?? 'error' });
    }
    const items = rank([...kept.values()].flat()).slice(0, max);
    let status = 'ok';
    if (outcomes.length > 0 && failed.length === outcomes.length) {
        const reasons = new Set(failed.map(f => f.reason));
        status = reasons.size === 1 ? failed[0].reason : 'error';
    }
    return { section: { status, failed, items }, kept };
}
function buildProjects(entries, statuses) {
    const ordered = [...entries].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.timestamp - a.timestamp).slice(0, widgetTypes_1.MAX_PROJECTS);
    const items = ordered.map((e) => {
        const git = statuses.get(e.path) ?? null;
        return { name: e.label, path: e.path, branch: git?.branch ?? null, dirty: git?.dirty ?? false, pinned: e.pinned, lastOpened: new Date(e.timestamp).toISOString() };
    });
    return { status: 'ok', failed: [], items };
}
//# sourceMappingURL=widgetSections.js.map