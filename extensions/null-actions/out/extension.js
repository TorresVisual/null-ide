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
const vscode = __importStar(require("vscode"));
const buttonConfigIntegration_1 = require("./buttonConfigIntegration");
const terminalHostIntegration_1 = require("./terminalHostIntegration");
const terminalRegistry_1 = require("./terminalRegistry");
const statusBarController_1 = require("./statusBarController");
const runButton_1 = require("./runButton");
const settingsPanel_1 = require("./settingsPanel");
function activate(context) {
    const terminalRegistry = new terminalRegistry_1.TerminalRegistry(new terminalHostIntegration_1.VscodeTerminalHost());
    const statusBar = new statusBarController_1.StatusBarController();
    context.subscriptions.push(statusBar, terminalRegistry.onDidChangeState((id, state) => statusBar.setState(id, state)));
    // Slightly above the default button priority (0) so this renders just
    // ahead of the user's own buttons -- not pushed to the front of the
    // whole status bar, just leftmost among null-actions' own items.
    const openSettingsItem = vscode.window.createStatusBarItem('null-actions.openSettings', vscode.StatusBarAlignment.Left, 1);
    openSettingsItem.text = '$(gear)';
    openSettingsItem.tooltip = 'Open Action Buttons Settings';
    openSettingsItem.command = 'null-actions.openSettings';
    openSettingsItem.show();
    context.subscriptions.push(openSettingsItem);
    context.subscriptions.push(vscode.commands.registerCommand('null-actions.openSettings', () => {
        settingsPanel_1.ActionButtonsPanel.createOrShow(context.extensionUri);
    }));
    let knownIds = new Set();
    let lastErrors = '';
    function refresh() {
        const { buttons, errors } = (0, buttonConfigIntegration_1.readButtonConfigs)();
        statusBar.update(buttons);
        const ids = new Set(buttons.map(b => b.id));
        knownIds.forEach(id => { if (!ids.has(id)) {
            terminalRegistry.forget(id);
        } });
        knownIds = ids;
        // One warning per distinct problem set, not one per settings change.
        const summary = errors.join('\n');
        if (summary !== lastErrors) {
            lastErrors = summary;
            if (summary) {
                const more = errors.length > 1 ? ` (+${errors.length - 1} more)` : '';
                void vscode.window.showWarningMessage(`Some Null Actions buttons are ignored: ${errors[0]}${more}`, 'Open Settings')
                    .then(pick => { if (pick) {
                    void vscode.commands.executeCommand('null-actions.openSettings');
                } });
            }
        }
    }
    context.subscriptions.push(vscode.commands.registerCommand('null-actions.runButton', async (buttonId) => {
        const { buttons } = (0, buttonConfigIntegration_1.readButtonConfigs)();
        const button = buttons.find(b => b.id === buttonId);
        if (!button) {
            return;
        }
        if (statusBar.showsFailure(button.id)) {
            terminalRegistry.show(button.id);
            return;
        }
        await (0, runButton_1.runButton)(button, terminalRegistry);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('null-actions')) {
            refresh();
            settingsPanel_1.ActionButtonsPanel.refreshIfOpen();
        }
    }));
    refresh();
}
function deactivate() { }
//# sourceMappingURL=extension.js.map