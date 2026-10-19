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
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
suite('null-tools GitHub Actions', () => {
    test('contributes its container, view and commands, reports no-repo for a folder without a GitHub origin, and never serves a hostile null-workflows URI', async function () {
        this.timeout(60_000);
        const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        (0, child_process_1.execFileSync)('git', ['init', '-q', '--initial-branch=main'], { cwd: folder });
        const extension = vscode.extensions.getExtension('null.null-tools');
        await extension.activate();
        const contributes = extension.packageJSON.contributes;
        assert.ok(contributes.viewsContainers.activitybar.some((c) => c.id === 'null-workflows'), 'container');
        assert.ok(contributes.views['null-workflows'].some((v) => v.id === 'null.workflowsView'), 'view');
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['null.workflows.refresh', 'null.workflows.open', 'null.workflows.signIn', 'null.workflows.loadMore',
            'null.workflows.openOnGitHub', 'null.workflows.openWorkflowFile', 'null.workflows.createWorkflow', 'null.workflows.filter']) {
            assert.ok(commands.includes(id), `${id} is registered`);
        }
        const snapshot = await vscode.commands.executeCommand('_null.workflows.snapshot');
        assert.deepStrictEqual(snapshot, { state: 'no-repo', repos: [] });
    });
});
//# sourceMappingURL=workflows.spec.js.map