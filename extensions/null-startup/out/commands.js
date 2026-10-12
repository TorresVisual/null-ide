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
const exportReport_1 = require("./exportReport");
const format_1 = require("./format");
function registerCommands(context, store, panel, slowMs) {
    const none = () => vscode.window.showInformationMessage('No startup report has been recorded yet.');
    context.subscriptions.push(vscode.commands.registerCommand('null-startup.openReport', () => panel.reveal()), vscode.commands.registerCommand('null-startup.copyReport', async () => {
        const report = await panel.selectedReport();
        if (!report)
            return void none();
        await vscode.env.clipboard.writeText((0, exportReport_1.reportToMarkdown)(report, slowMs()));
        void vscode.window.showInformationMessage('Startup report copied to the clipboard.');
    }), vscode.commands.registerCommand('null-startup.exportReport', async () => {
        const report = await panel.selectedReport();
        if (!report)
            return void none();
        const name = `null-startup-${(0, format_1.stamp)(report.takenAt).replace(/[: ]/g, '-')}.json`;
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(name), filters: { JSON: ['json'] } });
        if (!target)
            return;
        await vscode.workspace.fs.writeFile(target, Buffer.from((0, exportReport_1.reportToJson)(report), 'utf8'));
    }), vscode.commands.registerCommand('null-startup.clearHistory', async () => {
        const confirm = await vscode.window.showWarningMessage('Delete all stored startup reports?', { modal: true }, 'Delete');
        if (confirm !== 'Delete')
            return;
        await store.clear();
        panel.refresh();
    }));
}
//# sourceMappingURL=commands.js.map