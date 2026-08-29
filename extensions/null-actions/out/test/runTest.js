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
    const extensionDevelopmentPath = path.join(installDir, 'resources', 'app', 'extensions', 'null-actions');
    if (!fs.existsSync(extensionDevelopmentPath)) {
        throw new Error(`Synced null-actions not found at '${extensionDevelopmentPath}'. Run scripts/sync-local.ps1 first.`);
    }
    // Null IDE's own executable can't host this run: its product.json bakes
    // in a fixed win32MutexName ("nullide"), shared by every build regardless
    // of install path, and this harness is typically invoked from inside an
    // already-running Null IDE window (e.g. its own integrated agent
    // terminal) - so the OS-level single-instance mutex always collides and
    // the second instance's window gets force-closed mid-test. A cloned copy
    // of the install would embed the identical product.json and hit the same
    // collision. Downloading a separate vanilla VS Code build sidesteps this
    // (different product identity, different mutex) while still loading and
    // testing the exact synced null-actions extension code below via
    // extensionDevelopmentPath.
    const vscodeExecutablePath = await (0, test_electron_1.downloadAndUnzipVSCode)('stable');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-spec-workspace-'));
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-spec-userdata-'));
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-actions-spec-extensions-'));
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
        fs.rmSync(workspaceDir, { recursive: true, force: true });
        fs.rmSync(userDataDir, { recursive: true, force: true });
        fs.rmSync(extensionsDir, { recursive: true, force: true });
    }
}
main().catch(err => {
    console.error('Failed to run integration specs');
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=runTest.js.map