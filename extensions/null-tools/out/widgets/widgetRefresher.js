'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.WidgetRefresher = exports.FOCUS_REFRESH_MIN_MS = exports.MAX_BACKOFF_MS = exports.TICK_MS = exports.REFRESH_MS = void 0;
const widgetFetch_1 = require("./widgetFetch");
const widgetSections_1 = require("./widgetSections");
const widgetQueries_1 = require("./widgetQueries");
const widgetTypes_1 = require("./widgetTypes");
exports.REFRESH_MS = 10 * 60_000;
exports.TICK_MS = 60_000;
exports.MAX_BACKOFF_MS = 60 * 60_000;
exports.FOCUS_REFRESH_MIN_MS = 60_000;
const CONFIG_REFRESH_DELAY_MS = 1_000;
const empty = () => ({ status: 'ok', failed: [], items: [] });
class WidgetRefresher {
    d;
    issueRows = new Map();
    prRows = new Map();
    sections = { projects: empty(), issues: empty(), prs: empty() };
    wrote = false;
    owner = false;
    focused = false;
    running = false;
    failures = 0;
    lastFetch = 0;
    fetchedAt = 0; // when the rows in the file were fetched; later rewrites (dispose, settings) must not make them look newer
    suspendedUntil = 0;
    timer;
    constructor(d) {
        this.d = d;
    }
    start() { this.schedule(); }
    setFocused(focused) {
        this.focused = focused;
        if (!focused || !this.d.settings().enabled) {
            return;
        }
        this.d.ownership.claim();
        this.owner = true;
        if (this.d.now() - this.lastFetch >= exports.FOCUS_REFRESH_MIN_MS) {
            void this.refresh();
        }
    }
    async refresh() {
        const cfg = this.d.settings();
        if (!cfg.enabled) {
            this.disable();
            return;
        }
        if (!this.d.ownership.isOwner()) {
            this.owner = false;
            return;
        }
        this.owner = true;
        if (this.running || this.d.now() < this.suspendedUntil) {
            return;
        }
        this.running = true;
        try {
            this.lastFetch = this.d.now();
            // Projects first: reading them refreshes the repo -> checkout map that the fetch below attaches to issue and PR rows.
            try {
                this.sections.projects = await this.d.projects();
            }
            catch (err) {
                this.d.log(`projects: ${err.message}`);
            }
            const byAccount = new Map();
            for (const { repo, account } of cfg.repos) {
                byAccount.set(account, [...(byAccount.get(account) ?? []), repo]);
            }
            const results = [];
            for (const [account, repos] of byAccount) {
                try {
                    results.push(...await this.d.fetch(account, repos));
                }
                catch (err) {
                    const c = (0, widgetFetch_1.classifyError)(err);
                    results.push(...repos.map(repo => ({ repo, reason: c.reason, retryAt: c.retryAt })));
                }
            }
            const issues = [], prs = [];
            let retryAt = 0;
            for (const r of results) {
                if ('reason' in r) {
                    issues.push({ repo: r.repo, rows: null, reason: r.reason });
                    prs.push({ repo: r.repo, rows: null, reason: r.reason });
                    retryAt = Math.max(retryAt, r.retryAt ?? 0);
                }
                else {
                    issues.push({ repo: r.repo, rows: r.issues });
                    prs.push({ repo: r.repo, rows: r.prs });
                }
            }
            const i = (0, widgetSections_1.buildSection)(issues, this.issueRows, widgetQueries_1.rankIssues, widgetTypes_1.MAX_ISSUES), p = (0, widgetSections_1.buildSection)(prs, this.prRows, widgetQueries_1.rankPrs, widgetTypes_1.MAX_PRS);
            this.issueRows = i.kept;
            this.prRows = p.kept;
            this.sections.issues = i.section;
            this.sections.prs = p.section;
            const allFailed = results.length > 0 && results.every(r => 'reason' in r);
            this.failures = allFailed ? this.failures + 1 : 0;
            if (retryAt > 0) {
                this.suspendedUntil = retryAt;
            }
            this.fetchedAt = this.d.now();
            this.write();
        }
        finally {
            this.running = false;
        }
    }
    onConfigChanged() {
        const cfg = this.d.settings();
        if (!cfg.enabled) {
            this.disable();
            return;
        }
        const keep = new Set(cfg.repos.map(r => r.repo.toLowerCase()));
        for (const k of [...this.issueRows.keys()]) {
            if (!keep.has(k)) {
                this.issueRows.delete(k);
            }
        }
        for (const k of [...this.prRows.keys()]) {
            if (!keep.has(k)) {
                this.prRows.delete(k);
            }
        }
        this.sections.issues = { ...this.sections.issues, items: (0, widgetQueries_1.rankIssues)([...this.issueRows.values()].flat()).slice(0, widgetTypes_1.MAX_ISSUES), failed: this.sections.issues.failed.filter(f => keep.has(f.repo.toLowerCase())) };
        this.sections.prs = { ...this.sections.prs, items: (0, widgetQueries_1.rankPrs)([...this.prRows.values()].flat()).slice(0, widgetTypes_1.MAX_PRS), failed: this.sections.prs.failed.filter(f => keep.has(f.repo.toLowerCase())) };
        if (this.wrote && this.d.ownership.isOwner()) {
            this.write();
        }
        this.d.setTimeout(() => void this.refresh(), CONFIG_REFRESH_DELAY_MS); // debounced, and never inside the call that changed the config
    }
    dispose() {
        if (this.timer) {
            this.d.clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.owner && this.wrote && this.d.settings().enabled) {
            try {
                this.write();
            }
            catch (err) {
                this.d.log(`final write: ${err.message}`);
            }
        }
        this.d.ownership.release();
    }
    disable() {
        this.d.store.remove();
        this.wrote = false;
        this.d.ownership.release();
        this.owner = false;
    }
    write() {
        this.d.store.write({ schema: widgetTypes_1.SCHEMA, writtenAt: new Date(this.fetchedAt || this.d.now()).toISOString(), ...this.sections });
        this.wrote = true;
    }
    nextDelay() {
        const base = this.failures > 0 ? Math.min(exports.REFRESH_MS * 2 ** this.failures, exports.MAX_BACKOFF_MS) : exports.REFRESH_MS;
        return Math.max(base, this.suspendedUntil - this.d.now());
    }
    schedule() {
        this.timer = this.d.setTimeout(() => void this.tick(), exports.TICK_MS);
    }
    async tick() {
        try {
            if (this.d.settings().enabled) {
                const was = this.owner;
                this.owner = this.d.ownership.isOwner();
                const due = this.d.now() - this.lastFetch >= this.nextDelay();
                if (this.owner && (!was || (this.focused && due))) {
                    await this.refresh();
                }
            }
        }
        catch (err) {
            this.d.log(`tick: ${err.message}`);
        }
        this.schedule();
    }
}
exports.WidgetRefresher = WidgetRefresher;
//# sourceMappingURL=widgetRefresher.js.map