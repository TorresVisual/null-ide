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
exports.registerCommands = registerCommands;
const vscode = __importStar(require("vscode"));
const privacy_1 = require("./privacy");
const SCHEME = 'null-activity';
function registerCommands(context, service, storageDir, dashboard) {
    const report = () => (0, privacy_1.trackedDataReport)({ storageDir, enabled: service.enabled, months: service.getMonthlyTotals() });
    context.subscriptions.push(
    // A content provider is read-only by construction; a fresh query per call forces a fresh read.
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, { provideTextDocumentContent: report }), vscode.commands.registerCommand('null-activity.openDashboard', () => dashboard.reveal()), vscode.commands.registerCommand('null-activity.showTrackedData', async () => {
        const uri = vscode.Uri.from({ scheme: SCHEME, path: '/Tracked data.txt', query: String(Date.now()) });
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { preview: true });
    }), vscode.commands.registerCommand('null-activity.deleteRange', async () => {
        const picks = [
            { label: 'Today', id: 'today' },
            { label: 'Last 7 days', id: 'last7' },
            { label: 'This month', id: 'month' },
            { label: 'Custom…', id: 'custom' },
        ];
        const pick = await vscode.window.showQuickPick(picks, { placeHolder: 'Delete tracked activity for…' });
        if (!pick)
            return;
        let range;
        let label = pick.label.toLowerCase();
        if (pick.id === 'custom') {
            const validateInput = (v) => ((0, privacy_1.parseDay)(v) === undefined ? 'Use YYYY-MM-DD' : undefined);
            const from = await vscode.window.showInputBox({ prompt: 'First day to delete (YYYY-MM-DD)', validateInput });
            if (!from)
                return;
            const to = await vscode.window.showInputBox({ prompt: 'Last day to delete, inclusive (YYYY-MM-DD)', value: from, validateInput });
            if (!to)
                return;
            range = (0, privacy_1.customRange)(from, to);
            if (!range) {
                void vscode.window.showErrorMessage('Null Activity: the last day is before the first day.');
                return;
            }
            label = `${from} to ${to}`;
        }
        else {
            range = (0, privacy_1.choiceRange)(pick.id, Date.now());
        }
        const answer = await vscode.window.showWarningMessage(`Delete tracked activity for ${label}? This cannot be undone.`, { modal: true }, 'Delete');
        if (answer !== 'Delete')
            return;
        try {
            service.deleteRange(range);
            void vscode.window.showInformationMessage(`Null Activity: deleted tracked activity for ${label}.`);
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Null Activity: could not delete data (${err instanceof Error ? err.message : String(err)}).`);
        }
    }), vscode.commands.registerCommand('null-activity.deleteAll', async () => {
        const answer = await vscode.window.showWarningMessage('Delete ALL tracked activity? This cannot be undone.', { modal: true }, 'Delete All');
        if (answer !== 'Delete All')
            return;
        try {
            service.deleteAll();
            void vscode.window.showInformationMessage('Null Activity: all tracked activity deleted.');
        }
        catch (err) {
            void vscode.window.showErrorMessage(`Null Activity: could not delete data (${err instanceof Error ? err.message : String(err)}).`);
        }
    }));
}
//# sourceMappingURL=commands.js.map