import * as vscode from 'vscode';
import type { DetectedProject } from './projectDetector';

/** The slice of null-env's exports that null-actions uses. */
export interface EnvApi {
  detectProjects(folderPath: string): DetectedProject[];
}

/** null-actions declares null-env in `extensionDependencies`, so it is active before this extension is. */
export function getEnvApi(): EnvApi {
  const api = vscode.extensions.getExtension<EnvApi>('null.null-env')?.exports;
  if (!api) {
    throw new Error('Null Env (null.null-env) is not available.');
  }
  return api;
}
