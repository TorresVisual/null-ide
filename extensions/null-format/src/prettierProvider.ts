import * as vscode from 'vscode';
import * as prettier from 'prettier';
import { computeMinimalEdits } from './diffUtils';

const LANGUAGE_PARSER_MAP: Record<string, string> = {
  javascript: 'babel',
  javascriptreact: 'babel',
  typescript: 'typescript',
  typescriptreact: 'typescript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  yaml: 'yaml',
  markdown: 'markdown',
};

export class PrettierFormattingEditProvider
  implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider
{
  async provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    return this.formatInternal(document, undefined, options, token);
  }

  async provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    return this.formatInternal(document, range, options, token);
  }

  private async formatInternal(
    document: vscode.TextDocument,
    range: vscode.Range | undefined,
    formattingOptions: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.TextEdit[]> {
    const config = vscode.workspace.getConfiguration('null-format.prettier');
    const enabled = config.get<boolean>('enable', true);
    if (!enabled || token.isCancellationRequested) {
      return [];
    }

    const text = document.getText();
    const filePath = document.isUntitled ? undefined : document.fileName;
    const customConfigPath = config.get<string>('configPath');
    const defaultConfig = config.get<Record<string, unknown>>('defaultConfig') || {};

    let prettierConfig: prettier.Options | null = null;

    if (customConfigPath && customConfigPath.trim().length > 0) {
      try {
        prettierConfig = await prettier.resolveConfig(customConfigPath, {
          config: customConfigPath,
          useCache: false,
        });
      } catch (err) {
        console.warn(`[null-format] Failed to load custom Prettier config at ${customConfigPath}:`, err);
      }
    }

    if (!prettierConfig && filePath) {
      try {
        prettierConfig = await prettier.resolveConfig(filePath, {
          editorconfig: true,
        });
      } catch (err) {
        console.warn(`[null-format] Prettier resolveConfig error for ${filePath}:`, err);
      }
    }

    const parser = LANGUAGE_PARSER_MAP[document.languageId];
    const resolvedOptions: prettier.Options = {
      filepath: filePath,
      parser,
      tabWidth: formattingOptions.tabSize,
      useTabs: !formattingOptions.insertSpaces,
      ...(defaultConfig as prettier.Options),
      ...(prettierConfig || {}),
    };

    if (range) {
      resolvedOptions.rangeStart = document.offsetAt(range.start);
      resolvedOptions.rangeEnd = document.offsetAt(range.end);
    }

    try {
      const formatted = await prettier.format(text, resolvedOptions);
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
      console.error('[null-format] Prettier formatting failed:', err);
      vscode.window.showWarningMessage(`Prettier format error: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }
}
