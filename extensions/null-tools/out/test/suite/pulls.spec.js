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
suite('null-tools pull requests', () => {
    test('registers its commands, reports no-repo for a folder without a GitHub origin, and never serves a hostile null-pr URI', async function () {
        this.timeout(60_000);
        const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        (0, child_process_1.execFileSync)('git', ['init', '-q', '--initial-branch=main'], { cwd: folder });
        await vscode.extensions.getExtension('null.null-tools').activate();
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['null.pulls.refresh', 'null.pulls.open', 'null.pulls.checkout', 'null.pulls.openOnGitHub', 'null.pulls.filter', 'null.pulls.resetFilter', 'null.pulls.openDetail']) {
            assert.ok(commands.includes(id), `${id} is registered`);
        }
        const snapshot = await vscode.commands.executeCommand('_null.pulls.snapshot');
        assert.deepStrictEqual(snapshot, { state: 'no-repo', pulls: 0 });
        // A traversal path never reaches the network: the provider answers with an empty document.
        const hostile = vscode.Uri.from({ scheme: 'null-pr', path: '/../../etc/passwd', query: 'o=..&r=x&n=1&s=a&h=b&d=LEFT' });
        assert.strictEqual((await vscode.workspace.openTextDocument(hostile)).getText(), '');
    });
});
//# sourceMappingURL=pulls.spec.js.map