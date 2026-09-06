import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseWslDistroList } from './toolchainRegistry';
import { runCommand } from './cmakeModel';
import { parseMakeTargets, type MakeTarget } from './makefileParser';

const execFileAsync = promisify(execFile);

let hasMakefile = false;
let targets: MakeTarget[] = [];
let targetItems: vscode.StatusBarItem[] = [];

interface WslMakeEnv {
  distro: string;
  /** Set only when g++ isn't on PATH but clang++ is — overrides the Makefile's `CXX := g++` default. */
  cxx?: string;
}

let makeEnv: WslMakeEnv | undefined;

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function readMakefile(): Promise<string | undefined> {
  const root = workspaceRoot();
  if (!root) {
    return undefined;
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, 'Makefile'));
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return undefined;
  }
}

async function wslWhich(distro: string, tool: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('wsl.exe', ['-d', distro, '--', 'which', tool], { encoding: 'utf8' });
    return stdout.replace(/ /g, '').trim().length > 0;
  } catch {
    return false;
  }
}

/** Finds a WSL distro with `make` on its PATH — Makefile builds need a real Unix make/toolchain, not Windows. */
async function detectWslMakeEnv(): Promise<WslMakeEnv | undefined> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('wsl.exe', ['--list', '--quiet'], { encoding: 'utf16le' }));
  } catch {
    return undefined;
  }
  for (const distro of parseWslDistroList(stdout)) {
    if (!(await wslWhich(distro, 'make'))) {
      continue;
    }
    const hasGxx = await wslWhich(distro, 'g++');
    if (hasGxx) {
      return { distro };
    }
    const hasClangxx = await wslWhich(distro, 'clang++');
    return { distro, cxx: hasClangxx ? 'clang++' : undefined };
  }
  return undefined;
}

function iconFor(name: string): string {
  switch (name) {
    case 'run':
      return 'run';
    case 'clean':
      return 'trash';
    case 'test':
      return 'beaker';
    case 'debug':
      return 'debug';
    case 'help':
      return 'question';
    default:
      return 'play';
  }
}

function rebuildStatusBarItems(): void {
  for (const item of targetItems) {
    item.dispose();
  }
  targetItems = targets.map((target, index) => {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96 - index);
    item.text = `$(${iconFor(target.name)}) Make ${target.name}`;
    item.tooltip = target.description;
    item.command = { command: 'null-cpp.make.runTarget', title: '', arguments: [target.name] };
    item.show();
    return item;
  });
}

export async function refreshMakeContext(): Promise<void> {
  const content = await readMakefile();
  hasMakefile = content !== undefined;
  targets = content ? parseMakeTargets(content) : [];
  makeEnv = hasMakefile ? await detectWslMakeEnv() : undefined;
  await vscode.commands.executeCommand('setContext', 'null-cpp.make.hasMakefile', hasMakefile);
  rebuildStatusBarItems();
}

async function runMake(target?: string): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    return;
  }
  if (!makeEnv) {
    void vscode.window.showErrorMessage(
      'No WSL distro with `make` on PATH was found. Install make (and a compiler) in WSL, then reload the window.'
    );
    return;
  }
  const cxxArgs = makeEnv.cxx ? [`CXX=${makeEnv.cxx}`] : [];
  const targetArgs = target ? [target] : [];
  await runCommand('make', [...cxxArgs, ...targetArgs], { cwd: root.fsPath, isWsl: true, wslDistro: makeEnv.distro });
}

async function runTargetCommand(target?: string): Promise<void> {
  if (target) {
    await runMake(target);
    return;
  }
  if (targets.length === 0) {
    await runMake();
    return;
  }
  const pick = await vscode.window.showQuickPick(
    targets.map((t) => ({ label: t.name, description: t.description, target: t.name })),
    { placeHolder: 'Select a make target to run' }
  );
  if (pick) {
    await runMake(pick.target);
  }
}

export function registerMakeToolbar(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null-cpp.make.runTarget', (target?: string) => runTargetCommand(target)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void refreshMakeContext()),
    { dispose: () => targetItems.forEach((item) => item.dispose()) }
  );

  void refreshMakeContext();
}
