"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetStore = void 0;
// What the viewers read assets through: cache first, otherwise queue an export. One engine run at a
// time; requests made during a run, or in the same tick, go out together in the next run.
class AssetStore {
    backend;
    waiting = new Map();
    inflight = new Map();
    listeners = new Set();
    busy = false;
    constructor(backend) {
        this.backend = backend;
    }
    peek(file) {
        return this.backend.peek(file);
    }
    async get(file, o = {}) {
        const [r] = await this.getMany([file], o);
        if ('error' in r)
            throw new Error(r.error);
        return r.doc;
    }
    getMany(files, o = {}) {
        return Promise.all(files.map((f) => this.request(f, o.force === true)));
    }
    onState(listener) {
        this.listeners.add(listener);
        return { dispose: () => void this.listeners.delete(listener) };
    }
    emit(file, s) {
        for (const l of this.listeners)
            l(file, s);
    }
    request(file, force) {
        if (!force) {
            const doc = this.backend.peek(file);
            if (doc)
                return Promise.resolve({ file, doc });
            const flying = this.inflight.get(file);
            if (flying)
                return flying;
        }
        const queued = this.waiting.get(file);
        if (queued) {
            queued.force ||= force;
            return queued.promise;
        }
        let settle;
        const promise = new Promise((resolve) => (settle = resolve));
        this.waiting.set(file, { force, promise, settle });
        this.emit(file, { state: 'queued' });
        queueMicrotask(() => void this.pump());
        return promise;
    }
    async pump() {
        if (this.busy || this.waiting.size === 0)
            return;
        this.busy = true;
        try {
            const batch = [...this.waiting.entries()];
            this.waiting.clear();
            // Forced and ordinary requests need different CLI flags, so they go out as two runs.
            for (const force of [false, true]) {
                const group = batch.filter(([, w]) => w.force === force);
                if (group.length > 0)
                    await this.runGroup(group, force);
            }
        }
        finally {
            this.busy = false;
        }
        void this.pump();
    }
    async runGroup(group, force) {
        for (const [file, w] of group) {
            this.inflight.set(file, w.promise);
            this.emit(file, { state: 'exporting' });
        }
        let errors = new Map();
        let crashed;
        try {
            errors = await this.backend.run(group.map(([f]) => f), force);
        }
        catch (e) {
            crashed = e.message;
        }
        for (const [file, w] of group) {
            const doc = this.backend.peek(file);
            const result = doc
                ? { file, doc }
                : { file, error: errors.get(file) ?? crashed ?? 'the export produced no cache entry' };
            this.inflight.delete(file);
            this.emit(file, doc ? { state: 'ready', doc } : { state: 'failed', error: result.error });
            w.settle(result);
        }
    }
}
exports.AssetStore = AssetStore;
//# sourceMappingURL=assetStore.js.map