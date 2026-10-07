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
exports.LibraryCache = exports.CACHE_VERSION = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
exports.CACHE_VERSION = 1;
class LibraryCache {
    file;
    map = new Map();
    dirty = false;
    chain = Promise.resolve();
    constructor(file) {
        this.file = file;
    }
    async load() {
        this.map.clear();
        this.dirty = false;
        try {
            const raw = JSON.parse(await fs.promises.readFile(this.file, 'utf8'));
            if (raw?.version !== exports.CACHE_VERSION || typeof raw.entries !== 'object' || raw.entries === null)
                return;
            for (const [file, e] of Object.entries(raw.entries)) {
                if (typeof e?.mtime === 'number' && typeof e?.size === 'number' && typeof e?.tags === 'object' && e.tags !== null) {
                    this.map.set(file, { mtime: e.mtime, size: e.size, tags: e.tags });
                }
            }
        }
        catch {
            this.map.clear(); // missing, unreadable or corrupt: start fresh
        }
    }
    lookup(file, mtime, size) {
        const e = this.map.get(file);
        return e && e.mtime === mtime && e.size === size ? e.tags : undefined;
    }
    set(file, mtime, size, tags) {
        this.map.set(file, { mtime, size, tags });
        this.dirty = true;
    }
    setDuration(file, durationMs) {
        const e = this.map.get(file);
        if (!e)
            return;
        e.tags.durationMs = durationMs;
        this.dirty = true;
    }
    prune(keep) {
        for (const file of [...this.map.keys()]) {
            if (!keep.has(file)) {
                this.map.delete(file);
                this.dirty = true;
            }
        }
    }
    *entries() {
        for (const [file, e] of this.map)
            yield [file, e.tags];
    }
    save() {
        this.chain = this.chain.then(() => this.write());
        return this.chain;
    }
    async write() {
        if (!this.dirty)
            return;
        const tmp = `${this.file}.tmp`;
        try {
            await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
            await fs.promises.writeFile(tmp, JSON.stringify({ version: exports.CACHE_VERSION, entries: Object.fromEntries(this.map) }));
            await fs.promises.rename(tmp, this.file);
            this.dirty = false;
        }
        catch {
            // an unwritable cache only costs a re-scan next start
        }
    }
}
exports.LibraryCache = LibraryCache;
//# sourceMappingURL=libraryCache.js.map