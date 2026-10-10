/// <reference path="./protocol.ts" />
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitStatsService = exports.GIT_TTL_MS = void 0;
const gitLog_1 = require("./gitLog");
exports.GIT_TTL_MS = 60_000;
function assemble(found) {
    const byProject = {};
    const totals = { commits: 0, filesChanged: 0, linesAdded: 0, linesRemoved: 0 };
    for (const [key, t] of found) {
        if (!t)
            continue;
        byProject[key] = t;
        totals.commits += t.commits;
        totals.filesChanged += t.filesChanged;
        totals.linesAdded += t.linesAdded;
        totals.linesRemoved += t.linesRemoved;
    }
    return Object.keys(byProject).length > 0 ? { totals, byProject } : undefined;
}
/** Git statistics for the repos of the open workspace folders. No `vscode` import: everything arrives through `deps`. */
class GitStatsService {
    deps;
    // ponytail: one entry per (repo, range) ever asked for; the dashboard has five ranges, so this stays tiny.
    entries = new Map();
    inflight = new Map();
    warned = new Set();
    constructor(deps) {
        this.deps = deps;
    }
    /** Cached numbers for `range` (possibly stale, so the UI does not flicker) and whether a reload is due. */
    peek(range) {
        const now = this.deps.now();
        const found = new Map();
        let fresh = true;
        for (const key of this.repos().keys()) {
            const entry = this.entries.get(entryKey(key, range));
            if (!entry || now - entry.at >= exports.GIT_TTL_MS)
                fresh = false;
            found.set(key, entry?.totals);
        }
        return { fresh, git: assemble(found) };
    }
    /** Reads whatever is missing or stale. Never rejects: a repo that cannot be read is simply left out. */
    async load(range) {
        const found = new Map();
        await Promise.all([...this.repos()].map(async ([key, folder]) => {
            found.set(key, (await this.entry(key, folder, range)).totals);
        }));
        return assemble(found);
    }
    /** key -> first folder, for the open folders. Empty in an untrusted workspace. */
    repos() {
        const repos = new Map();
        if (!this.deps.trusted())
            return repos;
        for (const folder of this.deps.folders()) {
            const key = this.deps.resolveKey(folder);
            if (!repos.has(key))
                repos.set(key, folder);
        }
        return repos;
    }
    entry(key, folder, range) {
        const id = entryKey(key, range);
        const hit = this.entries.get(id);
        if (hit && this.deps.now() - hit.at < exports.GIT_TTL_MS)
            return Promise.resolve(hit);
        let pending = this.inflight.get(id);
        if (!pending) {
            pending = this.read(key, folder, range)
                .then((totals) => {
                const entry = { at: this.deps.now(), totals };
                this.entries.set(id, entry);
                return entry;
            })
                .finally(() => this.inflight.delete(id));
            this.inflight.set(id, pending);
        }
        return pending;
    }
    async read(key, folder, range) {
        try {
            const email = (await this.deps.exec(['config', '--get', 'user.email'], folder)).trim();
            if (!email)
                throw new Error('no user.email');
            return (0, gitLog_1.parseGitLog)(await this.deps.exec((0, gitLog_1.gitLogArgs)(range, email), folder), email, range);
        }
        catch (err) {
            if (!this.warned.has(key)) {
                this.warned.add(key);
                this.deps.log(`git stats: skipped ${folder} (${err instanceof Error ? err.message : String(err)})`);
            }
            return undefined;
        }
    }
}
exports.GitStatsService = GitStatsService;
function entryKey(key, range) {
    return `${key}|${range.from}|${range.to}`;
}
//# sourceMappingURL=gitStatsService.js.map