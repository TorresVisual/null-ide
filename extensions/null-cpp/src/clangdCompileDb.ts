import * as vscode from 'vscode';
import { updateClangdContent } from './clangdConfigText';

export async function writeClangdConfig(workspaceRoot: vscode.Uri, binaryDir: string): Promise<void> {
  const clangdUri = vscode.Uri.joinPath(workspaceRoot, '.clangd');
  let existing: string | undefined;
  try {
    existing = Buffer.from(await vscode.workspace.fs.readFile(clangdUri)).toString('utf8');
  } catch {
    existing = undefined;
  }
  const updated = updateClangdContent(existing, binaryDir);
  await vscode.workspace.fs.writeFile(clangdUri, Buffer.from(updated, 'utf8'));
}
