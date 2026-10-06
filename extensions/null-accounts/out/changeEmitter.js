'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChangeEmitter = void 0;
class ChangeEmitter {
    listeners = new Set();
    event = listener => {
        this.listeners.add(listener);
        return { dispose: () => { this.listeners.delete(listener); } };
    };
    fire() {
        for (const listener of [...this.listeners]) {
            try {
                listener();
            }
            catch { /* one bad listener must not break the others or the write that fired it */ }
        }
    }
}
exports.ChangeEmitter = ChangeEmitter;
//# sourceMappingURL=changeEmitter.js.map