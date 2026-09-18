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

function terminalNameForLabel(label: string): string {
  return `Action: ${label}`;
}

export class TerminalRegistry {
  private cache = new Map<string, TerminalHandle>();

  constructor(private readonly host: TerminalHost) {}

  dispatch(buttonId: string, label: string, command: string, options: { cwd?: string; focus?: boolean } = {}): void {
    const terminal = this.resolve(buttonId, label, options.cwd);
    terminal.sendText(command);
    if (options.focus) {
      terminal.show(false);
    }
  }

  forget(buttonId: string): void {
    this.cache.delete(buttonId);
  }

  private resolve(buttonId: string, label: string, cwd?: string): TerminalHandle {
    const name = terminalNameForLabel(label);
    const live = this.host.listTerminals();

    // The cache is keyed by the button's stable id, never by its (editable)
    // label -- renaming a button must never look like "a different button"
    // to a session that already has a terminal open for it. VS Code's
    // Terminal.name is read-only after creation (no rename API for a
    // shell-backed terminal), so a renamed button's terminal keeps showing
    // its old label in the tab until it's closed and recreated -- a
    // cosmetic lag, not a duplicate, since the cache hit below still
    // reuses the exact same terminal regardless of what name it was
    // created under.
    const cached = this.cache.get(buttonId);
    if (cached && live.includes(cached)) {
      return cached;
    }

    // No live cached reference (e.g. after an extension-host restart) --
    // look for a terminal VS Code already has open under the *current*
    // label before creating a new one. This only matches when the label
    // hasn't changed since that terminal was created; a rename followed by
    // a restart (rather than just a restart, or just a rename) is the one
    // case this can't fully cover, given the API has no way to rename a
    // live terminal to keep its name in sync in the meantime.
    // `vscode.window.terminals` is ordered by creation, so the last match
    // is the most recently created one.
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
