'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = require("node:test");
const gitStatsService_1 = require("../gitStatsService");
const R1 = { from: Date.parse('2026-10-05T00:00:00Z'), to: Date.parse('2026-10-12T00:00:00Z') };
const R2 = { from: Date.parse('2026-10-12T00:00:00Z'), to: Date.parse('2026-10-19T00:00:00Z') };
const COMMIT = `@${Date.parse('2026-10-06T10:00:00Z') / 1000}\tme@example.com\n\n4\t1\tx.ts\n`;
const ONE = { commits: 1, filesChanged: 1, linesAdded: 4, linesRemoved: 1 };
function setup(over = {}) {
    const calls = [];
    const logs = [];
    const clock = { now: 1_000_000 };
    const inner = over.exec ?? (async (args) => (args[0] === 'config' ? 'me@example.com\n' : COMMIT));
    const service = new gitStatsService_1.GitStatsService({
        folders: () => over.folders ?? ['/a'],
        trusted: () => over.trusted ?? true,
        resolveKey: (folder) => over.keys?.[folder] ?? folder,
        exec: async (args, cwd) => {
            calls.push({ args, cwd });
            return inner(args, cwd);
        },
        now: () => clock.now,
        log: (message) => logs.push(message),
    });
    return { service, calls, logs, clock };
}
(0, node_test_1.test)('totals per project key, summed', async () => {
    const { service } = setup({ folders: ['/a', '/b'], keys: { '/a': 'ka', '/b': 'kb' } });
    const git = await service.load(R1);
    node_assert_1.default.deepStrictEqual(git, {
        totals: { commits: 2, filesChanged: 2, linesAdded: 8, linesRemoved: 2 },
        byProject: { ka: ONE, kb: ONE },
    });
});
(0, node_test_1.test)('two folders with the same key are one repo, queried once', async () => {
    const { service, calls } = setup({ folders: ['/a', '/b'], keys: { '/a': 'k', '/b': 'k' } });
    const git = await service.load(R1);
    node_assert_1.default.deepStrictEqual(git, { totals: ONE, byProject: { k: ONE } });
    node_assert_1.default.strictEqual(calls.length, 2); // config + log
});
(0, node_test_1.test)('untrusted workspace: nothing is spawned and nothing is returned', async () => {
    const { service, calls } = setup({ trusted: false });
    node_assert_1.default.deepStrictEqual(service.peek(R1), { fresh: true, git: undefined });
    node_assert_1.default.strictEqual(await service.load(R1), undefined);
    node_assert_1.default.strictEqual(calls.length, 0);
});
(0, node_test_1.test)('no user.email: the repo is dropped and the problem is logged once', async () => {
    const { service, logs, clock } = setup({
        exec: async (args) => {
            if (args[0] === 'config')
                throw new Error('exit 1');
            return COMMIT;
        },
    });
    node_assert_1.default.strictEqual(await service.load(R1), undefined);
    clock.now += gitStatsService_1.GIT_TTL_MS;
    node_assert_1.default.strictEqual(await service.load(R1), undefined);
    node_assert_1.default.strictEqual(logs.length, 1);
});
(0, node_test_1.test)('one failing repo does not affect another', async () => {
    const { service } = setup({
        folders: ['/bad', '/good'],
        exec: async (args, cwd) => {
            if (cwd === '/bad')
                throw new Error('fatal: not a git repository');
            return args[0] === 'config' ? 'me@example.com\n' : COMMIT;
        },
    });
    const git = await service.load(R1);
    node_assert_1.default.deepStrictEqual(git, { totals: ONE, byProject: { '/good': ONE } });
});
(0, node_test_1.test)('cache: reused inside the TTL, stale after it, and stale data is still returned by peek', async () => {
    const { service, calls, clock } = setup();
    await service.load(R1);
    node_assert_1.default.strictEqual(calls.length, 2);
    clock.now += gitStatsService_1.GIT_TTL_MS - 1;
    node_assert_1.default.strictEqual(service.peek(R1).fresh, true);
    await service.load(R1);
    node_assert_1.default.strictEqual(calls.length, 2);
    clock.now += 1;
    const stale = service.peek(R1);
    node_assert_1.default.strictEqual(stale.fresh, false);
    node_assert_1.default.deepStrictEqual(stale.git, { totals: ONE, byProject: { '/a': ONE } });
    await service.load(R1);
    node_assert_1.default.strictEqual(calls.length, 4);
});
(0, node_test_1.test)('concurrent loads of the same range share one read', async () => {
    const { service, calls } = setup();
    const [a, b] = await Promise.all([service.load(R1), service.load(R1)]);
    node_assert_1.default.deepStrictEqual(a, b);
    node_assert_1.default.strictEqual(calls.length, 2);
});
(0, node_test_1.test)('ranges are cached separately', async () => {
    const { service } = setup();
    await service.load(R1);
    node_assert_1.default.deepStrictEqual(service.peek(R2), { fresh: false, git: undefined });
});
//# sourceMappingURL=gitStatsService.test.js.map