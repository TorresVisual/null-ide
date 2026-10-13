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
    // null-sync lists null-accounts in extensionDependencies, so the vanilla host must load it too.
    const extensionDevelopmentPath = ['null-sync', 'null-accounts'].map(name => {
        const dir = path.join(installDir, 'resources', 'app', 'extensions', name);
        if (!fs.existsSync(dir)) {
            throw new Error(`Synced ${name} not found at '${dir}'. Run scripts/sync-local.ps1 first.`);
        }
        return dir;
    });
    // Null IDE's own executable can't host this run: its product.json bakes in a fixed win32MutexName, so the
    // single-instance mutex collides with the window this is usually launched from. A separate vanilla VS Code
    // build has a different product identity; the synced extensions are loaded into it via extensionDevelopmentPath.
    const vscodeExecutablePath = await (0, test_electron_1.downloadAndUnzipVSCode)('stable');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
    const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-spec-workspace-'));
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-spec-userdata-'));
    const extensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-spec-extensions-'));
    // If set, this forces any Electron binary to run as plain Node instead of launching the app, which breaks the
    // GUI launch this harness needs; it can be inherited from an Electron-based parent (e.g. an IDE terminal).
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
        // VS Code's child processes can hold the profile briefly after runTests() settles; cleanup must never mask the spec result.
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