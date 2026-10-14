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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
async function waitFor(read, done, what, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const value = await read();
        if (done(value))
            return value;
        if (Date.now() > deadline)
            throw new Error(`Timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
}
suite('null-tools commit graph', () => {
    test('opens on a fixture repo, loads its commits with the HEAD marker, and opens a diff for a changed file', async function () {
        this.timeout(60_000);
        const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const git = (...args) => (0, child_process_1.execFileSync)('git', args, { cwd: folder, encoding: 'utf8' }).trim();
        git('init', '-q', '--initial-branch=main');
        git('config', 'user.email', 'spec@example.com');
        git('config', 'user.name', 'Spec');
        git('config', 'commit.gpgsign', 'false');
        fs.writeFileSync(path.join(folder, 'a.txt'), 'one');
        git('add', '--', 'a.txt');
        git('commit', '-q', '-m', 'first');
        fs.writeFileSync(path.join(folder, 'a.txt'), 'two');
        fs.writeFileSync(path.join(folder, 'b.txt'), 'b');
        git('add', '-A');
        git('commit', '-q', '-m', 'second');
        const head = git('rev-parse', 'HEAD');
        await vscode.extensions.getExtension('null.null-tools').activate();
        await vscode.commands.executeCommand('git.openRepository', folder);
        await vscode.commands.executeCommand('null.graph.open');
        const loaded = await waitFor(() => vscode.commands.executeCommand('_null.graph.snapshot'), (s) => s.rowCount >= 2, 'the first rows message');
        assert.strictEqual(loaded.rowCount, 2);
        assert.strictEqual(loaded.headSha, head, 'the checked-out branch is marked on the HEAD commit');
        await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'select', sha: head });
        await waitFor(() => vscode.commands.executeCommand('_null.graph.snapshot'), (s) => s.detailSha === head, 'the commit file list');
        await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'openDiff', sha: head, file: 'b.txt' });
        await waitFor(async () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some((t) => t.input instanceof vscode.TabInputTextDiff), (found) => found, 'a diff editor');
    });
    test('a message the host did not list is ignored instead of opening anything', async function () {
        this.timeout(20_000);
        const before = vscode.window.tabGroups.all.flatMap((g) => g.tabs).length;
        await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'openDiff', sha: 'f'.repeat(40), file: 'not-listed.txt' });
        await vscode.commands.executeCommand('_null.graph.dispatch', { type: 'select', sha: '--upload-pack=x' });
        assert.strictEqual(vscode.window.tabGroups.all.flatMap((g) => g.tabs).length, before);
    });
});
//# sourceMappingURL=graph.spec.js.map