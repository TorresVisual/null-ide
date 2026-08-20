'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.TerminalRegistry = void 0;
function terminalNameForButton(buttonId) {
    return `Action: ${buttonId}`;
}
class TerminalRegistry {
    host;
    cache = new Map();
    constructor(host) {
        this.host = host;
    }
    dispatch(buttonId, command, options = {}) {
        const terminal = this.resolve(buttonId, options.cwd);
        terminal.sendText(command);
        if (options.focus) {
            terminal.show(false);
        }
    }
    forget(buttonId) {
        this.cache.delete(buttonId);
    }
    resolve(buttonId, cwd) {
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
exports.TerminalRegistry = TerminalRegistry;
//# sourceMappingURL=terminalRegistry.js.map