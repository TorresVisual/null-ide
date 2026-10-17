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
exports.registerFirstRunFeature = registerFirstRunFeature;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const firstRun_1 = require("./firstRun");
const INSTALL_TIMEOUT_MS = 120_000;
function registerFirstRunFeature(context) {
    const appData = process.env.APPDATA;
    if (!appData) {
        return;
    }
    const file = path.join(appData, 'Null', 'null-setup', 'first-run.json');
    const output = vscode.window.createOutputChannel('Null Setup');
    context.subscriptions.push(output);
    const host = {
        read() {
            try {
                return fs.readFileSync(file, 'utf8');
            }
            catch (err) {
                if (err.code !== 'ENOENT') {
                    output.appendLine(`cannot read ${file}: ${err.message}`);
                }
                return undefined;
            }
        },
        remove() {
            try {
                fs.rmSync(file, { force: true });
            } // force: another window may have deleted it already
            catch (err) {
                output.appendLine(`cannot delete ${file}: ${err.message}`);
            }
        },
        // globalValue, not get(): a default from product.json / null-theme is not the user's choice, and false/0/"" are values.
        hasUserValue: key => vscode.workspace.getConfiguration().inspect(key)?.globalValue !== undefined,
        setSetting: async (key, value) => { await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global); },
        installExtension: async (id) => { await vscode.commands.executeCommand('workbench.extensions.installExtension', id); },
        log: m => output.appendLine(m),
    };
    const notifyFailed = (ids) => {
        if (ids.length === 0) {
            return;
        }
        const n = ids.length;
        void vscode.window
            .showWarningMessage(`${n} extension${n === 1 ? '' : 's'} chosen during setup could not be installed.`, 'Retry')
            .then(async (choice) => { if (choice === 'Retry') {
            notifyFailed(await (0, firstRun_1.installAll)(host, ids, INSTALL_TIMEOUT_MS));
        } });
    };
    (0, firstRun_1.runFirstRun)(host, INSTALL_TIMEOUT_MS)
        .then(result => notifyFailed(result?.failedExtensions ?? []))
        .catch(err => output.appendLine(`first run failed: ${err.message}`));
}
//# sourceMappingURL=firstRunIntegration.js.map