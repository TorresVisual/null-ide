'use strict';

import * as path from 'path';

// `vscode` is absent under `node --test`; fall back to a plain file:// shim there.
let vscodeUri: any;
try {
  vscodeUri = require('vscode').Uri;
} catch {
  vscodeUri = undefined;
}

export function pathToUri(fsPath: string): string {
  if (vscodeUri) return vscodeUri.file(fsPath).toString();
  const p = fsPath.replace(/\\/g, '/');
  return 'file://' + (p.startsWith('/') ? '' : '/') + p;
}

export function uriToPath(uri: string): string {
  if (vscodeUri) return vscodeUri.parse(uri).fsPath;
  const p = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  return (/^\/[A-Za-z]:/.test(p) ? p.slice(1) : p).replace(/\//g, path.sep);
}
