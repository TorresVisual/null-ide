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
exports.SnapshotStore = void 0;
exports.widgetsDir = widgetsDir;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** %LOCALAPPDATA%\Null\widgets. Local (not roaming): the file is derived data and the widgets host is per machine. */
function widgetsDir(env = process.env) {
    if (!env.LOCALAPPDATA) {
        throw new Error('Cannot locate %LOCALAPPDATA%.');
    }
    return path.win32.join(env.LOCALAPPDATA, 'Null', 'widgets');
}
class SnapshotStore {
    dir;
    file;
    tmp;
    constructor(dir) {
        this.dir = dir;
        this.file = path.join(dir, 'snapshot.json');
        this.tmp = `${this.file}.tmp`;
    }
    /** Write-then-rename, so null_widgets.exe never reads a torn file. Only the owning window writes, so one fixed .tmp name is enough. */
    write(snapshot) {
        fs.mkdirSync(this.dir, { recursive: true });
        fs.writeFileSync(this.tmp, JSON.stringify(snapshot), 'utf8');
        fs.renameSync(this.tmp, this.file);
    }
    remove() {
        for (const f of [this.file, this.tmp]) {
            try {
                fs.unlinkSync(f);
            }
            catch (err) {
                if (err.code !== 'ENOENT') {
                    throw err;
                }
            }
        }
    }
}
exports.SnapshotStore = SnapshotStore;
//# sourceMappingURL=widgetStore.js.map