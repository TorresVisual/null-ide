'use strict';
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const sshConfig_1 = require("./sshConfig");
const tugraz = {
    id: 'a1', provider: 'gitlab', host: 'gitlab-teaching.tugraz.at', username: 'me', email: 'me@example.com',
    authMethod: 'ssh', sshKeyPath: 'C:\\Users\\me\\.ssh\\null-accounts\\tugraz_ed25519',
};
const github = { ...tugraz, id: 'a2', provider: 'github', host: 'github.com', authMethod: 'oauth', sshKeyPath: '~/.ssh/gh' };
(0, node_test_1.test)('each host gets one block with its keys; accounts without a key are left out', () => {
    const noKey = { ...github, id: 'a3', host: 'gitlab.com', sshKeyPath: undefined };
    const second = { ...github, id: 'a4', sshKeyPath: '~/.ssh/gh2' };
    node_assert_1.default.strictEqual((0, sshConfig_1.renderHostBlocks)([tugraz, github, noKey, second], 'C:\\Users\\me'), [
        'Host gitlab-teaching.tugraz.at',
        '  IdentityFile "C:/Users/me/.ssh/null-accounts/tugraz_ed25519"',
        '  IdentitiesOnly yes',
        '',
        'Host github.com',
        '  IdentityFile "C:/Users/me/.ssh/gh"',
        '  IdentityFile "C:/Users/me/.ssh/gh2"',
        '  IdentitiesOnly yes',
        '',
    ].join('\n'));
});
(0, node_test_1.test)('a port is dropped from the host; a key or host that could inject a directive is skipped', () => {
    const ported = { ...tugraz, host: 'git.example.org:8443' };
    node_assert_1.default.match((0, sshConfig_1.renderHostBlocks)([ported], '/h'), /^Host git\.example\.org\n/);
    node_assert_1.default.strictEqual((0, sshConfig_1.renderHostBlocks)([{ ...tugraz, sshKeyPath: '/k"\n  ProxyCommand evil' }], '/h'), '');
    node_assert_1.default.strictEqual((0, sshConfig_1.renderHostBlocks)([{ ...tugraz, host: '*' }], '/h'), '');
});
(0, node_test_1.test)('the Include goes first, is added once, and comes out again leaving the rest untouched', () => {
    const user = 'Host work\n  User git\n';
    const added = (0, sshConfig_1.withInclude)(user);
    node_assert_1.default.ok(added.startsWith('# Null IDE account keys'));
    node_assert_1.default.ok(added.endsWith(user));
    node_assert_1.default.strictEqual((0, sshConfig_1.withInclude)(added), added);
    node_assert_1.default.strictEqual((0, sshConfig_1.withoutInclude)(added), user);
    node_assert_1.default.strictEqual((0, sshConfig_1.withoutInclude)((0, sshConfig_1.withInclude)('')), '');
    const crlf = 'Host work\r\n  User git\r\n';
    node_assert_1.default.strictEqual((0, sshConfig_1.withoutInclude)((0, sshConfig_1.withInclude)(crlf)), crlf);
});
(0, node_test_1.test)('sync creates both files, leaves an existing config intact, and cleans up when the last key goes', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'null-ssh-'));
    try {
        const userFile = path.join(home, '.ssh', 'config');
        const managed = path.join(home, '.ssh', 'null-accounts', 'config');
        fs.mkdirSync(path.dirname(userFile), { recursive: true });
        fs.writeFileSync(userFile, 'Host work\n  User git\n');
        await (0, sshConfig_1.syncSshConfig)([tugraz], home);
        node_assert_1.default.ok(fs.readFileSync(managed, 'utf8').includes('Host gitlab-teaching.tugraz.at'));
        node_assert_1.default.ok(fs.readFileSync(userFile, 'utf8').includes('Include null-accounts/config'));
        node_assert_1.default.ok(fs.readFileSync(userFile, 'utf8').endsWith('Host work\n  User git\n'));
        await (0, sshConfig_1.syncSshConfig)([tugraz], home); // idempotent
        node_assert_1.default.strictEqual(fs.readFileSync(userFile, 'utf8').split('Include null-accounts/config').length, 2);
        await (0, sshConfig_1.syncSshConfig)([], home);
        node_assert_1.default.ok(!fs.existsSync(managed));
        node_assert_1.default.strictEqual(fs.readFileSync(userFile, 'utf8'), 'Host work\n  User git\n');
    }
    finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('with no keys and no ssh config, sync creates nothing', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'null-ssh-'));
    try {
        await (0, sshConfig_1.syncSshConfig)([], home);
        node_assert_1.default.deepStrictEqual(fs.readdirSync(home), []);
    }
    finally {
        fs.rmSync(home, { recursive: true, force: true });
    }
});
//# sourceMappingURL=sshConfig.test.js.map