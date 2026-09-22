import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { computeMinimalEdits } from './diffUtils';
import { resolveClangFormatStyle } from './configResolver';
import { findClangFormatPath } from './toolchainDiscovery';

export class ClangFormatFormattingEditProvider
  implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider
{
  constructor(private readonly extensionPath: string) {}

  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    return this.formatInternal(document, undefined, token);
  }

  async provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    return this.formatInternal(document, range, token);
  }

  private async formatInternal(
    document: vscode.TextDocument,
    range: vscode.Range | undefined,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const config = vscode.workspace.getConfiguration('null-format.clangFormat');
    const enabled = config.get<boolean>('enable', true);
    if (!enabled || token.isCancellationRequested) {
      return [];
    }

    const configuredExe = config.get<string>('path');
    const exePath = findClangFormatPath(configuredExe, this.extensionPath);
    if (!exePath) {
      vscode.window.showWarningMessage(
        'Null IDE: clang-format was not found. Please install LLVM or configure null-format.clangFormat.path.'
      );
      return [];
    }

    const filePath = document.isUntitled ? undefined : document.fileName;
    const workspaceFolder = filePath ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath : undefined;
    const customConfigPath = config.get<string>('configPath');
    const defaultConfig = config.get<string | Record<string, unknown>>('defaultConfig');

    const configResolution = resolveClangFormatStyle(
      filePath || 'untitled.cpp',
      customConfigPath,
      defaultConfig,
      workspaceFolder
    );

    const assumeFileName = filePath || (document.languageId === 'c' ? 'main.c' : 'main.cpp');
    const args: string[] = [
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

      const minimalEdits = computeMinimalEdits(text, formatted);
      return minimalEdits.map(
        (edit) =>
          new vscode.TextEdit(
            new vscode.Range(
              new vscode.Position(edit.startLine, edit.startChar),
              new vscode.Position(edit.endLine, edit.endChar)
            ),
            edit.newText
          )
      );
    } catch (err) {
      console.error('[null-format] clang-format execution failed:', err);
      vscode.window.showWarningMessage(`clang-format error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private executeClangFormat(
    exePath: string,
    args: string[],
    cwd: string,
    input: string,
    token: vscode.CancellationToken
  ): Promise<string> {
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
        } catch {
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
        } else {
          reject(new Error(stderr || `clang-format exited with code ${code}`));
        }
      });

      proc.stdin.write(input);
      proc.stdin.end();
    });
  }
}
