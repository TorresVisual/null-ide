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
const cryptoBox_1 = require("./cryptoBox");
const PASS = 'correct horse battery staple';
(0, node_test_1.describe)('seal / open', () => {
    const key = Buffer.alloc(32, 7);
    (0, node_test_1.it)('round-trips text, including unicode, CRLF and empty', () => {
        for (const text of ['', 'hello', '{"a": "päss 日本語 🚀"}\r\n']) {
            assert.equal((0, cryptoBox_1.open)(key, 'x.enc', (0, cryptoBox_1.seal)(key, 'x.enc', text)), text);
        }
    });
    (0, node_test_1.it)('uses a fresh IV every time', () => {
        assert.notEqual((0, cryptoBox_1.seal)(key, 'x', 'a'), (0, cryptoBox_1.seal)(key, 'x', 'a'));
    });
    (0, node_test_1.it)('fails for the wrong key', () => {
        assert.equal((0, cryptoBox_1.open)(Buffer.alloc(32, 8), 'x', (0, cryptoBox_1.seal)(key, 'x', 'secret')), undefined);
    });
    (0, node_test_1.it)('fails when the file name differs (a ciphertext moved to another name)', () => {
        assert.equal((0, cryptoBox_1.open)(key, 'y', (0, cryptoBox_1.seal)(key, 'x', 'secret')), undefined);
    });
    (0, node_test_1.it)('fails when a ciphertext bit is flipped', () => {
        const e = JSON.parse((0, cryptoBox_1.seal)(key, 'x', 'secret'));
        const data = Buffer.from(e.data, 'base64');
        data[0] ^= 1;
        e.data = data.toString('base64');
        assert.equal((0, cryptoBox_1.open)(key, 'x', JSON.stringify(e)), undefined);
    });
    (0, node_test_1.it)('fails for a truncated auth tag', () => {
        const e = JSON.parse((0, cryptoBox_1.seal)(key, 'x', 'secret'));
        e.tag = Buffer.from(e.tag, 'base64').subarray(0, 4).toString('base64');
        assert.equal((0, cryptoBox_1.open)(key, 'x', JSON.stringify(e)), undefined);
    });
    (0, node_test_1.it)('rejects garbage and unknown versions without throwing', () => {
        for (const t of ['', 'not json', '{}', 'null', '{"v":2,"iv":"","tag":"","data":""}']) {
            assert.equal((0, cryptoBox_1.open)(key, 'x', t), undefined, t);
        }
    });
});
(0, node_test_1.describe)('manifest', () => {
    (0, node_test_1.it)('unlocks with the right passphrase and not with a wrong one', async () => {
        const { manifest, key } = await (0, cryptoBox_1.makeManifest)(PASS);
        const text = JSON.stringify(manifest);
        assert.deepEqual(await (0, cryptoBox_1.unlock)(PASS, text), key);
        assert.equal(await (0, cryptoBox_1.unlock)(`${PASS}!`, text), undefined);
    });
    (0, node_test_1.it)('treats a unicode passphrase the same however it is composed', async () => {
        const composed = 'paßwörd 日本語 123';
        const decomposed = composed.normalize('NFD');
        assert.notEqual(composed, decomposed);
        const { manifest } = await (0, cryptoBox_1.makeManifest)(composed);
        assert.ok(await (0, cryptoBox_1.unlock)(decomposed, JSON.stringify(manifest)));
    });
    (0, node_test_1.it)('refuses a missing manifest, garbage, or other KDF parameters', async () => {
        const { manifest } = await (0, cryptoBox_1.makeManifest)(PASS);
        assert.equal(await (0, cryptoBox_1.unlock)(PASS, undefined), undefined);
        assert.equal(await (0, cryptoBox_1.unlock)(PASS, 'nope'), undefined);
        assert.equal(await (0, cryptoBox_1.unlock)(PASS, JSON.stringify({ ...manifest, N: 2 ** 20 })), undefined);
        assert.equal(await (0, cryptoBox_1.unlock)(PASS, JSON.stringify({ ...manifest, v: 2 })), undefined);
    });
});
(0, node_test_1.describe)('passphraseProblem', () => {
    (0, node_test_1.it)('requires 12 characters and a matching confirmation', () => {
        assert.match((0, cryptoBox_1.passphraseProblem)('short', 'short'), /12/);
        assert.match((0, cryptoBox_1.passphraseProblem)('long enough passphrase', 'different one here'), /match/);
        assert.equal((0, cryptoBox_1.passphraseProblem)('long enough passphrase', 'long enough passphrase'), undefined);
    });
    (0, node_test_1.it)('counts characters', () => {
        assert.equal((0, cryptoBox_1.passphraseProblem)('123456789012', '123456789012'), undefined);
        assert.match((0, cryptoBox_1.passphraseProblem)('12345678901', '12345678901'), /12/);
    });
});
//# sourceMappingURL=cryptoBox.test.js.map