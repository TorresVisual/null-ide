'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalRegistry = void 0;
const CTRL_C = '';
function terminalNameForLabel(label) {
    return `Action: ${label}`;
}
class TerminalRegistry {
    host;
    now;
    cache = new Map();
    states = new Map();
    // Settles when the button's current run is over; lets restart wait for Ctrl+C to take effect.
    runs = new Map();
    // Buttons whose latest run was a task; kept after it ends so a failed result can still reveal its terminal.
    tasks = new Map();
    listeners = new Set();
    constructor(host, now = Date.now) {
        this.host = host;
        this.now = now;
    }
    onDidChangeState(listener) {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    }
    getState(buttonId) {
        return this.states.get(buttonId);
    }
    isBusy(buttonId) {
        return this.states.get(buttonId)?.kind === 'running';
    }
    async dispatch(buttonId, label, command, options = {}) {
        if (options.problemMatcher && this.host.runTask) {
            return this.dispatchTask(buttonId, label, command, { ...options, problemMatcher: options.problemMatcher });
        }
        this.tasks.delete(buttonId);
        const terminal = this.resolve(buttonId, label, options.cwd);
        // Mark busy before awaiting: a new terminal may wait for shell integration,
        // and a second click in that window must not type into the starting command.
        const startedAt = this.now();
        this.setState(buttonId, { kind: 'running' });
        let execution;
        try {
            execution = await this.host.execute?.(terminal, command);
        }
        catch {
            execution = undefined; // e.g. terminal disposed mid-wait; fall back to sendText
        }
        if (execution) {
            this.track(buttonId, execution, startedAt);
        }
        else {
            this.setState(buttonId, undefined);
            terminal.sendText(command);
        }
        if (options.focus) {
            terminal.show(false);
        }
    }
    async dispatchTask(buttonId, label, command, options) {
        const startedAt = this.now();
        this.setState(buttonId, { kind: 'running' });
        try {
            const task = await this.host.runTask(label, command, options);
            this.tasks.set(buttonId, task);
            this.track(buttonId, task, startedAt);
        }
        catch (err) {
            this.setState(buttonId, undefined);
            throw err;
        }
    }
    track(buttonId, execution, startedAt) {
        const run = execution.exitCode.then(exitCode => {
            if (this.runs.get(buttonId) !== run) {
                return;
            } // a newer run owns the state
            this.runs.delete(buttonId);
            const kind = exitCode === undefined ? 'ended' : exitCode === 0 ? 'passed' : 'failed';
            this.setState(buttonId, { kind, exitCode, durationMs: this.now() - startedAt });
        });
        this.runs.set(buttonId, run);
    }
    /** Reveals the button's terminal if it still exists. */
    show(buttonId) {
        const task = this.tasks.get(buttonId);
        if (task) {
            task.show();
        }
        else {
            this.cache.get(buttonId)?.show(false);
        }
    }
    /** Sends Ctrl+C, then waits (up to `timeoutMs`) for the running command to end. */
    async interrupt(buttonId, timeoutMs = 3000) {
        const task = this.tasks.get(buttonId);
        if (task) {
            task.terminate();
        }
        else {
            this.cache.get(buttonId)?.sendText(CTRL_C, false);
        }
        const run = this.runs.get(buttonId);
        if (!run) {
            return;
        }
        let timer;
        await Promise.race([run, new Promise(r => { timer = setTimeout(r, timeoutMs); })]);
        clearTimeout(timer);
    }
    forget(buttonId) {
        this.cache.delete(buttonId);
        this.tasks.delete(buttonId);
        this.runs.delete(buttonId);
        this.setState(buttonId, undefined);
    }
    setState(buttonId, state) {
        if (state) {
            this.states.set(buttonId, state);
        }
        else {
            this.states.delete(buttonId);
        }
        for (const l of this.listeners) {
            l(buttonId, state);
        }
    }
    resolve(buttonId, label, cwd) {
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
exports.TerminalRegistry = TerminalRegistry;
//# sourceMappingURL=terminalRegistry.js.map