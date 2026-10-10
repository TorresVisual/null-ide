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
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const helpers_1 = require("./helpers");
suite('null-accounts commit signing', () => {
    test('an account that signs makes git sign the commits in a bound repo, and unbinding takes it back', async function () {
        this.timeout(30_000);
        await vscode.extensions.getExtension('null.null-accounts').activate();
        const repo = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        assert.ok(repo, 'the run opens a temp workspace folder');
        const keyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-accounts-spec-key-'));
        const keyFile = path.join(keyDir, 'id_spec');
        try {
            (0, child_process_1.execFileSync)('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', 'sign-user@example.test', '-f', keyFile, '-q']);
            (0, child_process_1.execFileSync)('git', ['init', '-q'], { cwd: repo });
            const account = {
                provider: 'gitlab', host: 'git.sign.test', username: 'sign-user', email: 'sign-user@example.test',
                authMethod: 'ssh', sshKeyPath: keyFile, signCommits: true,
            };
            const added = await vscode.commands.executeCommand('null-accounts.test.addAccount', account);
            await vscode.commands.executeCommand('null-accounts.bindFolderToAccount', added.id);
            await (0, helpers_1.waitFor)('signing to be written into the repo', () => (0, helpers_1.git)(repo, 'config', '--local', 'gpg.format') === 'ssh'
                && (0, helpers_1.git)(repo, 'config', '--local', 'commit.gpgsign') === 'true'
                && (0, helpers_1.git)(repo, 'config', '--local', 'user.signingkey') === keyFile.replace(/\\/g, '/'));
            // Plain `git commit`, as the editor's Source Control view or a terminal would run it.
            (0, child_process_1.execFileSync)('git', ['commit', '--allow-empty', '-q', '-m', 'signed by the integration spec'], { cwd: repo });
            assert.match((0, child_process_1.execFileSync)('git', ['cat-file', '-p', 'HEAD'], { cwd: repo, encoding: 'utf8' }), /gpgsig -----BEGIN SSH SIGNATURE-----/);
            await vscode.commands.executeCommand('null-accounts.test.removeAccount', added.id);
            await (0, helpers_1.waitFor)('signing to be taken back out of the repo', () => (0, helpers_1.git)(repo, 'config', '--local', 'commit.gpgsign') === '' && (0, helpers_1.git)(repo, 'config', '--local', 'gpg.format') === '');
        }
        finally {
            fs.rmSync(keyDir, { recursive: true, force: true });
        }
    });
});
//# sourceMappingURL=signing.spec.js.map