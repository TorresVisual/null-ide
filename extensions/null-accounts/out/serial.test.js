'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const serial_1 = require("./serial");
(0, node_test_1.test)('serial runs tasks one at a time, in the order they were queued', async () => {
    const run = (0, serial_1.serial)();
    const log = [];
    const slow = run(async () => { log.push('a:start'); await new Promise(r => setTimeout(r, 20)); log.push('a:end'); });
    const fast = run(async () => { log.push('b'); });
    await Promise.all([slow, fast]);
    node_assert_1.default.deepStrictEqual(log, ['a:start', 'a:end', 'b']);
});
(0, node_test_1.test)('serial: a failing task rejects its own caller but not the queue behind it', async () => {
    const run = (0, serial_1.serial)();
    const failed = run(async () => { throw new Error('boom'); });
    const next = run(async () => 'still runs');
    await node_assert_1.default.rejects(failed, /boom/);
    node_assert_1.default.strictEqual(await next, 'still runs');
});
//# sourceMappingURL=serial.test.js.map