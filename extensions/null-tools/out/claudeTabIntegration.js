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
exports.registerClaudeTabFeature = registerClaudeTabFeature;
const vscode = __importStar(require("vscode"));
const FOCUS_GROUP_COMMANDS = [
    'workbench.action.focusFirstEditorGroup',
    'workbench.action.focusSecondEditorGroup',
    'workbench.action.focusThirdEditorGroup',
    'workbench.action.focusFourthEditorGroup',
    'workbench.action.focusFifthEditorGroup',
    'workbench.action.focusSixthEditorGroup',
    'workbench.action.focusSeventhEditorGroup',
    'workbench.action.focusEighthEditorGroup',
];
function registerClaudeTabFeature(context) {
    context.subscriptions.push(vscode.commands.registerCommand('null.focusClaudeTab', async () => {
        const claudeTabs = [];
        for (const group of vscode.window.tabGroups.all) {
            group.tabs.forEach((tab, index) => {
                if (tab.input instanceof vscode.TabInputWebview && tab.input.viewType === 'claudeVSCodePanel') {
                    claudeTabs.push({ label: tab.label, viewColumn: group.viewColumn, index });
                }
            });
        }
        if (!claudeTabs.length) {
            vscode.window.showInformationMessage('No open Claude Code tabs.');
            return;
        }
        const pick = await vscode.window.showQuickPick(claudeTabs.map(tab => ({ label: tab.label, tab })), { placeHolder: 'Go to open Claude chat…' });
        if (!pick)
            return;
        const focusCommand = FOCUS_GROUP_COMMANDS[pick.tab.viewColumn - 1];
        if (focusCommand)
            await vscode.commands.executeCommand(focusCommand);
        await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', pick.tab.index);
    }));
}
//# sourceMappingURL=claudeTabIntegration.js.map