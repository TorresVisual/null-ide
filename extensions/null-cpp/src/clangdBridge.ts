import * as vscode from 'vscode';

const CLANGD_EXTENSION_ID = 'llvm-vs-code-clangd.vscode-clangd';

interface ClangdLanguageClient {
  sendRequest<T>(method: string, param: unknown): Promise<T>;
}

interface ClangdApiV1 {
  languageClient: ClangdLanguageClient;
}

interface ClangdExtensionExports {
  getApi?(version: 1): ClangdApiV1;
}

export type SwitchSourceHeaderResult =
  | { kind: 'switched'; uri: vscode.Uri }
  | { kind: 'not-found' }
  | { kind: 'fallback' }
  | { kind: 'unavailable' };

let cachedClient: ClangdLanguageClient | undefined;
let warnedMissingApi = false;

export async function switchSourceHeader(uri: vscode.Uri): Promise<SwitchSourceHeaderResult> {
  const ext = vscode.extensions.getExtension<ClangdExtensionExports>(CLANGD_EXTENSION_ID);
  if (!ext) {
    return { kind: 'unavailable' };
  }

  const exports = ext.isActive ? ext.exports : await ext.activate();

  if (typeof exports.getApi !== 'function') {
    if (!warnedMissingApi) {
      warnedMissingApi = true;
      void vscode.window.showWarningMessage(
        'Null C++ needs a newer version of the clangd extension (0.1.29+) for symbol-aware navigation. Falling back to plain Alt+O.'
      );
    }
    await vscode.commands.executeCommand('clangd.switchheadersource');
    return { kind: 'fallback' };
  }

  if (!cachedClient) {
    cachedClient = exports.getApi(1).languageClient;
  }

  const result = await cachedClient.sendRequest<string | undefined>(
    'textDocument/switchSourceHeader',
    { uri: uri.toString() }
  );

  if (!result) {
    return { kind: 'not-found' };
  }
  return { kind: 'switched', uri: vscode.Uri.parse(result) };
}
