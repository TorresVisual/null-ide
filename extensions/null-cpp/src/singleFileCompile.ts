import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { isCppDocument } from './cppLanguage';
import * as toolchainRegistry from './toolchainRegistry';
import { runCommand } from './cmakeModel';
import { resolveBuildDiagnostics, type ResolvedBuildDiagnostic } from './buildDiagnostics';
import {
  buildCompileArgs,
  resolveOutputBinaryPath,
  type CompileArgsOptions,
} from './singleFileCompileArgs';

export type { CompileArgsOptions };

export interface ResolvedClangxx {
  compilerPath: string;
  isWsl: boolean;
  wslDistro?: string;
  msvcEnv?: Record<string, string>;
}

export async function resolveClangxxToolchain(configuredPath?: string): Promise<ResolvedClangxx | undefined> {
  const trimmedPath = configuredPath?.trim();
  if (trimmedPath && trimmedPath.length > 0) {
    return { compilerPath: trimmedPath, isWsl: false };
  }

  // Check detected native clang++ or on PATH
  const found = await toolchainRegistry.findClangxx();
  if (found) {
    let msvcEnv: Record<string, string> | undefined;
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

let compileDiagnostics: vscode.DiagnosticCollection;

function applyDiagnostics(diagnostics: ResolvedBuildDiagnostic[]): void {
  compileDiagnostics.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
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

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function compileActiveFile(context?: vscode.ExtensionContext): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isCppDocument(editor.document)) {
    void vscode.window.showInformationMessage('Open a C/C++ source or header file to compile.');
    return false;
  }

  if (editor.document.isDirty) {
    await editor.document.save();
  }

  const filePath = editor.document.uri.fsPath;
  const config = vscode.workspace.getConfiguration('null-cpp');
  const configuredPath = config.get<string>('compile.clangPath');
  const configuredArgs = config.get<string[]>('compile.clangArgs');

  // Ensure toolchain registry has run at least once if empty
  if (toolchainRegistry.list().length === 0) {
    await toolchainRegistry.refresh();
  }

  const toolchain = await resolveClangxxToolchain(configuredPath);
  if (!toolchain) {
    void vscode.window.showErrorMessage(
      'No clang++ compiler found on PATH or in WSL. Install LLVM/Clang or configure "null-cpp.compile.clangPath" in settings.'
    );
    return false;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const sourceDir = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(filePath);

  // Discover include dirs in workspace (e.g. include/, src/)
  const includeDirs: string[] = [];
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

  const outputBinaryPath = resolveOutputBinaryPath(filePath, toolchain.isWsl);
  const args = buildCompileArgs({
    filePath,
    sourceDir,
    extraArgs: configuredArgs,
    includeDirs,
    outputBinaryPath,
    isWsl: toolchain.isWsl,
  });

  const { exitCode, output } = await runCommand(toolchain.compilerPath, args, {
    cwd: sourceDir,
    isWsl: toolchain.isWsl,
    wslDistro: toolchain.wslDistro,
    env: toolchain.msvcEnv ? { ...process.env, ...toolchain.msvcEnv } : undefined,
  });

  const diagnostics = resolveBuildDiagnostics(output, sourceDir, toolchain.isWsl, toolchain.wslDistro);
  applyDiagnostics(diagnostics);

  if (exitCode !== 0) {
    void vscode.window.showErrorMessage(`clang++ compilation failed (exit code ${exitCode}).`);
    return false;
  }

  return true;
}

export function registerSingleFileCompile(context: vscode.ExtensionContext): void {
  compileDiagnostics = vscode.languages.createDiagnosticCollection('null-cpp-compile');
  context.subscriptions.push(compileDiagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.compileActiveFile', () => compileActiveFile(context))
  );
}
