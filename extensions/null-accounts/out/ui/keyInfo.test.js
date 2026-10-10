'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = require("node:test");
const keyInfo_1 = require("./keyInfo");
const home = node_path_1.default.resolve('/home/me');
const managedKey = node_path_1.default.join(home, '.ssh', 'null-accounts', 'gh_ed25519');
const managedFile = managedKey.replace(/\\/g, '/'); // the form describeKeys hands its callbacks (sshKeyFile uses '/')
const base = { id: 'a1', provider: 'github', host: 'github.com', username: 'a', email: 'a@e.com', authMethod: 'oauth' };
(0, node_test_1.test)('only accounts with a key get a row; it says whether the file exists, who made it and what it is', async () => {
    const asked = [];
    const rows = await (0, keyInfo_1.describeKeys)([
        base,
        { ...base, id: 'a2', sshKeyPath: managedKey, signCommits: true },
        { ...base, id: 'a3', authMethod: 'ssh', sshKeyPath: '/elsewhere/id_ed25519' },
    ], { home, exists: f => f === managedFile, fingerprintOf: async (f) => { asked.push(f); return 'SHA256:abc'; } });
    node_assert_1.default.deepStrictEqual([...rows.keys()], ['a2', 'a3']);
    node_assert_1.default.deepStrictEqual(rows.get('a2'), {
        path: managedKey, exists: true, managed: true, fingerprint: 'SHA256:abc', signCommits: true, removable: true,
    });
    node_assert_1.default.deepStrictEqual(rows.get('a3'), {
        path: '/elsewhere/id_ed25519', exists: false, managed: false, signCommits: false, removable: false,
    });
    node_assert_1.default.deepStrictEqual(asked, [managedFile], 'a missing file is never fingerprinted');
});
(0, node_test_1.test)('a fingerprint that cannot be read leaves the row without one instead of failing the panel', async () => {
    const rows = await (0, keyInfo_1.describeKeys)([{ ...base, sshKeyPath: managedKey }], { home, exists: () => true, fingerprintOf: async () => { throw new Error('boom'); } });
    node_assert_1.default.strictEqual(rows.get('a1')?.exists, true);
    node_assert_1.default.ok(!('fingerprint' in (rows.get('a1') ?? {})));
});
//# sourceMappingURL=keyInfo.test.js.map