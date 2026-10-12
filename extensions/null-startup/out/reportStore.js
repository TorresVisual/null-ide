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
exports.ReportStore = void 0;
const path = __importStar(require("path"));
const types_1 = require("./types");
function isReport(v) {
    const r = v;
    return (typeof r === 'object' && r !== null && r.schemaVersion === types_1.SCHEMA_VERSION && typeof r.id === 'string' &&
        typeof r.takenAt === 'number' && Array.isArray(r.milestones) && Array.isArray(r.phases) && Array.isArray(r.extensions));
}
/** One JSON file per launch and window. Files that do not parse as a current report are left alone. */
class ReportStore {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    fileFor(id) {
        return path.join(this.deps.dir, `${id.replace(/[^\w.-]/g, '_')}.json`);
    }
    async save(report) {
        await this.deps.fs.mkdir(this.deps.dir);
        await this.deps.fs.writeFile(this.fileFor(report.id), JSON.stringify(report));
        await this.prune();
    }
    /** Newest first. */
    async list() {
        return (await this.readAll()).map((e) => e.report).sort((a, b) => b.takenAt - a.takenAt);
    }
    async clear() {
        for (const { file } of await this.readAll())
            await this.deps.fs.unlink(file).catch(() => undefined);
    }
    async prune() {
        const all = (await this.readAll()).sort((a, b) => b.report.takenAt - a.report.takenAt);
        for (const { file } of all.slice(Math.max(1, this.deps.retention())))
            await this.deps.fs.unlink(file).catch(() => undefined);
    }
    async readAll() {
        let names;
        try {
            names = await this.deps.fs.readdir(this.deps.dir);
        }
        catch {
            return [];
        }
        const out = [];
        for (const name of names.filter((n) => n.endsWith('.json'))) {
            const file = path.join(this.deps.dir, name);
            try {
                const parsed = JSON.parse(await this.deps.fs.readFile(file));
                if (isReport(parsed))
                    out.push({ file, report: parsed });
            }
            catch (err) {
                this.deps.log(`skipping unreadable report ${name}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
        return out;
    }
}
exports.ReportStore = ReportStore;
//# sourceMappingURL=reportStore.js.map