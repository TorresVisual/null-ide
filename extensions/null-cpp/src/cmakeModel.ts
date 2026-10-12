import * as vscode from 'vscode';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { CMakePreset } from './presetsModel';
import { wrapWslCommand, pickLatestIndexFile, parseReplyIndex, parseCodemodelTargets, parseTargetDetail } from './cmakeReply';
import { getMsvcDevEnvironment, type Toolchain } from './toolchainRegistry';
import { toWslPath } from './wslPath';
import { parseBuildDiagnosticLine, parseBuildOutput } from './buildDiagnostics';

export type { CMakeTarget } from './cmakeReply';
import type { CMakeTarget } from './cmakeReply';

// ---- Process execution, streamed into a dedicated, reused terminal ----

const TERMINAL_NAME = 'Null C++: Build';

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

const ANSI_RESET = '\x1b[0m';
const ANSI_DIM = '\x1b[2m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_GREEN = '\x1b[32m';

/** Wraps error/warning lines in ANSI color so they stand out in the wall of compiler output. */
function colorizeChunk(text: string): string {
  return text
    .split(/(\r?\n)/)
    .map((part) => {
      const diagnostic = parseBuildDiagnosticLine(part);
      if (!diagnostic) {
        return part;
      }
      const color = diagnostic.severity === 'error' ? ANSI_RED : ANSI_YELLOW;
      return `${color}${part}${ANSI_RESET}`;
    })
    .join('');
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
  env?: NodeJS.ProcessEnv;
}

export interface CommandResult {
  exitCode: number;
  /** Combined stdout+stderr text, for diagnostic parsing. */
  output: string;
}

/** Spawns `command` (optionally WSL-wrapped), streaming output into the shared terminal. */
export async function runCommand(command: string, args: string[], options: RunCommandOptions): Promise<CommandResult> {
  const terminal = ensureTerminal();
  if (options.show !== false) {
    terminal.show(true);
  }
  activeProcess?.kill();
  activeProcess = undefined;

  // Opened inside WSL via a remote window the extension host is already Linux (no wsl.exe).
  const resolved =
    options.isWsl && options.wslDistro && process.platform === 'win32'
      ? wrapWslCommand(command, args, options.wslDistro, toWslPath(options.cwd))
      : { command, args };

  writeLine(`${ANSI_DIM}> ${resolved.command} ${resolved.args.join(' ')}${ANSI_RESET}`);

  return new Promise<CommandResult>((resolve) => {
    const child = spawn(resolved.command, resolved.args, { cwd: options.cwd, shell: false, env: options.env });
    activeProcess = child;
    let output = '';

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      writeEmitter?.fire(colorizeChunk(text).replace(/\r?\n/g, '\r\n'));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);

    child.on('error', (err) => {
      writeLine(`${ANSI_RED}Failed to start "${resolved.command}": ${err.message}${ANSI_RESET}`);
      activeProcess = undefined;
      resolve({ exitCode: -1, output });
    });

    child.on('close', (code) => {
      writeLine(`[exit code ${code ?? -1}]`);
      const diagnostics = parseBuildOutput(output);
      const errors = diagnostics.filter((d) => d.severity === 'error').length;
      const warnings = diagnostics.filter((d) => d.severity === 'warning').length;
      if (errors || warnings) {
        const parts = [errors && `${errors} error${errors === 1 ? '' : 's'}`, warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`]
          .filter(Boolean)
          .join(', ');
        writeLine(`${errors ? ANSI_RED : ANSI_YELLOW}✗ ${parts}${ANSI_RESET}`);
      } else if (code === 0) {
        writeLine(`${ANSI_GREEN}✓ build succeeded${ANSI_RESET}`);
      }
      activeProcess = undefined;
      resolve({ exitCode: code ?? -1, output });
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

export async function configure(preset: CMakePreset, sourceDir: string, toolchain?: Toolchain): Promise<number> {
  await writeCodemodelQuery(preset.binaryDir);
  const msvcEnv = toolchain ? await getMsvcDevEnvironment(toolchain) : undefined;
  const { exitCode } = await runCommand('cmake', ['--preset', preset.name], {
    cwd: sourceDir,
    isWsl: preset.isWsl,
    wslDistro: toolchain?.wslDistro,
    env: msvcEnv ? { ...process.env, ...msvcEnv } : undefined,
  });
  return exitCode;
}

export interface BuildOptions {
  clean?: boolean;
}

/** Guards against a `binaryDir` that would be parsed as a flag instead of the target directory. */
function assertNotFlag(binaryDir: string): string {
  if (binaryDir.startsWith('-')) {
    throw new Error(`Refusing to build: resolved binary directory looks like a CLI flag: "${binaryDir}"`);
  }
  return binaryDir;
}

/**
 * Runs `cmake --build <binaryDir>` (optionally scoped to `target`), streamed into the shared
 * terminal. Builds against the resolved binary directory rather than `--preset <name>` —
 * `--build --preset` resolves against `buildPresets`, a separate array from the
 * `configurePresets` this extension reads, and most `CMakePresets.json` files never define
 * one. Building against the directory works regardless of whether build presets exist.
 */
export async function build(
  preset: CMakePreset,
  sourceDir: string,
  toolchain: Toolchain | undefined,
  target?: CMakeTarget,
  options: BuildOptions = {}
): Promise<CommandResult> {
  const msvcEnv = toolchain ? await getMsvcDevEnvironment(toolchain) : undefined;
  const binaryDir = assertNotFlag(preset.isWsl ? toWslPath(preset.binaryDir) : preset.binaryDir);
  const args = ['--build', binaryDir];
  if (target) {
    args.push('--target', target.name);
  }
  if (options.clean) {
    args.push('--clean-first');
  }
  return runCommand('cmake', args, {
    cwd: sourceDir,
    isWsl: preset.isWsl,
    wslDistro: toolchain?.wslDistro,
    env: msvcEnv ? { ...process.env, ...msvcEnv } : undefined,
  });
}

export async function cleanTarget(preset: CMakePreset, sourceDir: string, toolchain: Toolchain | undefined): Promise<number> {
  const msvcEnv = toolchain ? await getMsvcDevEnvironment(toolchain) : undefined;
  const binaryDir = assertNotFlag(preset.isWsl ? toWslPath(preset.binaryDir) : preset.binaryDir);
  const { exitCode } = await runCommand('cmake', ['--build', binaryDir, '--target', 'clean'], {
    cwd: sourceDir,
    isWsl: preset.isWsl,
    wslDistro: toolchain?.wslDistro,
    env: msvcEnv ? { ...process.env, ...msvcEnv } : undefined,
  });
  return exitCode;
}

/** Launches `target`'s artifact in the shared terminal — via `wsl.exe` for WSL presets. */
export async function run(target: CMakeTarget, isWsl: boolean, wslDistro?: string): Promise<number> {
  const command = isWsl ? toWslPath(target.artifactPath) : target.artifactPath;
  const { exitCode } = await runCommand(command, [], {
    cwd: path.dirname(target.artifactPath),
    isWsl,
    wslDistro,
  });
  return exitCode;
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
