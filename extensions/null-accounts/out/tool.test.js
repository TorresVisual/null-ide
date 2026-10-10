'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const tool_1 = require("./tool");
(0, node_test_1.test)('runTool reports the exit code and output; a program that cannot start is TOOL_UNAVAILABLE', async () => {
    const ok = await (0, tool_1.runTool)(process.execPath, ['-e', 'console.log("hi")']);
    node_assert_1.default.deepStrictEqual([ok.code, ok.stdout.trim()], [0, 'hi']);
    node_assert_1.default.strictEqual((await (0, tool_1.runTool)(process.execPath, ['-e', 'process.exit(3)'])).code, 3);
    node_assert_1.default.strictEqual((await (0, tool_1.runTool)('null-accounts-no-such-tool', [])).code, tool_1.TOOL_UNAVAILABLE);
});
(0, node_test_1.test)('runTool merges env over the current environment', async () => {
    const r = await (0, tool_1.runTool)(process.execPath, ['-e', 'console.log(process.env.NULL_ACCOUNTS_X)'], { env: { NULL_ACCOUNTS_X: 'yes' } });
    node_assert_1.default.strictEqual(r.stdout.trim(), 'yes');
});
(0, node_test_1.test)('runTool closes stdin, so a tool that waits for input ends instead of hanging', async () => {
    const r = await (0, tool_1.runTool)(process.execPath, ['-e', 'process.stdin.on("end", () => console.log("eof")).resume()'], { timeoutMs: 5000 });
    node_assert_1.default.strictEqual(r.stdout.trim(), 'eof');
});
//# sourceMappingURL=tool.test.js.map