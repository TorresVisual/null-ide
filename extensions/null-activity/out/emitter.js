'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.Emitter = void 0;
class Emitter {
    listeners = new Set();
    event = (listener) => {
        this.listeners.add(listener);
        return { dispose: () => void this.listeners.delete(listener) };
    };
    fire(e) {
        for (const listener of [...this.listeners]) {
            try {
                listener(e);
            }
            catch (err) {
                console.error('Null Activity: listener failed', err);
            }
        }
    }
    dispose() {
        this.listeners.clear();
    }
}
exports.Emitter = Emitter;
//# sourceMappingURL=emitter.js.map