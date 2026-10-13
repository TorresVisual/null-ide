'use strict';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { installedIds } from './extensionSet';
import { ExtensionHost } from './syncEngine';

/**
 * `~/<dataFolderName>/extensions/extensions.json` lists every installed user extension, disabled ones included
 * (`vscode.extensions.all` lists enabled ones only). `dataFolderName` is `Null` in this product's product.json.
 */
function manifestPath(): string | undefined {
  try {
    const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8')) as { dataFolderName?: string };
    return product.dataFolderName ? path.join(os.homedir(), product.dataFolderName, 'extensions', 'extensions.json') : undefined;
  } catch {
    return undefined;
  }
}

async function installed(): Promise<string[] | undefined> {
  const file = manifestPath();
  if (!file) return undefined;
  try {
    return installedIds(await fs.promises.readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** The commands can resolve without an error even when nothing happened, so the result is checked against the manifest. */
export const extensionHost: ExtensionHost = {
  installed,

  async install(id) {
    try {
      await vscode.commands.executeCommand('workbench.extensions.installExtension', id);
    } catch {
      return false;
    }
    return ((await installed()) ?? []).includes(id.toLowerCase());
  },

  async uninstall(id) {
    try {
      await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
    } catch {
      return false;
    }
    return !((await installed()) ?? [id.toLowerCase()]).includes(id.toLowerCase());
  },
};
