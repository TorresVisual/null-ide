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
const assert = __importStar(require("assert"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dashboardTabs = () => vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith('null-activity.dashboard'));
/** The ext-host tab model lags the main thread, so wait for the expected count instead of reading it once. */
async function tabCount(expected) {
    for (let i = 0; i < 50 && dashboardTabs().length !== expected; i++)
        await sleep(100);
    return dashboardTabs().length;
}
suite('null-activity dashboard', () => {
    test('openDashboard opens one reused panel that survives data changes and reopens after close', async function () {
        this.timeout(30_000);
        await vscode.extensions.getExtension('null.null-activity').activate();
        assert.ok((await vscode.commands.getCommands(true)).includes('null-activity.openDashboard'), 'command not registered');
        await vscode.commands.executeCommand('null-activity.openDashboard');
        assert.strictEqual(await tabCount(1), 1);
        await vscode.commands.executeCommand('null-activity.openDashboard');
        await sleep(300); // give a wrongly opened second tab time to show up
        assert.strictEqual(await tabCount(1), 1, 'a second call must reveal the same panel, not open another');
        // Editing a file fires onDidChange -> the throttled push; it must not break or close the panel.
        const file = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, 'dashboard-spec.txt');
        fs.writeFileSync(file, '');
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
        await editor.edit((b) => b.insert(new vscode.Position(0, 0), 'hello\n'));
        await sleep(1_500);
        assert.strictEqual(await tabCount(1), 1);
        await vscode.window.tabGroups.close(dashboardTabs());
        assert.strictEqual(await tabCount(0), 0);
        await vscode.commands.executeCommand('null-activity.openDashboard');
        assert.strictEqual(await tabCount(1), 1, 'the panel must open again after being closed');
        await vscode.window.tabGroups.close(dashboardTabs());
    });
});
//# sourceMappingURL=dashboard.spec.js.map