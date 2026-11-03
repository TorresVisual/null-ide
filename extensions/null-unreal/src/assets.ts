import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AssetStore } from './assetStore';
import { assetsDir } from './cache';
import { realExportFs, realProjectFs } from './cli';
import { cliArgs, CliContext, spawnCli } from './commands';
import { Engine, realReaders, resolveEngine } from './engine';
import { MAX_PER_RUN, peekAsset } from './exporter';
import { uassetsIn } from './packagePath';
import { ResolveError, resolveProject, Uproject } from './uproject';

export interface Resolved { project: Uproject; engine: Engine }

// The project and engine do not change under a running window, and resolving the engine runs `reg query`.
// A settings change drops the memo.
function resolver(context: vscode.ExtensionContext) {
  let memo: Resolved | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('null-unreal')) memo = undefined;
    }),
  );
  return (): Resolved => {
    if (memo) return memo;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!folder) throw new ResolveError('open the folder that holds the .uproject first');
    const cfg = vscode.workspace.getConfiguration('null-unreal');
    const project = resolveProject(folder, cfg.get<string>('project', '') || undefined, realProjectFs);
    const engine = resolveEngine(project, cfg.get<string>('enginePath', '') || undefined, realReaders);
    return (memo = { project, engine });
  };
}

// Lines of the CLI's report that explain a failure: everything but the per-asset successes and the result lines.
function errorsFrom(text: string, files: string[]): Map<string, string> {
  const lines = text.split(/\r?\n/).filter((l) => l && !l.startsWith('log: ') && !/^null-unreal export: exit /.test(l));
  const reason = lines.filter((l) => !/\s(cached|exported)\s/.test(l)).join('; ') || 'the export failed (see the Null Unreal output)';
  return new Map(files.map((f) => [f, reason]));
}

export function registerAssets(
  context: vscode.ExtensionContext,
  ctx: CliContext,
): { store: AssetStore; resolve: () => Resolved } {
  const resolve = resolver(context);

  const store = new AssetStore({
    peek(file) {
      try {
        return peekAsset({ ...resolve(), file }, realExportFs);
      } catch {
        return undefined;
      }
    },
    async run(files, force) {
      const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!folder) throw new Error('open the folder that holds the .uproject first');
      ctx.output.appendLine(`> null-unreal export ${files.length} asset(s)${force ? ' --force' : ''}`);
      // One CLI call per engine run keeps the command line short however large the folder is.
      const errors = new Map<string, string>();
      for (let i = 0; i < files.length; i += MAX_PER_RUN) {
        const chunk = files.slice(i, i + MAX_PER_RUN);
        const before = [...chunk, ...(force ? ['--force'] : [])];
        const { code, text } = await spawnCli(cliArgs('export', ctx.cliPath, before), folder, ctx.output);
        if (code !== 0) for (const [f, e] of errorsFrom(text, chunk)) errors.set(f, e);
      }
      return errors;
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('null-unreal.exportAsset', (uri?: vscode.Uri) => exportAsset(store, resolve, uri)),
    vscode.commands.registerCommand('null-unreal.clearAssetCache', () => clearCache(resolve)),
  );
  return { store, resolve };
}

// The explorer passes the clicked file; otherwise the active tab if it is a .uasset; otherwise ask for a folder.
async function exportAsset(store: AssetStore, resolve: () => Resolved, clicked?: vscode.Uri): Promise<void> {
  let r: Resolved;
  try {
    r = resolve();
  } catch (e) {
    void vscode.window.showWarningMessage(`Null Unreal: ${(e as Error).message}`);
    return;
  }
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  let target = clicked ?? (tab?.uri?.fsPath.toLowerCase().endsWith('.uasset') ? tab.uri : undefined);
  if (!target) {
    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      defaultUri: vscode.Uri.file(path.join(r.project.dir, 'Content')),
      openLabel: 'Export assets in folder',
    });
    target = picked?.[0];
  }
  if (!target) return;

  const files = fs.statSync(target.fsPath).isDirectory() ? uassetsIn(target.fsPath, realExportFs) : [target.fsPath];
  if (files.length === 0) {
    void vscode.window.showInformationMessage('Null Unreal: no .uasset files in that folder.');
    return;
  }
  const results = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Null Unreal: exporting ${files.length === 1 ? path.basename(files[0]) : `${files.length} assets`} (the engine takes a few seconds to start)`,
    },
    () => store.getMany(files),
  );
  const failed = results.filter((x): x is { file: string; error: string } => 'error' in x);
  if (failed.length === 0) {
    void vscode.window.showInformationMessage(`Null Unreal: exported ${files.length} asset(s) to Saved/NullUnreal/assets.`);
  } else {
    void vscode.window.showErrorMessage(`Null Unreal: ${failed.length} of ${files.length} failed: ${failed[0].error}`);
  }
}

async function clearCache(resolve: () => Resolved): Promise<void> {
  let dir: string;
  try {
    dir = assetsDir(resolve().project.dir);
  } catch (e) {
    void vscode.window.showWarningMessage(`Null Unreal: ${(e as Error).message}`);
    return;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  void vscode.window.showInformationMessage(`Null Unreal: deleted ${dir}.`);
}
