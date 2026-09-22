"use strict";
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
exports.RustfmtFormattingEditProvider = void 0;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const diffUtils_1 = require("./diffUtils");
const configResolver_1 = require("./configResolver");
const toolchainDiscovery_1 = require("./toolchainDiscovery");
class RustfmtFormattingEditProvider {
    extensionPath;
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
    }
    async provideDocumentFormattingEdits(document, _options, token) {
        const config = vscode.workspace.getConfiguration('null-format.rustfmt');
        const enabled = config.get('enable', true);
        if (!enabled || token.isCancellationRequested) {
            return [];
        }
        const configuredExe = config.get('path');
        const exePath = (0, toolchainDiscovery_1.findRustfmtPath)(configuredExe, this.extensionPath);
        if (!exePath) {
            vscode.window.showWarningMessage('Null IDE: rustfmt was not found. Please install Rust (rustup component add rustfmt) or configure null-format.rustfmt.path.');
            return [];
        }
        const filePath = document.isUntitled ? undefined : document.fileName;
        const workspaceFolder = filePath ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath : undefined;
        const customConfigPath = config.get('configPath');
        const defaultConfigToml = config.get('defaultConfig');
        const configResolution = (0, configResolver_1.resolveRustfmtConfig)(filePath || 'untitled.rs', customConfigPath, defaultConfigToml, workspaceFolder);
        const args = ['--emit', 'stdout'];
        if (configResolution.configPath) {
            args.push('--config-path', configResolution.configPath);
        }
        else if (configResolution.inlineOptions && configResolution.inlineOptions.length > 0) {
            args.push('--config', configResolution.inlineOptions);
        }
        const text = document.getText();
        const cwd = filePath ? path.dirname(filePath) : (workspaceFolder || process.cwd());
        try {
            const formatted = await this.executeRustfmt(exePath, args, cwd, text, token);
            if (token.isCancellationRequested || formatted === text) {
                return [];
            }
            const minimalEdits = (0, diffUtils_1.computeMinimalEdits)(text, formatted);
            return minimalEdits.map((edit) => new vscode.TextEdit(new vscode.Range(new vscode.Position(edit.startLine, edit.startChar), new vscode.Position(edit.endLine, edit.endChar)), edit.newText));
        }
        catch (err) {
            console.error('[null-format] rustfmt execution failed:', err);
            vscode.window.showWarningMessage(`rustfmt error: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    executeRustfmt(exePath, args, cwd, input, token) {
        return new Promise((resolve, reject) => {
            const proc = cp.spawn(exePath, args, {
                cwd,
                windowsHide: true,
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (chunk) => {
                stdout += chunk.toString();
            });
            proc.stderr.on('data', (chunk) => {
                stderr += chunk.toString();
            });
            const cancelListener = token.onCancellationRequested(() => {
                try {
                    proc.kill();
                }
                catch {
                    // Ignore process kill errors
                }
            });
            proc.on('error', (err) => {
                cancelListener.dispose();
                reject(err);
            });
            proc.on('close', (code) => {
                cancelListener.dispose();
                if (token.isCancellationRequested) {
                    resolve('');
                    return;
                }
                if (code === 0) {
                    resolve(stdout);
                }
                else {
                    reject(new Error(stderr || `rustfmt exited with code ${code}`));
                }
            });
            proc.stdin.write(input);
            proc.stdin.end();
        });
    }
}
exports.RustfmtFormattingEditProvider = RustfmtFormattingEditProvider;
//# sourceMappingURL=rustfmtProvider.js.map