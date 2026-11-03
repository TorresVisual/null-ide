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
const lock_1 = require("./lock");
const uproject_1 = require("./uproject");
// In-memory lock files; `dead` lists the PIDs that are not running; time moves only through sleep().
function fake(initial = {}, dead = [], onSleep) {
    const files = { ...initial };
    let t = 0;
    const io = {
        create: (f, c) => (f in files ? false : ((files[f] = c), true)),
        read: (f) => files[f],
        remove: (f) => void delete files[f],
        alive: (pid) => !dead.includes(pid),
        sleep: async (ms) => {
            t += ms;
            onSleep?.(files);
        },
        now: () => t,
        pid: 7,
    };
    return { io, files };
}
(0, node_test_1.test)('the lock is held while the work runs and released after it', async () => {
    const { io, files } = fake();
    await (0, lock_1.withLock)('L', io, async () => assert.equal(JSON.parse(files.L).pid, 7));
    assert.ok(!('L' in files));
});
(0, node_test_1.test)('the lock is released when the work throws', async () => {
    const { io, files } = fake();
    await assert.rejects((0, lock_1.withLock)('L', io, async () => { throw new Error('boom'); }), /boom/);
    assert.ok(!('L' in files));
});
(0, node_test_1.test)('a lock whose owner is dead is taken over', async () => {
    const { io } = fake({ L: JSON.stringify({ pid: 99 }) }, [99]);
    assert.equal(await (0, lock_1.withLock)('L', io, async () => 'ran'), 'ran');
});
(0, node_test_1.test)('an unreadable lock file counts as stale', async () => {
    const { io } = fake({ L: 'not json' });
    assert.equal(await (0, lock_1.withLock)('L', io, async () => 'ran'), 'ran');
});
(0, node_test_1.test)('a live owner is waited for, then the work goes ahead', async () => {
    let sleeps = 0;
    const { io } = fake({ L: JSON.stringify({ pid: 99 }) }, [], (files) => {
        if (++sleeps === 3)
            delete files.L;
    });
    assert.equal(await (0, lock_1.withLock)('L', io, async () => 'ran'), 'ran');
    assert.equal(sleeps, 3);
});
(0, node_test_1.test)('waiting past the limit is a resolution error naming the owner', async () => {
    const { io } = fake({ L: JSON.stringify({ pid: 99 }) });
    await assert.rejects((0, lock_1.withLock)('L', io, async () => 'ran', 2000), (e) => e instanceof uproject_1.ResolveError && e.message.includes('pid 99'));
});
//# sourceMappingURL=lock.test.js.map