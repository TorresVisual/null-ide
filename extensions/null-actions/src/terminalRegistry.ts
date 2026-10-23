'use strict';

export interface TerminalHandle {
  readonly name: string;
  sendText(text: string, addNewLine?: boolean): void;
  show(preserveFocus?: boolean): void;
}

export interface TerminalExecution {
  /** Resolves when the command ends; undefined if the exit code is unknown (or the terminal was closed). */
  readonly exitCode: Promise<number | undefined>;
}

/** A button's command running as a VS Code task, so its output feeds a problem matcher. */
export interface TaskRun extends TerminalExecution {
  terminate(): void;
  show(): void;
}

export interface TerminalHost {
  listTerminals(): TerminalHandle[];
  createTerminal(options: { name: string; cwd?: string }): TerminalHandle;
  /**
   * Runs `command` through shell integration so its end and exit code can be
   * observed. Resolves undefined (nothing sent) when shell integration isn't
   * active -- the caller then falls back to `sendText`. Optional: hosts
   * without it behave like the old fire-and-forget dispatch.
   */
  execute?(terminal: TerminalHandle, command: string): Promise<TerminalExecution | undefined>;
  /** Runs `command` as a task whose output is scanned by `problemMatcher`. Optional like `execute`. */
  runTask?(label: string, command: string, options: { cwd?: string; focus?: boolean; problemMatcher: string }): Promise<TaskRun>;
}

export type ButtonRunState =
  | { kind: 'running' }
  | { kind: 'passed' | 'failed' | 'ended'; exitCode: number | undefined; durationMs: number };

export type StateListener = (buttonId: string, state: ButtonRunState | undefined) => void;

const CTRL_C = '';

function terminalNameForLabel(label: string): string {
  return `Action: ${label}`;
}

export class TerminalRegistry {
  private cache = new Map<string, TerminalHandle>();
  private states = new Map<string, ButtonRunState>();
  // Settles when the button's current run is over; lets restart wait for Ctrl+C to take effect.
  private runs = new Map<string, Promise<void>>();
  // Buttons whose latest run was a task; kept after it ends so a failed result can still reveal its terminal.
  private tasks = new Map<string, TaskRun>();
  private listeners = new Set<StateListener>();

  constructor(private readonly host: TerminalHost, private readonly now: () => number = Date.now) {}

  onDidChangeState(listener: StateListener): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => { this.listeners.delete(listener); } };
  }

  getState(buttonId: string): ButtonRunState | undefined {
    return this.states.get(buttonId);
  }

  isBusy(buttonId: string): boolean {
    return this.states.get(buttonId)?.kind === 'running';
  }

  async dispatch(buttonId: string, label: string, command: string, options: { cwd?: string; focus?: boolean; problemMatcher?: string } = {}): Promise<void> {
    if (options.problemMatcher && this.host.runTask) {
      return this.dispatchTask(buttonId, label, command, { ...options, problemMatcher: options.problemMatcher });
    }
    this.tasks.delete(buttonId);
    const terminal = this.resolve(buttonId, label, options.cwd);
    // Mark busy before awaiting: a new terminal may wait for shell integration,
    // and a second click in that window must not type into the starting command.
    const startedAt = this.now();
    this.setState(buttonId, { kind: 'running' });
    let execution: TerminalExecution | undefined;
    try {
      execution = await this.host.execute?.(terminal, command);
    } catch {
      execution = undefined; // e.g. terminal disposed mid-wait; fall back to sendText
    }
    if (execution) {
      this.track(buttonId, execution, startedAt);
    } else {
      this.setState(buttonId, undefined);
      terminal.sendText(command);
    }
    if (options.focus) {
      terminal.show(false);
    }
  }

  private async dispatchTask(buttonId: string, label: string, command: string, options: { cwd?: string; focus?: boolean; problemMatcher: string }): Promise<void> {
    const startedAt = this.now();
    this.setState(buttonId, { kind: 'running' });
    try {
      const task = await this.host.runTask!(label, command, options);
      this.tasks.set(buttonId, task);
      this.track(buttonId, task, startedAt);
    } catch (err) {
      this.setState(buttonId, undefined);
      throw err;
    }
  }

  private track(buttonId: string, execution: TerminalExecution, startedAt: number): void {
    const run = execution.exitCode.then(exitCode => {
      if (this.runs.get(buttonId) !== run) { return; } // a newer run owns the state
      this.runs.delete(buttonId);
      const kind = exitCode === undefined ? 'ended' : exitCode === 0 ? 'passed' : 'failed';
      this.setState(buttonId, { kind, exitCode, durationMs: this.now() - startedAt });
    });
    this.runs.set(buttonId, run);
  }

  /** Reveals the button's terminal if it still exists. */
  show(buttonId: string): void {
    const task = this.tasks.get(buttonId);
    if (task) { task.show(); } else { this.cache.get(buttonId)?.show(false); }
  }

  /** Sends Ctrl+C, then waits (up to `timeoutMs`) for the running command to end. */
  async interrupt(buttonId: string, timeoutMs = 3000): Promise<void> {
    const task = this.tasks.get(buttonId);
    if (task) { task.terminate(); } else { this.cache.get(buttonId)?.sendText(CTRL_C, false); }
    const run = this.runs.get(buttonId);
    if (!run) { return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([run, new Promise<void>(r => { timer = setTimeout(r, timeoutMs); })]);
    clearTimeout(timer);
  }

  forget(buttonId: string): void {
    this.cache.delete(buttonId);
    this.tasks.delete(buttonId);
    this.runs.delete(buttonId);
    this.setState(buttonId, undefined);
  }

  private setState(buttonId: string, state: ButtonRunState | undefined): void {
    if (state) { this.states.set(buttonId, state); } else { this.states.delete(buttonId); }
    for (const l of this.listeners) { l(buttonId, state); }
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
    // Skip terminals another button already owns, so same-label buttons don't share one.
    const claimed = new Set([...this.cache].filter(([id]) => id !== buttonId).map(([, t]) => t));
    const matches = live.filter(t => t.name === name && !claimed.has(t));
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
