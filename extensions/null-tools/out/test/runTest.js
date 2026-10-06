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
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const test_electron_1 = require("@vscode/test-electron");
async function main() {
    const installDir = process.env.NULL_IDE_INSTALL_DIR
        ?? path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Null IDE');
    // null-tools lists null-accounts in extensionDependencies, so the vanilla host must load it too.
    const extensionDevelopmentPath = ['null-tools', 'null-accounts'].map(name => {
        const dir = path.join(installDir, 'resources', 'app', 'extensions', name);
        if (!fs.existsSync(dir)) {
            throw new Error(`Synced ${name} not found at '${dir}'. Run scripts/sync-local.ps1 first.`);
        }
        return dir;
    });
    // Null IDE's own executable can't host this run: its product.json bakes
    // in a fixed win32MutexName ("nullide"), shared by every build regardless
    // of install path, and this harness is typically invoked from inside an
    // already-running Null IDE window (e.g. its own integrated agent
    // terminal) - so the OS-level single-instance mutex always collides and
    // the second instance's window gets force-closed mid-test. A cloned copy
    // of the install would embed the identical product.json and hit the same
    // collision. Downloading a separate vanilla VS Code build sidesteps this
    // (different product identity, different mutex) while still loading and
    // testing the exact synced null-tools extension code below via
    // extensionDevelopmentPath.
    const vscodeExecutablePath = await (0, test_electron_1.downloadAndUnzipVSCode)('stable');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-tools-spec-workspace-'));
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-tools-spec-userdata-'));
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-tools-spec-extensions-'));
    // null-tools rewrites these global settings on every activation
    // (disableRestrictedMode / ensureWindowTitleFormat). In a fresh profile
    // that write races the end of the run and makes the host exit 1 even when
    // every spec passed, so pre-seed the values it would otherwise write.
    fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
        'security.workspace.trust.enabled': false,
        'security.workspace.trust.startupPrompt': 'never',
        'security.workspace.trust.untrustedFiles': 'open',
        'security.workspace.trust.emptyWindow': false,
        'window.title': '${dirty}${rootName} - ${activeEditorShort}',
    }));
    // If set, this forces any Electron binary to run as plain Node instead of
    // launching the app - breaks the actual GUI launch this harness needs.
    // Can be inherited from an Electron-based parent process (e.g. an IDE's
    // own integrated terminal), so clear it here rather than relying on the
    // caller's shell to be clean.
    delete process.env.ELECTRON_RUN_AS_NODE;
    try {
        await (0, test_electron_1.runTests)({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspaceDir,
                '--user-data-dir', userDataDir,
                '--extensions-dir', extensionsDir,
            ],
        });
    }
    finally {
        // VS Code's child processes (agent host etc.) can still hold the profile
        // for a moment after runTests() settles; cleanup must never mask the
        // spec result.
        for (const dir of [workspaceDir, userDataDir, extensionsDir]) {
            try {
                fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
            }
            catch (err) {
                console.warn(`Could not remove temp dir ${dir}: ${err.message}`);
            }
        }
    }
}
main().catch(err => {
    console.error('Failed to run integration specs');
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=runTest.js.map