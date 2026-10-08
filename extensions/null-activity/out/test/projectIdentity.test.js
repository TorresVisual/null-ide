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
const projectIdentity_1 = require("../projectIdentity");
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-proj-'));
function repo(root, remotes, head = 'ref: refs/heads/main\n') {
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    fs.writeFileSync(path.join(root, '.git', 'HEAD'), head);
    const sections = Object.entries(remotes).map(([name, url]) => `[remote "${name}"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/${name}/*\n`);
    fs.writeFileSync(path.join(root, '.git', 'config'), `[core]\n\tbare = false\n${sections.join('')}`);
}
(0, node_test_1.test)('normalizeRemote makes ssh, https and credentialed urls identical', () => {
    const want = 'github.com/torres/null-ide';
    for (const url of [
        'git@github.com:Torres/Null-IDE.git',
        'https://github.com/Torres/null-ide.git',
        'https://user:tok@github.com/torres/null-ide',
        'ssh://git@github.com/torres/null-ide.git/',
    ]) {
        node_assert_1.default.strictEqual((0, projectIdentity_1.normalizeRemote)(url), want, url);
    }
});
(0, node_test_1.test)('no folder', () => {
    node_assert_1.default.deepStrictEqual((0, projectIdentity_1.resolveProject)(undefined), { key: projectIdentity_1.NO_FOLDER, name: projectIdentity_1.NO_FOLDER });
});
(0, node_test_1.test)('a folder without git is keyed by its normalized path', () => {
    const dir = path.join(tmpDir(), 'proj');
    fs.mkdirSync(dir);
    const want = path.resolve(dir).replace(/\\/g, '/');
    const r = (0, projectIdentity_1.resolveProject)(dir);
    node_assert_1.default.strictEqual(r.key, process.platform === 'win32' ? want.toLowerCase() : want);
    node_assert_1.default.strictEqual(r.name, 'proj');
    node_assert_1.default.strictEqual(r.branch, undefined);
});
(0, node_test_1.test)('git without a remote falls back to the path and still reports the branch', () => {
    const dir = path.join(tmpDir(), 'local-only');
    repo(dir, {});
    const r = (0, projectIdentity_1.resolveProject)(dir);
    const want = path.resolve(dir).replace(/\\/g, '/');
    node_assert_1.default.strictEqual(r.key, process.platform === 'win32' ? want.toLowerCase() : want);
    node_assert_1.default.strictEqual(r.branch, 'main');
});
(0, node_test_1.test)('ssh and https checkouts of the same repo share a key; origin wins over other remotes', () => {
    const base = tmpDir();
    repo(path.join(base, 'one'), { upstream: 'https://github.com/other/fork.git', origin: 'git@github.com:Torres/null-ide.git' });
    repo(path.join(base, 'two'), { origin: 'https://github.com/torres/null-ide.git' });
    node_assert_1.default.strictEqual((0, projectIdentity_1.resolveProject)(path.join(base, 'one')).key, 'github.com/torres/null-ide');
    node_assert_1.default.strictEqual((0, projectIdentity_1.resolveProject)(path.join(base, 'two')).key, 'github.com/torres/null-ide');
});
(0, node_test_1.test)('renaming the folder keeps the key and changes only the name', () => {
    const base = tmpDir();
    repo(path.join(base, 'before'), { origin: 'git@github.com:o/r.git' });
    const before = (0, projectIdentity_1.resolveProject)(path.join(base, 'before'));
    fs.renameSync(path.join(base, 'before'), path.join(base, 'after'));
    const after = (0, projectIdentity_1.resolveProject)(path.join(base, 'after'));
    node_assert_1.default.strictEqual(after.key, before.key);
    node_assert_1.default.deepStrictEqual([before.name, after.name], ['before', 'after']);
});
(0, node_test_1.test)('a detached HEAD has no branch', () => {
    const dir = path.join(tmpDir(), 'det');
    repo(dir, { origin: 'git@github.com:o/r.git' }, '0123456789abcdef0123456789abcdef01234567\n');
    node_assert_1.default.strictEqual((0, projectIdentity_1.resolveProject)(dir).branch, undefined);
});
(0, node_test_1.test)('a subfolder walks up to the repo; the name is the subfolder', () => {
    const base = tmpDir();
    repo(path.join(base, 'mono'), { origin: 'git@github.com:o/mono.git' });
    const sub = path.join(base, 'mono', 'packages', 'app');
    fs.mkdirSync(sub, { recursive: true });
    const r = (0, projectIdentity_1.resolveProject)(sub);
    node_assert_1.default.deepStrictEqual([r.key, r.name], ['github.com/o/mono', 'app']);
});
(0, node_test_1.test)('a git worktree (.git file) uses the common config and its own HEAD', () => {
    const base = tmpDir();
    const main = path.join(base, 'main');
    repo(main, { origin: 'git@github.com:o/r.git' });
    const wtGit = path.join(main, '.git', 'worktrees', 'wt');
    fs.mkdirSync(wtGit, { recursive: true });
    fs.writeFileSync(path.join(wtGit, 'HEAD'), 'ref: refs/heads/issue-1-x\n');
    fs.writeFileSync(path.join(wtGit, 'commondir'), '../..\n');
    const wt = path.join(base, 'wt');
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${wtGit}\n`);
    node_assert_1.default.deepStrictEqual((0, projectIdentity_1.resolveProject)(wt), { key: 'github.com/o/r', name: 'wt', branch: 'issue-1-x' });
});
//# sourceMappingURL=projectIdentity.test.js.map