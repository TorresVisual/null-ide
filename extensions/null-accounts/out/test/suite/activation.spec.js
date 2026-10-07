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
const vscode = __importStar(require("vscode"));
suite('null-accounts activation', () => {
    test('activates and exports a working API', async () => {
        const extension = vscode.extensions.getExtension('null.null-accounts');
        assert.ok(extension, 'null.null-accounts extension not found');
        const api = await extension.activate();
        assert.ok(api, 'activate() returned no API');
        // The run uses a fresh --user-data-dir, so no accounts exist yet.
        assert.deepStrictEqual(api.getAccounts(), []);
        assert.strictEqual(api.getAccountForFolder(vscode.Uri.file(process.cwd())), undefined);
        const stranger = { id: 'x', provider: 'github', host: 'github.com', username: 'u', email: 'u@e.com', authMethod: 'oauth' };
        assert.strictEqual(await api.getToken(stranger), undefined);
        // Phase 2: an unbound folder has no account, and a silent token request for an unknown
        // GitHub account (no externalId) resolves undefined instead of prompting or throwing.
        assert.strictEqual(typeof api.ensureAccountForFolder, 'function');
        assert.strictEqual(await api.getToken(stranger, ['repo'], { interactive: false }), undefined);
    });
    test('Phase 3: both commands are registered; the panel opens; switch with no folder resolves', async () => {
        await vscode.extensions.getExtension('null.null-accounts').activate();
        const commands = await vscode.commands.getCommands(true);
        assert.ok(commands.includes('null-accounts.open'), 'null-accounts.open not registered');
        assert.ok(commands.includes('null-accounts.switchAccount'), 'null-accounts.switchAccount not registered');
        await vscode.commands.executeCommand('null-accounts.open');
        // The tab model reaches the extension host asynchronously, so poll instead of reading it once.
        const tabLabels = () => vscode.window.tabGroups.all.flatMap(g => g.tabs.map(t => t.label));
        for (let i = 0; i < 50 && !tabLabels().includes('Null Accounts'); i++) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.ok(tabLabels().includes('Null Accounts'), `no Accounts tab among: ${tabLabels().join(', ')}`);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        if (!vscode.workspace.workspaceFolders?.length) {
            // Must show a message and return — not block on it, and not open a quick-pick.
            await vscode.commands.executeCommand('null-accounts.switchAccount');
        }
    });
});
//# sourceMappingURL=activation.spec.js.map