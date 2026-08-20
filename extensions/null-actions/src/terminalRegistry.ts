'use strict';

export interface TerminalHandle {
  readonly name: string;
  sendText(text: string, addNewLine?: boolean): void;
  show(preserveFocus?: boolean): void;
}

export interface TerminalHost {
  listTerminals(): TerminalHandle[];
  createTerminal(options: { name: string; cwd?: string }): TerminalHandle;
}

function terminalNameForButton(buttonId: string): string {
  return `Action: ${buttonId}`;
}

export class TerminalRegistry {
  private cache = new Map<string, TerminalHandle>();

  constructor(private readonly host: TerminalHost) {}

  dispatch(buttonId: string, command: string, options: { cwd?: string; focus?: boolean } = {}): void {
    const terminal = this.resolve(buttonId, options.cwd);
    terminal.sendText(command);
    if (options.focus) {
      terminal.show(false);
    }
  }

  forget(buttonId: string): void {
    this.cache.delete(buttonId);
  }

  private resolve(buttonId: string, cwd?: string): TerminalHandle {
    const name = terminalNameForButton(buttonId);
    const live = this.host.listTerminals();

    // Never trust the in-memory cache alone — it resets on extension-host
    // restart, but VS Code frequently restores the actual terminal objects
    // from the previous session (persistent sessions). Re-validate liveness
    // against the host on every dispatch.
    const cached = this.cache.get(buttonId);
    if (cached && live.includes(cached)) {
      return cached;
    }

    // No live cached reference — look for a terminal VS Code already has
    // open under this button's name (adopts a restored session terminal,
    // or a leftover duplicate from before this fix) instead of creating a
    // new one. `vscode.window.terminals` is ordered by creation, so the
    // last match is the most recently created one.
    const matches = live.filter(t => t.name === name);
    if (matches.length > 0) {
      const adopted = matches[matches.length - 1];
      this.cache.set(buttonId, adopted);
      return adopted;
    }

    const created = this.host.createTerminal({ name, cwd });
    this.cache.set(buttonId, created);
    return created;
  }
}
