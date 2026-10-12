'use strict';

import * as vscode from 'vscode';
import { TerminalExecution, TerminalHandle, TerminalHost } from './terminalRegistry';

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
