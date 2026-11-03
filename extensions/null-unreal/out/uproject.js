"use strict";
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
exports.ResolveError = void 0;
exports.resolveProject = resolveProject;
const path = __importStar(require("node:path"));
// Exit-code-2 errors: usage or resolution problems the caller can act on.
class ResolveError extends Error {
}
exports.ResolveError = ResolveError;
function uprojectsIn(dir, fs) {
    return fs.readdir(dir)
        .filter((n) => n.toLowerCase().endsWith('.uproject'))
        .map((n) => path.join(dir, n));
}
function pickOne(dir, found) {
    if (found.length === 1)
        return found[0];
    if (found.length === 0)
        throw new ResolveError(`no .uproject in ${dir}; pass --project <file>`);
    const names = found.map((f) => path.basename(f)).join(', ');
    throw new ResolveError(`several .uproject files in ${dir} (${names}); pass --project <file>`);
}
function load(file, fs) {
    let json;
    try {
        json = JSON.parse(fs.readFile(file).replace(/^\uFEFF/, ''));
    }
    catch (e) {
        throw new ResolveError(`could not read ${file}: ${e.message}`);
    }
    return {
        file,
        dir: path.dirname(file),
        name: path.basename(file, '.uproject'),
        engineAssociation: typeof json?.EngineAssociation === 'string' ? json.EngineAssociation : '',
    };
}
function resolveProject(cwd, explicit, fs) {
    if (explicit !== undefined) {
        const p = path.resolve(cwd, explicit);
        if (p.toLowerCase().endsWith('.uproject')) {
            if (!fs.exists(p))
                throw new ResolveError(`no such project file: ${p}`);
            return load(p, fs);
        }
        if (!fs.exists(p))
            throw new ResolveError(`no such project directory: ${p}`);
        return load(pickOne(p, uprojectsIn(p, fs)), fs);
    }
    let dir = path.resolve(cwd);
    for (;;) {
        const found = uprojectsIn(dir, fs);
        if (found.length > 0)
            return load(pickOne(dir, found), fs);
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new ResolveError(`no .uproject found from ${cwd} up to the drive root; pass --project <file>`);
        }
        dir = parent;
    }
}
//# sourceMappingURL=uproject.js.map