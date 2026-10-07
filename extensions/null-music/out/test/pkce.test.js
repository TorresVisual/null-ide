'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const pkce_1 = require("../auth/pkce");
(0, node_test_1.test)('base64UrlEncode correctly removes padding and replaces URL-unsafe chars', () => {
    const buf = Buffer.from('test string with + / and = padding');
    const encoded = (0, pkce_1.base64UrlEncode)(buf);
    node_assert_1.default.ok(!encoded.includes('+'), 'should not contain +');
    node_assert_1.default.ok(!encoded.includes('/'), 'should not contain /');
    node_assert_1.default.ok(!encoded.includes('='), 'should not contain =');
});
(0, node_test_1.test)('generateRandomString produces string of expected length', () => {
    const str32 = (0, pkce_1.generateRandomString)(32);
    node_assert_1.default.strictEqual(str32.length, 32);
    const str64 = (0, pkce_1.generateRandomString)(64);
    node_assert_1.default.strictEqual(str64.length, 64);
});
(0, node_test_1.test)('generatePkcePair creates matching verifier and challenge', () => {
    const pair = (0, pkce_1.generatePkcePair)();
    node_assert_1.default.ok(pair.verifier.length >= 43 && pair.verifier.length <= 128);
    node_assert_1.default.ok(pair.challenge.length > 0);
    const expectedChallenge = (0, pkce_1.generateCodeChallenge)(pair.verifier);
    node_assert_1.default.strictEqual(pair.challenge, expectedChallenge);
});
//# sourceMappingURL=pkce.test.js.map