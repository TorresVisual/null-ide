'use strict';

import * as vscode from 'vscode';
import { TaskRun, TerminalExecution, TerminalHandle, TerminalHost } from './terminalRegistry';

// Shell integration attaches a moment after a terminal's shell starts. Only
// terminals we just created are worth waiting for; one that still has none
// later (cmd.exe, unsupported shell) must not delay every click.
const INTEGRATION_WAIT_MS = 3000;

export class VscodeTerminalHost implements TerminalHost {
  private createdAt = new WeakMap<vscode.Terminal, number>();

  listTerminals(): TerminalHandle[] {
    return [...vscode.window.terminals];
  }

  createTerminal(options: { name: string; cwd?: string }): TerminalHandle {
    const terminal = vscode.window.createTerminal({ name: options.name, cwd: options.cwd });
    this.createdAt.set(terminal, Date.now());
    return terminal;
  }

  async execute(handle: TerminalHandle, command: string): Promise<TerminalExecution | undefined> {
    const terminal = handle as vscode.Terminal;
    const integration = terminal.shellIntegration ?? (await this.waitForIntegration(terminal));
    if (!integration) { return undefined; }

    const execution = integration.executeCommand(command);
    const exitCode = new Promise<number | undefined>(resolve => {
      const end = vscode.window.onDidEndTerminalShellExecution(e => {
        if (e.execution === execution) { done(e.exitCode); }
      });
      const close = vscode.window.onDidCloseTerminal(t => {
        if (t === terminal) { done(undefined); }
      });
      function done(code: number | undefined): void {
        end.dispose();
        close.dispose();
        resolve(code);
      }
    });
    return { exitCode };
  }

  async runTask(label: string, command: string, options: { cwd?: string; focus?: boolean; problemMatcher: string }): Promise<TaskRun> {
    const name = `Action: ${label}`;
    // Scope to the folder that owns the cwd (multi-root), else the first folder.
    const owner = options.cwd ? vscode.workspace.getWorkspaceFolder(vscode.Uri.file(options.cwd)) : undefined;
    const task = new vscode.Task(
      { type: 'shell' },
      owner ?? vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace,
      name,
      'null-actions',
      new vscode.ShellExecution(command, { cwd: options.cwd }),
      [options.problemMatcher],
    );
    task.presentationOptions = {
      reveal: options.focus ? vscode.TaskRevealKind.Always : vscode.TaskRevealKind.Silent,
      focus: options.focus,
      panel: vscode.TaskPanelKind.Dedicated,
      showReuseMessage: false,
    };
    const execution = await vscode.tasks.executeTask(task);
    // onDidEndTaskProcess carries the exit code; onDidEndTask is the fallback when no process ran or it was terminated.
    const exitCode = new Promise<number | undefined>(resolve => {
      const subs = [
        vscode.tasks.onDidEndTaskProcess(e => { if (e.execution === execution) { done(e.exitCode); } }),
        vscode.tasks.onDidEndTask(e => { if (e.execution === execution) { done(undefined); } }),
      ];
      function done(code: number | undefined): void {
        subs.forEach(s => s.dispose());
        resolve(code);
      }
    });
    return {
      exitCode,
      terminate: () => execution.terminate(),
      // Task terminals are titled "Task - <name>"; the API exposes no handle to them.
      show: () => vscode.window.terminals.filter(t => t.name.endsWith(name)).pop()?.show(false),
    };
  }

  private waitForIntegration(terminal: vscode.Terminal): Promise<vscode.TerminalShellIntegration | undefined> {
    const remaining = INTEGRATION_WAIT_MS - (Date.now() - (this.createdAt.get(terminal) ?? 0));
    if (remaining <= 0) { return Promise.resolve(undefined); }
    return new Promise(resolve => {
      const sub = vscode.window.onDidChangeTerminalShellIntegration(e => {
        if (e.terminal === terminal) { finish(e.shellIntegration); }
      });
      const timer = setTimeout(() => finish(undefined), remaining);
      function finish(si: vscode.TerminalShellIntegration | undefined): void {
        clearTimeout(timer);
        sub.dispose();
        resolve(si);
      }
    });
  }
}
