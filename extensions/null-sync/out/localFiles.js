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
exports.LocalFiles = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const layout_1 = require("./layout");
const KEEP_BACKUPS = 10;
/** The synced files on disk. Every name goes through `isSyncableFile`, so a hostile remote name can never reach the file system. */
class LocalFiles {
    options;
    constructor(options) {
        this.options = options;
    }
    pathOf(file) {
        if (!(0, layout_1.isSyncableFile)(file))
            throw new Error(`Refusing to touch '${file}'.`);
        return path.join(this.options.userDir, ...file.split('/'));
    }
    isDirty(file) {
        return this.options.isDirty(this.pathOf(file));
    }
    /** `null` if the file does not exist. */
    async read(file) {
        try {
            return await fs.promises.readFile(this.pathOf(file), 'utf8');
        }
        catch (err) {
            if (err.code === 'ENOENT')
                return null;
            throw err;
        }
    }
    /** Raw contents of every existing synced file in the given categories. */
    async list(categories) {
        const found = {};
        const add = async (file) => {
            try {
                const text = await this.read(file);
                if (text !== null)
                    found[file] = text;
            }
            catch {
                /* unreadable (for example a folder named x.json): not a synced file */
            }
        };
        for (const file of layout_1.CORE_FILES) {
            if (categories.includes((0, layout_1.categoryOf)(file)))
                await add(file);
        }
        if (categories.includes('snippets')) {
            let names = [];
            try {
                names = await fs.promises.readdir(path.join(this.options.userDir, 'snippets'));
            }
            catch {
                /* no snippets folder */
            }
            for (const name of names) {
                if ((0, layout_1.isSyncableFile)(`snippets/${name}`))
                    await add(`snippets/${name}`);
            }
        }
        return found;
    }
    /** Writes atomically (temp file + rename) after backing up what is there; `null` deletes the file. */
    async write(file, content) {
        const target = this.pathOf(file);
        await this.backup(file, target);
        if (content === null) {
            await fs.promises.rm(target, { force: true });
            return;
        }
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        const temp = `${target}.null-sync.tmp`;
        await fs.promises.writeFile(temp, content, 'utf8');
        await fs.promises.rename(temp, target);
    }
    async backup(file, target) {
        if (!fs.existsSync(target))
            return;
        const { backupsDir, now } = this.options;
        await fs.promises.mkdir(backupsDir, { recursive: true });
        const stem = file.replace('/', '__');
        await fs.promises.copyFile(target, path.join(backupsDir, `${stem}.${now()}`));
        const stamp = (name) => {
            const rest = name.startsWith(`${stem}.`) ? name.slice(stem.length + 1) : '';
            return /^\d+$/.test(rest) ? Number(rest) : undefined;
        };
        const mine = (await fs.promises.readdir(backupsDir))
            .filter((name) => stamp(name) !== undefined)
            .sort((a, b) => stamp(b) - stamp(a));
        for (const old of mine.slice(KEEP_BACKUPS))
            await fs.promises.rm(path.join(backupsDir, old), { force: true });
    }
}
exports.LocalFiles = LocalFiles;
//# sourceMappingURL=localFiles.js.map