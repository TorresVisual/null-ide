import * as vscode from 'vscode';

/** The slice of null-env's exports that null-cpp uses. */
export interface EnvApi {
  findExecutable(name: string): string | null;
  ensureDebugType(type: string): Promise<boolean>;
}

/** null-cpp declares null-env in `extensionDependencies`, so it is active before this extension is. */
export function getEnvApi(): EnvApi {
  const api = vscode.extensions.getExtension<EnvApi>('null.null-env')?.exports;
  if (!api) {
    throw new Error('Null Env (null.null-env) is not available.');
  }
  return api;
}
