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
exports.IntervalStore = void 0;
exports.monthKey = monthKey;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const stats_1 = require("./stats");
const FILE_RE = /^intervals-(\d{4})-(\d{2})-.+\.jsonl$/;
const DEFAULT_MAX_BUFFERED = 5_000;
const EVERYTHING = { from: -Infinity, to: Infinity };
function monthKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
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
    /** Splits at local month boundaries; lines stay on the first piece. */
    append(interval) {
        let piece = interval;
        for (;;) {
            const boundary = (0, stats_1.nextPeriodStart)(piece.start, 'month');
            if (piece.end <= boundary) {
                this.push(piece);
                return;
            }
            this.push({ ...piece, end: boundary });
            piece = { ...piece, start: boundary, linesAdded: 0, linesRemoved: 0 };
        }
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
        for (const name of this.listFiles(range))
            out.push(...this.parseFile(path.join(this.opts.dir, name)));
        out.push(...this.buffer);
        return out.filter((i) => overlaps(i, range));
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
    push(i) {
        this.buffer.push(i);
        const max = this.opts.maxBuffered ?? DEFAULT_MAX_BUFFERED;
        if (this.buffer.length > max) {
            this.buffer.splice(0, this.buffer.length - max);
            this.opts.log?.(`Interval buffer full (${max}); dropped the oldest unsaved intervals.`);
        }
    }
    fileFor(month) {
        return path.join(this.opts.dir, `intervals-${month}-${this.opts.windowId}.jsonl`);
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