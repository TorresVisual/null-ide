import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { Command } from './commandLine';
import { realProjectFs } from './cli';
import { latestLogAny } from './logs';
import { cliUsageSnippet } from './shim';
import { parseLogPath } from './result';
import { ResolveError, resolveProject } from './uproject';

export interface CliContext { cliPath: string; output: vscode.OutputChannel }

export function registerCommands(
  context: vscode.ExtensionContext,
  o: CliContext & { shimPath: string },
): void {
  const ctx: CliContext = { cliPath: o.cliPath, output: o.output };
  for (const cmd of ['run', 'build', 'test', 'smoke'] as Command[]) {
    context.subscriptions.push(vscode.commands.registerCommand(`null-unreal.${cmd}`, () => runCli(cmd, ctx)));
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('null-unreal.generateClangdDatabase', () => generateClangdDatabase(ctx)),
    vscode.commands.registerCommand('null-unreal.openLastLog', openLastLog),
    vscode.commands.registerCommand('null-unreal.showCliPath', () => showCliPath(o.shimPath)),
  );
}

// The extension never builds an engine command line: it passes settings to the CLI as flags.
export function cliArgs(cmd: Command, cliPath: string, before: string[] = []): string[] {
  const cfg = vscode.workspace.getConfiguration('null-unreal');
  const args = [cliPath, cmd, ...before];
  const project = cfg.get<string>('project', '');
  const enginePath = cfg.get<string>('enginePath', '');
  if (project) args.push('--project', project);
  if (enginePath) args.push('--engine', enginePath);
  args.push('--', ...cfg.get<string[]>(`${cmd}.args`, []));
  return args;
}

export function spawnCli(args: string[], cwd: string, output: vscode.OutputChannel): Promise<{ code: number | null; text: string }> {
  return new Promise((resolve) => {
    let text = '';
    const onData = (d: Buffer) => {
      const s = d.toString();
      text += s;
      output.append(s);
    };
    const child = spawn(process.execPath, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      output.appendLine(err.message);
      resolve({ code: null, text: text + err.message });
    });
    child.on('close', (code) => resolve({ code, text }));
  });
}

async function execute(cmd: Command, ctx: CliContext): Promise<boolean> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage('Null Unreal: open the folder that holds the .uproject first.');
    return false;
  }
  ctx.output.appendLine(`> null-unreal ${cmd}`);
  const { code, text } = await spawnCli(cliArgs(cmd, ctx.cliPath), folder, ctx.output);
  if (code === 0) return true;

  const logPath = parseLogPath(text);
  const actions = logPath ? ['Open Log'] : [];
  const pick = await vscode.window.showErrorMessage(
    `Null Unreal: ${cmd} failed (exit ${code ?? 'killed'}).`,
    ...actions,
  );
  ctx.output.show(true);
  if (pick === 'Open Log' && logPath) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(logPath)));
  }
  return false;
}

// `run` launches the editor and is not awaited by the UI: only a non-zero exit is reported.
async function runCli(cmd: Command, ctx: CliContext): Promise<void> {
  const go = async () => void (await execute(cmd, ctx));
  if (cmd === 'run') return go();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Null Unreal: ${cmd}` },
    go,
  );
}

// compile_commands.json lands beside the .uproject; clangd only needs a restart to read it.
async function generateClangdDatabase(ctx: CliContext): Promise<void> {
  const ok = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Null Unreal: generating the clangd database' },
    () => execute('compdb', ctx),
  );
  if (!ok) return;
  if ((await vscode.commands.getCommands(true)).includes('clangd.restart')) {
    await vscode.commands.executeCommand('clangd.restart');
  }
  void vscode.window.showInformationMessage('Null Unreal: compile_commands.json written next to the .uproject.');
}

async function openLastLog(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!folder) {
    void vscode.window.showWarningMessage('Null Unreal: open the folder that holds the .uproject first.');
    return;
  }
  let file: string | undefined;
  try {
    const project = vscode.workspace.getConfiguration('null-unreal').get<string>('project', '');
    file = latestLogAny(resolveProject(folder, project || undefined, realProjectFs).dir);
  } catch (e) {
    if (!(e instanceof ResolveError)) throw e;
    void vscode.window.showWarningMessage(`Null Unreal: ${e.message}`);
    return;
  }
  if (!file) {
    void vscode.window.showInformationMessage('Null Unreal: no log yet.');
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
}

async function showCliPath(shimPath: string): Promise<void> {
  const snippet = cliUsageSnippet(shimPath);
  const pick = await vscode.window.showInformationMessage(snippet, 'Copy');
  if (pick === 'Copy') await vscode.env.clipboard.writeText(snippet);
}
