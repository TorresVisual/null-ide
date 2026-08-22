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
const whenClause_1 = require("./whenClause");
const runButton_1 = require("./runButton");
const settingsPanel_1 = require("./settingsPanel");
const npmScriptsProvider_1 = require("./npmScriptsProvider");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function activate(context) {
    const terminalRegistry = new terminalRegistry_1.TerminalRegistry(new terminalHostIntegration_1.VscodeTerminalHost());
    const statusBar = new statusBarController_1.StatusBarController();
    context.subscriptions.push(statusBar);
    const openSettingsItem = vscode.window.createStatusBarItem('null-actions.openSettings', vscode.StatusBarAlignment.Right, -1000);
    openSettingsItem.text = '$(gear) Actions';
    openSettingsItem.tooltip = 'Open Action Buttons Settings';
    openSettingsItem.command = 'null-actions.openSettings';
    openSettingsItem.show();
    context.subscriptions.push(openSettingsItem);
    context.subscriptions.push(vscode.commands.registerCommand('null-actions.openSettings', () => {
        settingsPanel_1.ActionButtonsPanel.createOrShow();
    }));
    function loadNpmButtons() {
        const auto = vscode.workspace.getConfiguration().get('null-actions.npm.autoLoad', false);
        if (!auto) {
            return [];
        }
        const folder = vscode.workspace.workspaceFolders?.[0];
        if (!folder) {
            return [];
        }
        const pkgPath = path.join(folder.uri.fsPath, 'package.json');
        if (!fs.existsSync(pkgPath)) {
            return [];
        }
        let content;
        try {
            content = fs.readFileSync(pkgPath, 'utf8');
        }
        catch {
            return [];
        }
        return (0, npmScriptsProvider_1.parseNpmScripts)(content).map((s, i) => (0, npmScriptsProvider_1.toActionButtonConfig)(s, -i));
    }
    function refresh() {
        const { buttons } = (0, buttonConfigIntegration_1.readButtonConfigs)();
        const npmButtons = loadNpmButtons();
        const folder = vscode.workspace.workspaceFolders?.[0];
        const ctx = {
            activeLanguageId: vscode.window.activeTextEditor?.document.languageId,
            folderName: folder?.name,
            folderPath: folder?.uri.fsPath,
        };
        const visible = [...buttons, ...npmButtons].filter(b => (0, whenClause_1.evaluateWhenClause)(b.when, ctx));
        statusBar.update(visible);
    }
    context.subscriptions.push(vscode.commands.registerCommand('null-actions.runButton', async (buttonId) => {
        const { buttons } = (0, buttonConfigIntegration_1.readButtonConfigs)();
        const npmButtons = loadNpmButtons();
        const button = [...buttons, ...npmButtons].find(b => b.id === buttonId);
        if (!button) {
            return;
        }
        await (0, runButton_1.runButton)(button, terminalRegistry);
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('null-actions')) {
            refresh();
            settingsPanel_1.ActionButtonsPanel.refreshIfOpen();
        }
    }), vscode.window.onDidChangeActiveTextEditor(() => refresh()), vscode.workspace.onDidChangeWorkspaceFolders(() => refresh()));
    refresh();
}
function deactivate() { }
//# sourceMappingURL=extension.js.map