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
exports.ActivitySync = void 0;
exports.fileState = fileState;
const fs = __importStar(require("fs"));
const activityBlob_1 = require("./activityBlob");
const EMPTY = { uploaded: {}, pulled: {}, names: {} };
function fileState(file) {
    return {
        load() {
            try {
                const v = JSON.parse(fs.readFileSync(file, 'utf8'));
                return { uploaded: { ...v.uploaded }, pulled: { ...v.pulled }, names: { ...v.names } };
            }
            catch {
                return { ...EMPTY };
            }
        },
        save(state) {
            try {
                fs.writeFileSync(file, JSON.stringify(state));
            }
            catch {
                // the next run starts from what is on disk
            }
        },
    };
}
/**
 * Uploads this machine's intervals as one blob per month and caches other machines' blobs. Each blob has exactly
 * one writer, so there is no merge and no conflict: a blob is replaced, never appended to, and a repeated run changes nothing.
 */
class ActivitySync {
    d;
    tail = Promise.resolve();
    warmed = false;
    constructor(d) {
        this.d = d;
    }
    /** One sync. Serialised, never rejects, does nothing without null-sync. */
    run() {
        const next = this.tail.then(() => this.once().catch((err) => this.d.log(`Sync failed (${err instanceof Error ? err.message : String(err)}).`)));
        this.tail = next;
        return next;
    }
    async once() {
        const { d } = this;
        const port = await d.port();
        if (!port)
            return;
        const state = d.state.load();
        const uploaded = {};
        const pulled = { ...state.pulled };
        const names = { ...state.names };
        let exchanged = false;
        let changed = false;
        // ponytail: after the first run of a launch only the previous and current month are re-encoded (closed months
        // rarely change); an import or delete in an older month goes up on the next launch. Hash every month if that matters.
        const recent = this.recentMonths();
        const ok = await port.syncActivity(async (remote) => {
            exchanged = true;
            const own = d.machine.id;
            const writes = {};
            const present = new Map(remote.names.map((n) => [n.name, n.version]));
            const months = new Set(d.store.ownMonths());
            for (const month of months) {
                const name = (0, activityBlob_1.blobName)(own, month);
                if (this.warmed && !recent.has(month) && state.uploaded[month] !== undefined && present.has(name)) {
                    uploaded[month] = state.uploaded[month];
                    continue;
                }
                const text = (0, activityBlob_1.encodeMonth)({ id: own, name: d.machine.name() }, d.store.exportOwn(month));
                uploaded[month] = (0, activityBlob_1.blobHash)(text);
                if (state.uploaded[month] !== uploaded[month] || !present.has(name))
                    writes[name] = text;
            }
            for (const { name } of remote.names) {
                const parsed = (0, activityBlob_1.parseBlobName)(name);
                if (parsed?.machine === own && !months.has(parsed.month))
                    writes[name] = null;
            }
            const seen = new Set();
            const cached = new Set(d.store.remoteMonths().map((m) => `${m.machine}/${m.month}`));
            for (const { name, version } of remote.names) {
                const parsed = (0, activityBlob_1.parseBlobName)(name);
                if (!parsed || parsed.machine === own)
                    continue;
                const key = `${parsed.machine}/${parsed.month}`;
                seen.add(key);
                if (pulled[key] === version && cached.has(key))
                    continue;
                const text = remote.read(name);
                const blob = text === undefined ? undefined : (0, activityBlob_1.decodeMonth)(text);
                if (!blob || blob.machine !== parsed.machine) {
                    d.log(`Skipped ${name}: it could not be read.`);
                    continue;
                }
                d.store.replaceRemote(parsed.machine, parsed.month, blob.intervals);
                pulled[key] = version;
                names[parsed.machine] = blob.name;
                changed = true;
            }
            for (const key of cached) {
                if (seen.has(key))
                    continue;
                const [machine, month] = key.split('/');
                d.store.removeRemote(machine, month);
                delete pulled[key];
                changed = true;
            }
            return writes;
        });
        if (exchanged)
            d.state.save({ uploaded: ok ? uploaded : state.uploaded, pulled, names });
        if (ok)
            this.warmed = true;
        if (changed)
            d.onPulled();
    }
    recentMonths() {
        const now = new Date();
        const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return new Set([key(now), key(new Date(now.getFullYear(), now.getMonth() - 1, 1))]);
    }
}
exports.ActivitySync = ActivitySync;
//# sourceMappingURL=activitySync.js.map