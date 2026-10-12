import * as vscode from 'vscode';

/** The slice of null-env's exports that null-format uses. */
export interface EnvApi {
  findRustfmtPath(configuredPath?: string, extensionPath?: string): string | null;
  findClangFormatPath(configuredPath?: string, extensionPath?: string): string | null;
}

/** null-format declares null-env in `extensionDependencies`, so it is active before this extension is. */
export function getEnvApi(): EnvApi {
  const api = vscode.extensions.getExtension<EnvApi>('null.null-env')?.exports;
  if (!api) {
    throw new Error('Null Env (null.null-env) is not available.');
  }
  return api;
}
