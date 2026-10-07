'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeVault = exports.FakeMeta = void 0;
exports.fakePost = fakePost;
exports.fakeClock = fakeClock;
/** In-memory stand-in for vscode.Memento, shared by the unit tests. */
class FakeMeta {
    data = new Map();
    get(key) { return this.data.get(key); }
    async update(key, value) { this.data.set(key, structuredClone(value)); }
}
exports.FakeMeta = FakeMeta;
/** In-memory stand-in for vscode.SecretStorage, shared by the unit tests. */
class FakeVault {
    data = new Map();
    async get(key) { return this.data.get(key); }
    async store(key, value) { this.data.set(key, value); }
    async delete(key) { this.data.delete(key); }
}
exports.FakeVault = FakeVault;
/** A `PostForm` that answers from a queue (status defaults to 200) and records what it was asked. */
function fakePost(...replies) {
    const calls = [];
    const post = async (url, form) => {
        calls.push({ url, form });
        const next = replies.shift();
        if (!next) {
            throw new Error('unexpected extra request');
        }
        return { status: next.status ?? 200, body: next.body };
    };
    return { post, calls };
}
/** A clock whose `sleep` just advances time, so polling tests run instantly. */
function fakeClock() {
    let t = 1_000_000;
    const slept = [];
    return { slept, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } };
}
//# sourceMappingURL=testFakes.js.map