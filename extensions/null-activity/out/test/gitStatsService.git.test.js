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
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const gitExec_1 = require("../gitExec");
const gitStatsService_1 = require("../gitStatsService");
const stats_1 = require("../stats");
const skip = (0, node_child_process_1.spawnSync)('git', ['--version']).status !== 0 && 'git is not on PATH';
function git(cwd, args, env = {}) {
    (0, node_child_process_1.execFileSync)('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}
function commit(cwd, files, iso, author) {
    for (const [name, text] of Object.entries(files))
        fs.writeFileSync(path.join(cwd, name), text);
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-q', '-m', 'c'], {
        GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso,
        GIT_AUTHOR_NAME: 'T', GIT_COMMITTER_NAME: 'T', GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: author,
    });
}
(0, node_test_1.test)('real repository: own commits only, local branches included, windowed by committer time', { skip }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-git-'));
    try {
        git(dir, ['init', '-q', '-b', 'main']);
        git(dir, ['config', 'user.email', 'me@example.com']);
        git(dir, ['config', 'user.name', 'T']);
        git(dir, ['config', 'core.autocrlf', 'false']);
        commit(dir, { 'a.txt': '1\n2\n3\n' }, '2026-10-05T10:00:00Z', 'me@example.com');
        commit(dir, { 'a.txt': '1\n2\n3b\n4\n5\n', 'b.txt': 'x\n' }, '2026-10-06T10:00:00Z', 'me@example.com');
        commit(dir, { 'c.txt': 'c\n' }, '2026-10-06T11:00:00Z', 'other@example.com');
        git(dir, ['checkout', '-q', '-b', 'side']);
        commit(dir, { 'd.txt': '1\n2\n3\n4\n' }, '2026-10-07T10:00:00Z', 'me@example.com');
        git(dir, ['checkout', '-q', 'main']); // `side` is no longer checked out
        const service = new gitStatsService_1.GitStatsService({
            folders: () => [dir], trusted: () => true, resolveKey: () => 'repo', exec: gitExec_1.execGit, now: () => Date.now(), log: () => { },
        });
        const all = await service.load(stats_1.ALL_TIME);
        node_assert_1.default.deepStrictEqual(all?.byProject.repo, { commits: 3, filesChanged: 3, linesAdded: 11, linesRemoved: 1 });
        const oct6 = { from: Date.parse('2026-10-06T00:00:00Z'), to: Date.parse('2026-10-07T00:00:00Z') };
        const day = await service.load(oct6);
        node_assert_1.default.deepStrictEqual(day?.byProject.repo, { commits: 1, filesChanged: 2, linesAdded: 4, linesRemoved: 1 });
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
(0, node_test_1.test)('a folder that is not a repository yields no result and does not throw', { skip }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'null-activity-nogit-'));
    try {
        const service = new gitStatsService_1.GitStatsService({
            folders: () => [dir], trusted: () => true, resolveKey: () => 'none', exec: gitExec_1.execGit, now: () => Date.now(), log: () => { },
        });
        node_assert_1.default.strictEqual(await service.load(stats_1.ALL_TIME), undefined);
    }
    finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
//# sourceMappingURL=gitStatsService.git.test.js.map