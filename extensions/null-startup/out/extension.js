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
exports.activate = activate;
exports.deactivate = deactivate;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const capture_1 = require("./capture");
const commands_1 = require("./commands");
const reportPanel_1 = require("./reportPanel");
const reportStore_1 = require("./reportStore");
const settings_1 = require("./settings");
const snapshotSource_1 = require("./snapshotSource");
function activate(context) {
    const output = vscode.window.createOutputChannel('Null Startup');
    const log = (message) => output.appendLine(message);
    const config = () => vscode.workspace.getConfiguration('null-startup');
    const store = new reportStore_1.ReportStore({
        dir: path.join(context.globalStorageUri.fsPath, 'reports'),
        fs: {
            mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
            readdir: (dir) => fs.readdir(dir),
            readFile: (file) => fs.readFile(file, 'utf8'),
            writeFile: (file, data) => fs.writeFile(file, data, 'utf8'),
            unlink: (file) => fs.unlink(file),
        },
        retention: () => (0, settings_1.normalizeRetention)(config().get('retention')),
        log,
    });
    const slowMs = () => (0, settings_1.normalizeSlowMs)(config().get('slowExtensionMs'));
    const panel = new reportPanel_1.ReportPanel(context, store, slowMs);
    context.subscriptions.push(output, panel);
    (0, commands_1.registerCommands)(context, store, panel, slowMs);
    if (config().get('enabled') === false)
        return;
    const capture = new capture_1.Capture({
        snapshot: () => (0, snapshotSource_1.takeSnapshot)(log),
        save: (report) => store.save(report),
        now: () => Date.now(),
        windowId: crypto.randomBytes(4).toString('hex'),
        schedule: (fn, ms) => {
            const t = setTimeout(fn, ms);
            return { dispose: () => clearTimeout(t) };
        },
        log,
        onSaved: () => panel.refresh(),
    });
    context.subscriptions.push({ dispose: () => capture.dispose() });
    void capture.run();
}
function deactivate() { }
//# sourceMappingURL=extension.js.map