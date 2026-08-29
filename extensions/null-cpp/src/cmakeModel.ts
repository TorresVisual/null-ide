import * as vscode from 'vscode';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { CMakePreset } from './presetsModel';
import { wrapWslCommand, pickLatestIndexFile, parseReplyIndex, parseCodemodelTargets, parseTargetDetail } from './cmakeReply';

export type { CMakeTarget } from './cmakeReply';
import type { CMakeTarget } from './cmakeReply';

// ---- Process execution, streamed into a dedicated, reused terminal ----

const TERMINAL_NAME = 'Null C++: CMake';

let writeEmitter: vscode.EventEmitter<string> | undefined;
let ptyTerminal: vscode.Terminal | undefined;
let activeProcess: ChildProcess | undefined;

function ensureTerminal(): vscode.Terminal {
  if (ptyTerminal) {
    return ptyTerminal;
  }
  writeEmitter = new vscode.EventEmitter<string>();
  const closeEmitter = new vscode.EventEmitter<number | void>();
  const pty: vscode.Pseudoterminal = {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    open: () => {},
    close: () => {
      activeProcess?.kill();
    },
    handleInput: (data: string) => {
      if (data === '\x03') {
        activeProcess?.kill();
      }
    },
  };
  ptyTerminal = vscode.window.createTerminal({ name: TERMINAL_NAME, pty });
  vscode.window.onDidCloseTerminal((t) => {
    if (t === ptyTerminal) {
      ptyTerminal = undefined;
      writeEmitter = undefined;
    }
  });
  return ptyTerminal;
}

function writeLine(text: string): void {
  writeEmitter?.fire(`${text.replace(/\r?\n/g, '\r\n')}\r\n`);
}

/** Cancels whatever cmake/build/run process is currently streaming into the shared terminal. */
export function cancelActive(): void {
  activeProcess?.kill();
}

export interface RunCommandOptions {
  cwd: string;
  isWsl: boolean;
  wslDistro?: string;
  show?: boolean;
}

/** Spawns `command` (optionally WSL-wrapped), streaming output into the shared terminal. Resolves with the exit code. */
export async function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<number> {
  const terminal = ensureTerminal();
  if (options.show !== false) {
    terminal.show(true);
  }
  activeProcess?.kill();
  activeProcess = undefined;

  const resolved =
    options.isWsl && options.wslDistro ? wrapWslCommand(command, args, options.wslDistro) : { command, args };

  writeLine(`> ${resolved.command} ${resolved.args.join(' ')}`);

  return new Promise<number>((resolve) => {
    const child = spawn(resolved.command, resolved.args, { cwd: options.cwd, shell: false });
    activeProcess = child;

    child.stdout?.on('data', (chunk: Buffer) => writeEmitter?.fire(chunk.toString().replace(/\r?\n/g, '\r\n')));
    child.stderr?.on('data', (chunk: Buffer) => writeEmitter?.fire(chunk.toString().replace(/\r?\n/g, '\r\n')));

    child.on('error', (err) => {
      writeLine(`Failed to start "${resolved.command}": ${err.message}`);
      activeProcess = undefined;
      resolve(-1);
    });

    child.on('close', (code) => {
      writeLine(`[exit code ${code ?? -1}]`);
      activeProcess = undefined;
      resolve(code ?? -1);
    });
  });
}

// ---- CMake File API ----

/** Writes the "shared, stateless" query stub that asks CMake to emit a codemodel-v2 reply on the next configure. */
export async function writeCodemodelQuery(binaryDir: string): Promise<void> {
  const queryDir = vscode.Uri.file(path.join(binaryDir, '.cmake', 'api', 'v1', 'query'));
  await vscode.workspace.fs.createDirectory(queryDir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(queryDir, 'codemodel-v2'), new Uint8Array());
}

export async function configure(preset: CMakePreset, sourceDir: string, wslDistro?: string): Promise<number> {
  await writeCodemodelQuery(preset.binaryDir);
  return runCommand('cmake', ['--preset', preset.name], {
    cwd: sourceDir,
    isWsl: preset.isWsl,
    wslDistro,
  });
}

async function readJson(uri: vscode.Uri): Promise<unknown> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

/** Reads the targets produced by the most recent configure, via the CMake File API reply written alongside it. */
export async function readCodemodelTargets(binaryDir: string): Promise<CMakeTarget[]> {
  const replyDir = vscode.Uri.file(path.join(binaryDir, '.cmake', 'api', 'v1', 'reply'));
  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(replyDir);
  } catch {
    return [];
  }

  const indexFile = pickLatestIndexFile(entries.map(([name]) => name));
  if (!indexFile) {
    return [];
  }
  const ref = parseReplyIndex(await readJson(vscode.Uri.joinPath(replyDir, indexFile)));
  if (!ref) {
    return [];
  }
  const codemodelJson = await readJson(vscode.Uri.joinPath(replyDir, ref.jsonFile));
  const targetRefs = parseCodemodelTargets(codemodelJson);

  const targets: CMakeTarget[] = [];
  for (const targetRef of targetRefs) {
    const detailJson = await readJson(vscode.Uri.joinPath(replyDir, targetRef.jsonFile));
    targets.push(parseTargetDetail(targetRef.name, detailJson, binaryDir));
  }
  return targets;
}
