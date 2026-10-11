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
exports.registerImport = registerImport;
const fs = __importStar(require("fs"));
const vscode = __importStar(require("vscode"));
const wakatimeImport_1 = require("./wakatimeImport");
const wakatimeProjects_1 = require("./wakatimeProjects");
async function pickExport(service) {
    const [uri] = (await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'WakaTime export': ['json'] },
        openLabel: 'Import',
        title: 'Choose your WakaTime export (.json)',
    })) ?? [];
    if (!uri)
        return undefined;
    if (service.hasImport()) {
        const answer = await vscode.window.showWarningMessage('Replace the previous WakaTime import?', { modal: true, detail: 'Time tracked natively is not affected.' }, 'Replace');
        if (answer !== 'Replace')
            return undefined;
    }
    return uri;
}
function registerImport(context, service, log) {
    context.subscriptions.push(vscode.commands.registerCommand('null-activity.importWakaTime', async (file) => {
        // A caller that passes the file (a spec, another command) has already decided: no dialogs.
        const source = file ?? (await pickExport(service));
        if (!source)
            return;
        try {
            const summary = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Importing WakaTime history…' }, async () => {
                const text = await fs.promises.readFile(source.fsPath, 'utf8');
                // ponytail: sync parse + convert block the extension host for a few seconds on a ~70 MB export; stream if that hurts.
                const { intervals, summary } = (0, wakatimeImport_1.convertExport)(JSON.parse(text), wakatimeProjects_1.diskProjectResolver);
                service.replaceImported(intervals); // only after conversion succeeded
                return summary;
            });
            void vscode.window.showInformationMessage(`Null Activity: ${(0, wakatimeImport_1.formatSummary)(summary)}`);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`WakaTime import failed: ${message}`);
            void vscode.window.showErrorMessage(`Null Activity: WakaTime import failed. ${message}`);
        }
    }));
}
//# sourceMappingURL=importCommand.js.map