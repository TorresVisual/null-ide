'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalRegistry = void 0;
function terminalNameForLabel(label) {
    return `Action: ${label}`;
}
class TerminalRegistry {
    host;
    cache = new Map();
    constructor(host) {
        this.host = host;
    }
    dispatch(buttonId, label, command, options = {}) {
        const terminal = this.resolve(buttonId, label, options.cwd);
        terminal.sendText(command);
        if (options.focus) {
            terminal.show(false);
        }
    }
    forget(buttonId) {
        this.cache.delete(buttonId);
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
exports.TerminalRegistry = TerminalRegistry;
//# sourceMappingURL=terminalRegistry.js.map