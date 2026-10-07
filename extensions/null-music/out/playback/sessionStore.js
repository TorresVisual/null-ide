'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionStore = void 0;
const KEY = 'null-music.session';
class SessionStore {
    state;
    constructor(state) {
        this.state = state;
    }
    /** Returns undefined for anything missing or malformed — a bad session must never block startup. */
    load() {
        try {
            const v = this.state.get(KEY, undefined);
            if (!v || !Array.isArray(v.trackIds) || !v.trackIds.every((id) => typeof id === 'string'))
                return undefined;
            return {
                trackIds: v.trackIds,
                index: Number.isInteger(v.index) ? v.index : 0,
                positionMs: Number.isFinite(v.positionMs) && v.positionMs > 0 ? v.positionMs : 0,
                volume: Number.isFinite(v.volume) ? Math.max(0, Math.min(100, v.volume)) : 80,
                shuffle: v.shuffle === true,
                repeat: v.repeat === 'track' || v.repeat === 'context' ? v.repeat : 'off',
            };
        }
        catch {
            return undefined;
        }
    }
    save(data) {
        try {
            void Promise.resolve(this.state.update(KEY, data)).catch(() => { });
        }
        catch {
            // ignore: the session is best-effort
        }
    }
}
exports.SessionStore = SessionStore;
//# sourceMappingURL=sessionStore.js.map