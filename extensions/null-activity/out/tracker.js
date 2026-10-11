'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tracker = void 0;
exports.lineDelta = lineDelta;
class Tracker {
    opts;
    open;
    active = true;
    constructor(opts) {
        this.opts = opts;
    }
    heartbeat(h) {
        if (!this.active)
            return;
        const o = this.open;
        const sameContext = !!o && o.workspace === h.workspace && o.language === h.language && o.file === h.file;
        if (o && sameContext && h.ts >= o.last && h.ts - o.last <= this.opts.idleTimeoutMs()) {
            o.last = h.ts;
            o.linesAdded += h.linesAdded;
            o.linesRemoved += h.linesRemoved;
            return;
        }
        this.close(h.ts);
        this.open = {
            start: h.ts,
            last: h.ts,
            workspace: h.workspace,
            language: h.language,
            file: h.file,
            project: this.opts.resolveProject(h.workspace),
            linesAdded: h.linesAdded,
            linesRemoved: h.linesRemoved,
        };
    }
    setActive(active) {
        if (!active)
            this.closeAtLast();
        this.active = active;
    }
    /** Closes a stale interval even when no new heartbeat arrives. */
    tick() {
        const o = this.open;
        const now = this.opts.clock();
        if (o && now - o.last > this.opts.idleTimeoutMs())
            this.close(now);
    }
    closeOpen() {
        this.closeAtLast();
    }
    /** The in-progress interval up to its last heartbeat, for live readouts. */
    peek() {
        const o = this.open;
        return o && o.last > o.start ? this.toInterval(o, o.last) : undefined;
    }
    /** No heartbeat to close on: end at the last one, so a long idle timeout never credits silence. */
    closeAtLast() {
        if (this.open)
            this.close(this.open.last);
    }
    close(t) {
        const o = this.open;
        if (!o)
            return;
        this.open = undefined;
        const end = t < o.last || t - o.last > this.opts.idleTimeoutMs() ? o.last : t;
        if (end <= o.start)
            return;
        this.opts.onInterval(this.toInterval(o, end));
    }
    toInterval(o, end) {
        return {
            start: o.start,
            end,
            project: { key: o.project.key, name: o.project.name },
            language: o.language,
            ...(o.file !== undefined ? { file: o.file } : {}),
            ...(o.project.branch ? { branch: o.project.branch } : {}),
            linesAdded: o.linesAdded,
            linesRemoved: o.linesRemoved,
        };
    }
}
exports.Tracker = Tracker;
/** Lines added = newlines inserted; lines removed = lines spanned by the replaced range. */
function lineDelta(changes) {
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const c of changes) {
        for (let i = c.text.indexOf('\n'); i !== -1; i = c.text.indexOf('\n', i + 1))
            linesAdded++;
        linesRemoved += c.range.end.line - c.range.start.line;
    }
    return { linesAdded, linesRemoved };
}
//# sourceMappingURL=tracker.js.map