'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.WAKATIME_WINDOW_ID = void 0;
exports.convertExport = convertExport;
exports.formatSummary = formatSummary;
const languageMap_1 = require("./languageMap");
const projectIdentity_1 = require("./projectIdentity");
exports.WAKATIME_WINDOW_ID = 'import-wakatime';
const DEFAULT_TIMEOUT_MIN = 15;
const str = (v) => (typeof v === 'string' ? v : '');
const slash = (p) => p.replace(/\\/g, '/');
const dirOf = (entity) => {
    const e = slash(entity);
    const i = e.lastIndexOf('/');
    return i <= 0 ? '' : e.slice(0, i);
};
function fileOf(entity, root) {
    const e = slash(entity);
    if (root) {
        const prefix = slash(root).replace(/\/+$/, '') + '/';
        if (e.toLowerCase().startsWith(prefix.toLowerCase()))
            return e.slice(prefix.length);
    }
    return e.slice(e.lastIndexOf('/') + 1);
}
function resolveProjects(beats, resolve) {
    const names = new Set();
    const dirCounts = new Map();
    for (const b of beats) {
        if (b.app || !b.project)
            continue;
        names.add(b.project);
        const dir = dirOf(b.entity);
        if (!dir.includes('/'))
            continue;
        const counts = dirCounts.get(b.project) ?? new Map();
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
        dirCounts.set(b.project, counts);
    }
    const projects = new Map();
    let resolved = 0;
    for (const name of names) {
        const counts = dirCounts.get(name);
        const top = counts && [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
        let found;
        try {
            found = top ? resolve(name, top) : undefined;
        }
        catch {
            found = undefined; // an unreadable folder must not fail the import
        }
        if (found)
            resolved++;
        projects.set(name, found ?? { key: name, name });
    }
    return { projects, resolved, byName: names.size - resolved };
}
function contextOf(b, projects) {
    if (b.app)
        return { key: projectIdentity_1.NO_FOLDER, name: projectIdentity_1.NO_FOLDER, language: '', file: undefined };
    const p = (b.project && projects.get(b.project)) || { key: projectIdentity_1.NO_FOLDER, name: projectIdentity_1.NO_FOLDER };
    return { key: p.key, name: p.name, language: (0, languageMap_1.languageId)(b.language), file: fileOf(b.entity, p.root) || undefined };
}
/**
 * Heartbeats → intervals with WakaTime's own rule: a heartbeat counts until the next one when the gap
 * is within the export's timeout.
 */
function convertExport(data, resolve) {
    if (typeof data !== 'object' || data === null || !Array.isArray(data.days)) {
        throw new Error('Not a WakaTime export: no "days" list found.');
    }
    const root = data;
    const userTimeout = Number(root.user?.timeout);
    const timeoutMs = (Number.isFinite(userTimeout) && userTimeout > 0 ? userTimeout : DEFAULT_TIMEOUT_MIN) * 60_000;
    const beats = [];
    let seen = 0;
    let skipped = 0;
    for (const day of root.days) {
        const list = day?.heartbeats;
        if (!Array.isArray(list))
            continue;
        for (const h of list) {
            seen++;
            const time = h?.time;
            if (typeof time !== 'number' || !Number.isFinite(time)) {
                skipped++;
                continue;
            }
            const r = h;
            beats.push({ t: Math.round(time * 1000), project: str(r.project), language: str(r.language), entity: str(r.entity), app: r.type === 'app' });
        }
    }
    beats.sort((a, b) => a.t - b.t);
    const { projects, resolved, byName } = resolveProjects(beats, resolve);
    const contexts = beats.map((b) => contextOf(b, projects));
    const intervals = [];
    let open;
    for (let i = 0; i + 1 < beats.length; i++) {
        const start = beats[i].t;
        const end = beats[i + 1].t;
        const gap = end - start;
        if (gap <= 0 || gap > timeoutMs)
            continue;
        const c = contexts[i];
        if (open && open.end === start && open.project.key === c.key && open.language === c.language && open.file === c.file) {
            open.end = end;
            continue;
        }
        open = {
            start,
            end,
            project: { key: c.key, name: c.name },
            language: c.language,
            ...(c.file !== undefined ? { file: c.file } : {}),
            linesAdded: 0,
            linesRemoved: 0,
        };
        intervals.push(open);
    }
    return {
        intervals,
        summary: {
            days: new Set(intervals.map((i) => new Date(i.start).toDateString())).size,
            totalMs: intervals.reduce((sum, i) => sum + i.end - i.start, 0),
            heartbeats: seen,
            skipped,
            appHeartbeats: beats.filter((b) => b.app).length,
            projectsResolved: resolved,
            projectsByName: byName,
            timeoutMs,
        },
    };
}
function formatSummary(s) {
    const parts = [
        `Imported ${(s.totalMs / 3_600_000).toFixed(1)} h over ${s.days} days.`,
        `Projects: ${s.projectsResolved} matched to local repos, ${s.projectsByName} kept by WakaTime name.`,
    ];
    if (s.appHeartbeats)
        parts.push(`${s.appHeartbeats} app heartbeats went to "${projectIdentity_1.NO_FOLDER}".`);
    if (s.skipped)
        parts.push(`Skipped ${s.skipped} malformed heartbeats.`);
    parts.push(`Gaps up to ${s.timeoutMs / 60_000} min count as active, so imported time is measured more generously than live tracking.`);
    return parts.join(' ');
}
//# sourceMappingURL=wakatimeImport.js.map