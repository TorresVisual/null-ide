'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntervalStore = exports.newWindowId = void 0;
exports.monthKey = monthKey;
exports.parseInterval = parseInterval;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const stats_1 = require("./stats");
const types_1 = require("./types");
const FILE_RE = /^intervals-(\d{4})-(\d{2})-(.+)\.jsonl$/;
const DEFAULT_MAX_BUFFERED = 5_000;
const REMOTE_DIR = 'machines';
const REMOTE_FILE_RE = /^(\d{4}-\d{2})\.jsonl$/;
const EVERYTHING = { from: -Infinity, to: Infinity };
function monthKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** A fresh id per extension-host launch. `env.sessionId` is shared by every window of one app launch, so it cannot tell windows apart. */
const newWindowId = () => crypto.randomBytes(5).toString('hex');
exports.newWindowId = newWindowId;
function parseInterval(line) {
    try {
        const v = JSON.parse(line);
        if (Number.isFinite(v.start) && Number.isFinite(v.end) && v.end > v.start &&
            typeof v.project?.key === 'string' && typeof v.project?.name === 'string' && typeof v.language === 'string') {
            return { ...v, linesAdded: Number(v.linesAdded) || 0, linesRemoved: Number(v.linesRemoved) || 0 };
        }
    }
    catch {
        // torn or corrupt line
    }
    return undefined;
}
const overlaps = (i, r) => i.end > r.from && i.start < r.to;
class IntervalStore {
    opts;
    buffer = [];
    constructor(opts) {
        this.opts = opts;
    }
    get windowId() {
        return this.opts.windowId;
    }
    get machineId() {
        return this.opts.machineId ?? 'local';
    }
    /** Splits at local month boundaries; lines stay on the first piece. */
    split(interval) {
        const out = [];
        let piece = interval;
        for (;;) {
            const boundary = (0, stats_1.nextPeriodStart)(piece.start, 'month');
            if (piece.end <= boundary) {
                out.push(piece);
                return out;
            }
            out.push({ ...piece, end: boundary });
            piece = { ...piece, start: boundary, linesAdded: 0, linesRemoved: 0 };
        }
    }
    append(interval) {
        for (const piece of this.split(interval))
            this.push(piece);
    }
    /**
     * Appends buffered intervals to this window's monthly files. Sync on purpose so `dispose`
     * can flush. ponytail: one file per window session per month; add compaction if file count matters.
     */
    flush() {
        if (this.buffer.length === 0)
            return;
        try {
            fs.mkdirSync(this.opts.dir, { recursive: true });
        }
        catch (err) {
            this.fail(err);
            return;
        }
        const byMonth = new Map();
        for (const i of this.buffer) {
            const key = monthKey(i.start);
            byMonth.set(key, [...(byMonth.get(key) ?? []), i]);
        }
        const remaining = [];
        for (const [month, items] of byMonth) {
            // The leading newline isolates a torn last line left by an earlier crash.
            const chunk = '\n' + items.map((i) => JSON.stringify(i)).join('\n') + '\n';
            try {
                fs.appendFileSync(this.fileFor(month), chunk);
            }
            catch (err) {
                this.fail(err);
                remaining.push(...items);
            }
        }
        this.buffer = remaining;
    }
    read(range) {
        const out = [];
        for (const name of this.listFiles(range)) {
            const window = FILE_RE.exec(name)[3];
            for (const i of this.parseFile(path.join(this.opts.dir, name)))
                out.push({ ...i, window, machine: this.machineId });
        }
        for (const i of this.buffer)
            out.push({ ...i, window: this.opts.windowId, machine: this.machineId });
        for (const { machine, month } of this.remoteMonths()) {
            const start = new Date(Number(month.slice(0, 4)), Number(month.slice(5)) - 1, 1).getTime();
            if ((0, stats_1.nextPeriodStart)(start, 'month') <= range.from || start >= range.to)
                continue;
            for (const i of this.parseFile(this.remoteFile(machine, month)))
                out.push({ ...i, window: i.window ?? '', machine });
        }
        return out.filter((i) => overlaps(i, range));
    }
    /** Months (`YYYY-MM`) for which this machine has data on disk, oldest first. */
    ownMonths() {
        this.flush();
        const months = new Set();
        for (const name of this.listFiles(EVERYTHING)) {
            const m = FILE_RE.exec(name);
            months.add(`${m[1]}-${m[2]}`);
        }
        return [...months].sort();
    }
    /** Everything this machine recorded in `month`, every window (imports included), tagged with its window. */
    exportOwn(month) {
        this.flush();
        const out = [];
        for (const name of this.listFiles(EVERYTHING).sort()) {
            const m = FILE_RE.exec(name);
            if (`${m[1]}-${m[2]}` !== month)
                continue;
            for (const i of this.parseFile(path.join(this.opts.dir, name)))
                out.push({ ...i, window: m[3] });
        }
        return out;
    }
    /** The cached month files of other machines. */
    remoteMonths() {
        const out = [];
        const root = path.join(this.opts.dir, REMOTE_DIR);
        let machines;
        try {
            machines = fs.readdirSync(root);
        }
        catch {
            return out;
        }
        for (const machine of machines.filter((id) => types_1.MACHINE_ID_RE.test(id))) {
            for (const name of fs.readdirSync(path.join(root, machine), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)) {
                const m = REMOTE_FILE_RE.exec(name);
                if (m)
                    out.push({ machine, month: m[1] });
            }
        }
        return out;
    }
    /** Replaces another machine's cached month. Throws on an invalid id or month (remote names are untrusted). */
    replaceRemote(machine, month, intervals) {
        const file = this.remoteFile(machine, month);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.rewrite(file, intervals.map(({ machine: _machine, ...i }) => i));
    }
    removeRemote(machine, month) {
        fs.rmSync(this.remoteFile(machine, month), { force: true });
    }
    remoteFile(machine, month) {
        if (!types_1.MACHINE_ID_RE.test(machine) || !types_1.MONTH_RE.test(month))
            throw new Error('invalid machine or month');
        return path.join(this.opts.dir, REMOTE_DIR, machine, `${month}.jsonl`);
    }
    /**
     * Drops every interval overlapping the range, so it can over-delete one interval at each edge.
     * ponytail: rewriting another window's file can race with its append; acceptable for a manual action.
     */
    deleteRange(range) {
        this.flush();
        this.buffer = this.buffer.filter((i) => !overlaps(i, range));
        for (const name of this.listFiles(range)) {
            const file = path.join(this.opts.dir, name);
            this.rewrite(file, this.parseFile(file).filter((i) => !overlaps(i, range)));
        }
    }
    deleteAll() {
        this.buffer = [];
        for (const name of this.listFiles(EVERYTHING))
            fs.rmSync(path.join(this.opts.dir, name), { force: true });
    }
    /**
     * Replaces every file of `windowId` with `intervals` (used by imports). Writes straight to disk, so the
     * buffer cap does not apply; throws on write failure, leaving files that were not yet replaced intact.
     */
    replaceWindow(windowId, intervals) {
        const byMonth = new Map();
        for (const i of intervals) {
            for (const piece of this.split(i)) {
                const month = monthKey(piece.start);
                const list = byMonth.get(month);
                if (list)
                    list.push(piece);
                else
                    byMonth.set(month, [piece]);
            }
        }
        fs.mkdirSync(this.opts.dir, { recursive: true });
        const fresh = new Set();
        for (const [month, items] of byMonth) {
            const file = this.fileFor(month, windowId);
            this.rewrite(file, items);
            fresh.add(path.basename(file));
        }
        for (const name of this.windowFiles(windowId)) {
            if (!fresh.has(name))
                fs.rmSync(path.join(this.opts.dir, name), { force: true });
        }
    }
    hasWindow(windowId) {
        return this.windowFiles(windowId).length > 0;
    }
    push(i) {
        this.buffer.push(i);
        const max = this.opts.maxBuffered ?? DEFAULT_MAX_BUFFERED;
        if (this.buffer.length > max) {
            this.buffer.splice(0, this.buffer.length - max);
            this.opts.log?.(`Interval buffer full (${max}); dropped the oldest unsaved intervals.`);
        }
    }
    fileFor(month, windowId = this.opts.windowId) {
        return path.join(this.opts.dir, `intervals-${month}-${windowId}.jsonl`);
    }
    windowFiles(windowId) {
        let names;
        try {
            names = fs.readdirSync(this.opts.dir);
        }
        catch {
            return [];
        }
        return names.filter((name) => name.replace(/^intervals-\d{4}-\d{2}-/, '') === `${windowId}.jsonl`);
    }
    listFiles(range) {
        let names;
        try {
            names = fs.readdirSync(this.opts.dir);
        }
        catch {
            return [];
        }
        return names.filter((name) => {
            const m = FILE_RE.exec(name);
            if (!m)
                return false;
            const start = new Date(Number(m[1]), Number(m[2]) - 1, 1).getTime();
            return (0, stats_1.nextPeriodStart)(start, 'month') > range.from && start < range.to;
        });
    }
    parseFile(file) {
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        }
        catch (err) {
            this.fail(err);
            return [];
        }
        return text.split('\n').flatMap((line) => (line.trim() ? parseInterval(line) ?? [] : []));
    }
    rewrite(file, intervals) {
        if (intervals.length === 0) {
            fs.rmSync(file, { force: true });
            return;
        }
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, intervals.map((i) => JSON.stringify(i) + '\n').join(''));
        fs.renameSync(tmp, file);
    }
    fail(err) {
        this.opts.log?.(`Storage error: ${err instanceof Error ? err.message : String(err)}`);
    }
}
exports.IntervalStore = IntervalStore;
//# sourceMappingURL=intervalStore.js.map