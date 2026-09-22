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
exports.resolveClangxxToolchain = resolveClangxxToolchain;
exports.compileActiveFile = compileActiveFile;
exports.registerSingleFileCompile = registerSingleFileCompile;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs/promises"));
const cppLanguage_1 = require("./cppLanguage");
const toolchainRegistry = __importStar(require("./toolchainRegistry"));
const cmakeModel_1 = require("./cmakeModel");
const buildDiagnostics_1 = require("./buildDiagnostics");
const singleFileCompileArgs_1 = require("./singleFileCompileArgs");
async function resolveClangxxToolchain(configuredPath) {
    const trimmedPath = configuredPath?.trim();
    if (trimmedPath && trimmedPath.length > 0) {
        return { compilerPath: trimmedPath, isWsl: false };
    }
    // Check detected native clang++ or on PATH
    const found = await toolchainRegistry.findClangxx();
    if (found) {
        let msvcEnv;
        if (!found.isWsl) {
            const msvc = toolchainRegistry.list().find((t) => t.kind === 'msvc');
            if (msvc) {
                msvcEnv = await toolchainRegistry.getMsvcDevEnvironment(msvc);
            }
        }
        return {
            compilerPath: found.compilerPath,
            isWsl: found.isWsl,
            wslDistro: found.wslDistro,
            msvcEnv,
        };
    }
    // Check WSL toolchains in registry
    const wslClang = toolchainRegistry.list().find((t) => t.kind === 'wsl-clang' && t.wslDistro);
    if (wslClang && wslClang.wslDistro) {
        return {
            compilerPath: 'clang++',
            isWsl: true,
            wslDistro: wslClang.wslDistro,
        };
    }
    return undefined;
}
let compileDiagnostics;
function applyDiagnostics(diagnostics) {
    compileDiagnostics.clear();
    const byFile = new Map();
    for (const d of diagnostics) {
        const line = Math.max(0, d.line - 1);
        const column = Math.max(0, d.column - 1);
        const range = new vscode.Range(line, column, line, column + 1);
        const severity = d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
        const list = byFile.get(d.absolutePath) ?? [];
        list.push(new vscode.Diagnostic(range, d.message, severity));
        byFile.set(d.absolutePath, list);
    }
    for (const [file, diags] of byFile) {
        compileDiagnostics.set(vscode.Uri.file(file), diags);
    }
}
async function pathExists(p) {
    try {
        await fs.access(p);
        return true;
    }
    catch {
        return false;
    }
}
async function compileActiveFile(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !(0, cppLanguage_1.isCppDocument)(editor.document)) {
        void vscode.window.showInformationMessage('Open a C/C++ source or header file to compile.');
        return false;
    }
    if (editor.document.isDirty) {
        await editor.document.save();
    }
    const filePath = editor.document.uri.fsPath;
    const config = vscode.workspace.getConfiguration('null-cpp');
    const configuredPath = config.get('compile.clangPath');
    const configuredArgs = config.get('compile.clangArgs');
    // Ensure toolchain registry has run at least once if empty
    if (toolchainRegistry.list().length === 0) {
        await toolchainRegistry.refresh();
    }
    const toolchain = await resolveClangxxToolchain(configuredPath);
    if (!toolchain) {
        void vscode.window.showErrorMessage('No clang++ compiler found on PATH or in WSL. Install LLVM/Clang or configure "null-cpp.compile.clangPath" in settings.');
        return false;
    }
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    const sourceDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);
    // Discover include dirs in workspace (e.g. include/, src/)
    const includeDirs = [];
    if (workspaceFolder) {
        const incDir = path.join(sourceDir, 'include');
        if (await pathExists(incDir)) {
            includeDirs.push(incDir);
        }
        const srcDir = path.join(sourceDir, 'src');
        if (await pathExists(srcDir) && srcDir !== path.dirname(filePath)) {
            includeDirs.push(srcDir);
        }
    }
    const outputBinaryPath = (0, singleFileCompileArgs_1.resolveOutputBinaryPath)(filePath, toolchain.isWsl);
    const args = (0, singleFileCompileArgs_1.buildCompileArgs)({
        filePath,
        sourceDir,
        extraArgs: configuredArgs,
        includeDirs,
        outputBinaryPath,
        isWsl: toolchain.isWsl,
    });
    const { exitCode, output } = await (0, cmakeModel_1.runCommand)(toolchain.compilerPath, args, {
        cwd: sourceDir,
        isWsl: toolchain.isWsl,
        wslDistro: toolchain.wslDistro,
        env: toolchain.msvcEnv ? { ...process.env, ...toolchain.msvcEnv } : undefined,
    });
    const diagnostics = (0, buildDiagnostics_1.resolveBuildDiagnostics)(output, sourceDir, toolchain.isWsl, toolchain.wslDistro);
    applyDiagnostics(diagnostics);
    if (exitCode !== 0) {
        void vscode.window.showErrorMessage(`clang++ compilation failed (exit code ${exitCode}).`);
        return false;
    }
    return true;
}
function registerSingleFileCompile(context) {
    compileDiagnostics = vscode.languages.createDiagnosticCollection('null-cpp-compile');
    context.subscriptions.push(compileDiagnostics);
    context.subscriptions.push(vscode.commands.registerCommand('null-cpp.compileActiveFile', () => compileActiveFile(context)));
}
//# sourceMappingURL=singleFileCompile.js.map