import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import { computeMinimalEdits } from './diffUtils';
import { resolveRustfmtConfig } from './configResolver';
import { findRustfmtPath } from './toolchainDiscovery';

export class RustfmtFormattingEditProvider implements vscode.DocumentFormattingEditProvider {
  constructor(private readonly extensionPath: string) {}

  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const config = vscode.workspace.getConfiguration('null-format.rustfmt');
    const enabled = config.get<boolean>('enable', true);
    if (!enabled || token.isCancellationRequested) {
      return [];
    }

    const configuredExe = config.get<string>('path');
    const exePath = findRustfmtPath(configuredExe, this.extensionPath);
    if (!exePath) {
      vscode.window.showWarningMessage(
        'Null IDE: rustfmt was not found. Please install Rust (rustup component add rustfmt) or configure null-format.rustfmt.path.'
      );
      return [];
    }

    const filePath = document.isUntitled ? undefined : document.fileName;
    const workspaceFolder = filePath ? vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath : undefined;
    const customConfigPath = config.get<string>('configPath');
    const defaultConfigToml = config.get<string>('defaultConfig');

    const configResolution = resolveRustfmtConfig(
      filePath || 'untitled.rs',
      customConfigPath,
      defaultConfigToml,
      workspaceFolder
    );

    const args: string[] = ['--emit', 'stdout'];

    if (configResolution.configPath) {
      args.push('--config-path', configResolution.configPath);
    } else if (configResolution.inlineOptions && configResolution.inlineOptions.length > 0) {
      args.push('--config', configResolution.inlineOptions);
    }

    const text = document.getText();
    const cwd = filePath ? path.dirname(filePath) : (workspaceFolder || process.cwd());

    try {
      const formatted = await this.executeRustfmt(exePath, args, cwd, text, token);
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
      console.error('[null-format] rustfmt execution failed:', err);
      vscode.window.showWarningMessage(`rustfmt error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  private executeRustfmt(
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
          reject(new Error(stderr || `rustfmt exited with code ${code}`));
        }
      });

      proc.stdin.write(input);
      proc.stdin.end();
    });
  }
}
