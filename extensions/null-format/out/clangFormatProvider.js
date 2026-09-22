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
exports.ClangFormatFormattingEditProvider = void 0;
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const path = __importStar(require("path"));
const diffUtils_1 = require("./diffUtils");
const configResolver_1 = require("./configResolver");
const toolchainDiscovery_1 = require("./toolchainDiscovery");
class ClangFormatFormattingEditProvider {
    extensionPath;
    constructor(extensionPath) {
        this.extensionPath = extensionPath;
    }
    async provideDocumentFormattingEdits(document, _options, token) {
        return this.formatInternal(document, undefined, token);
    }
    async provideDocumentRangeFormattingEdits(document, range, _options, token) {
        return this.formatInternal(document, range, token);
    }
    async formatInternal(document, range, token) {
        const config = vscode.workspace.getConfiguration('null-format.clangFormat');
        const enabled = config.get('enable', true);
        if (!enabled || token.isCancellationRequested) {
            return [];
        }
        const configuredExe = config.get('path');
        const exePath = (0, toolchainDiscovery_1.findClangFormatPath)(configuredExe, this.extensionPath);
        if (!exePath) {
            vscode.window.showWarningMessage('Null IDE: clang-format was not found. Please install LLVM or configure null-format.clangFormat.path.');
            return [];
        }
        const filePath = document.isUntitled ? undefined : document.fileName;
        const workspaceFolder = filePath ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath : undefined;
        const customConfigPath = config.get('configPath');
        const defaultConfigYaml = config.get('defaultConfig');
        const configResolution = (0, configResolver_1.resolveClangFormatStyle)(filePath || 'untitled.cpp', customConfigPath, defaultConfigYaml, workspaceFolder);
        const assumeFileName = filePath || (document.languageId === 'c' ? 'main.c' : 'main.cpp');
        const args = [
            `-assume-filename=${assumeFileName}`,
            `-style=${configResolution.styleArg}`,
        ];
        const text = document.getText();
        if (range) {
            const offset = document.offsetAt(range.start);
            const length = document.offsetAt(range.end) - offset;
            args.push(`--offset=${offset}`, `--length=${length}`);
        }
        const cwd = filePath ? path.dirname(filePath) : (workspaceFolder || process.cwd());
        try {
            const formatted = await this.executeClangFormat(exePath, args, cwd, text, token);
            if (token.isCancellationRequested || formatted === text) {
                return [];
            }
            const minimalEdits = (0, diffUtils_1.computeMinimalEdits)(text, formatted);
            return minimalEdits.map((edit) => new vscode.TextEdit(new vscode.Range(new vscode.Position(edit.startLine, edit.startChar), new vscode.Position(edit.endLine, edit.endChar)), edit.newText));
        }
        catch (err) {
            console.error('[null-format] clang-format execution failed:', err);
            vscode.window.showWarningMessage(`clang-format error: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    executeClangFormat(exePath, args, cwd, input, token) {
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
                    reject(new Error(stderr || `clang-format exited with code ${code}`));
                }
            });
            proc.stdin.write(input);
            proc.stdin.end();
        });
    }
}
exports.ClangFormatFormattingEditProvider = ClangFormatFormattingEditProvider;
//# sourceMappingURL=clangFormatProvider.js.map