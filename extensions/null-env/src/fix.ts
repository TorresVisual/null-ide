import * as vscode from 'vscode';
import { debugExtensionFor } from './rules';
import type { Finding } from './types';

export async function applyFix(finding: Finding): Promise<void> {
  if (finding.fix.kind === 'install') {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', finding.fix.extensionId);
  } else {
    await vscode.env.openExternal(vscode.Uri.parse(finding.fix.url));
  }
}

/**
 * Whether debug type `type` can start. When its extension is missing this explains why and offers the
 * fix, but does not wait for the user's choice: callers just stop and return.
 */
export async function ensureDebugType(type: string): Promise<boolean> {
  const need = debugExtensionFor(type);
  if (!need || vscode.extensions.getExtension(need.extensionId)) {
    return true;
  }
  void vscode.window
    .showErrorMessage(
      `Debugging needs the ${need.label} extension (${need.extensionId}), which is not installed.`,
      'Install',
      'Check Environment',
    )
    .then(choice => {
      if (choice === 'Install') {
        return vscode.commands.executeCommand('workbench.extensions.installExtension', need.extensionId);
      }
      if (choice === 'Check Environment') {
        return vscode.commands.executeCommand('null.env.check');
      }
      return undefined;
    });
  return false;
}
