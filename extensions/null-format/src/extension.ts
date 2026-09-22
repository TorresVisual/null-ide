import * as vscode from 'vscode';
import { PrettierFormattingEditProvider } from './prettierProvider';
import { RustfmtFormattingEditProvider } from './rustfmtProvider';
import { ClangFormatFormattingEditProvider } from './clangFormatProvider';

export function activate(context: vscode.ExtensionContext) {
  const extensionPath = context.extensionPath;

  // 1. Register Prettier Formatter
  const prettierProvider = new PrettierFormattingEditProvider();
  const prettierLanguages = [
    'javascript',
    'javascriptreact',
    'typescript',
    'typescriptreact',
    'json',
    'jsonc',
    'css',
    'scss',
    'less',
    'html',
    'yaml',
    'markdown',
  ];

  for (const lang of prettierLanguages) {
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider(lang, prettierProvider),
      vscode.languages.registerDocumentRangeFormattingEditProvider(lang, prettierProvider)
    );
  }

  // 2. Register Rustfmt Formatter
  const rustfmtProvider = new RustfmtFormattingEditProvider(extensionPath);
  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider('rust', rustfmtProvider)
  );

  // 3. Register Clang-Format Formatter
  const clangFormatProvider = new ClangFormatFormattingEditProvider(extensionPath);
  const clangLanguages = ['c', 'cpp', 'cuda-cpp', 'objective-c', 'objective-cpp'];

  for (const lang of clangLanguages) {
    context.subscriptions.push(
      vscode.languages.registerDocumentFormattingEditProvider(lang, clangFormatProvider),
      vscode.languages.registerDocumentRangeFormattingEditProvider(lang, clangFormatProvider)
    );
  }
}

export function deactivate() {}
