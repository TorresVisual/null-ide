'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.FakeVault = exports.FakeMeta = void 0;
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
//# sourceMappingURL=testFakes.js.map