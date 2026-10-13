"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = __importStar(require("node:assert/strict"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const lock_1 = require("./lock");
const made = [];
(0, node_test_1.afterEach)(() => {
    for (const dir of made.splice(0))
        fs.rmSync(dir, { recursive: true, force: true });
});
const lockPath = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-lock-'));
    made.push(dir);
    return path.join(dir, 'nested', 'lock');
};
(0, node_test_1.describe)('acquire', () => {
    (0, node_test_1.it)('creates the folder and holds the lock until released', async () => {
        const lock = lockPath();
        const release = await (0, lock_1.acquire)(lock);
        assert.ok(release);
        assert.equal(await (0, lock_1.acquire)(lock), undefined, 'a second window must not get it');
        await release();
        assert.ok(await (0, lock_1.acquire)(lock), 'free again after release');
    });
    (0, node_test_1.it)('takes over a lock older than the stale limit', async () => {
        const lock = lockPath();
        assert.ok(await (0, lock_1.acquire)(lock));
        const old = new Date(Date.now() - 10 * 60_000);
        fs.utimesSync(lock, old, old);
        assert.ok(await (0, lock_1.acquire)(lock), 'a crashed window must not block sync forever');
    });
    (0, node_test_1.it)('does not take over a fresh lock', async () => {
        const lock = lockPath();
        assert.ok(await (0, lock_1.acquire)(lock));
        assert.equal(await (0, lock_1.acquire)(lock, Date.now, 60_000), undefined);
    });
    (0, node_test_1.it)('returns undefined instead of throwing when the path is unusable', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-sync-lock-'));
        made.push(dir);
        fs.writeFileSync(path.join(dir, 'file'), 'x');
        assert.equal(await (0, lock_1.acquire)(path.join(dir, 'file', 'lock')), undefined);
    });
});
//# sourceMappingURL=lock.test.js.map