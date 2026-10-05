'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const createExtras_1 = require("./createExtras");
(0, node_test_1.default)('runCreateExtras reports a failing step by name and still runs the rest', async () => {
    const ran = [];
    const problems = await (0, createExtras_1.runCreateExtras)([
        { what: 'set the type', run: async () => { throw new Error('forbidden'); } },
        { what: 'link it to #3', run: async () => { ran.push('parent'); } },
    ]);
    node_assert_1.default.deepStrictEqual(problems, ["couldn't set the type (forbidden)"]);
    node_assert_1.default.deepStrictEqual(ran, ['parent']);
});
(0, node_test_1.default)('runCreateExtras reports every failure, in order', async () => {
    const problems = await (0, createExtras_1.runCreateExtras)([
        { what: 'set the type', run: async () => { throw new Error('a'); } },
        { what: 'link it to #3', run: async () => { throw new Error('b'); } },
    ]);
    node_assert_1.default.deepStrictEqual(problems, ["couldn't set the type (a)", "couldn't link it to #3 (b)"]);
});
(0, node_test_1.default)('runCreateExtras returns nothing when every step works, and for no steps', async () => {
    node_assert_1.default.deepStrictEqual(await (0, createExtras_1.runCreateExtras)([{ what: 'x', run: async () => undefined }]), []);
    node_assert_1.default.deepStrictEqual(await (0, createExtras_1.runCreateExtras)([]), []);
});
//# sourceMappingURL=createExtras.test.js.map