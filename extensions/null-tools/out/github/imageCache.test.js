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
const node_test_1 = __importDefault(require("node:test"));
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const imageCache_1 = require("./imageCache");
const imageUrls_1 = require("./imageUrls");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const SIGNED = 'https://private-user-images.githubusercontent.com/1/2-3.png';
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'null-img-'));
const git = (cwd, ...args) => { (0, node_child_process_1.execFileSync)('git', args, { cwd, stdio: 'ignore' }); };
/** A network stand-in that answers with `bytes` and records how often it was asked. */
function stub(bytes = PNG, contentType = 'image/png') {
    const calls = [];
    return {
        calls,
        fetch: async (plan) => { calls.push(plan.kind); return { bytes, contentType }; },
    };
}
(0, node_test_1.default)('resolveImage downloads once, then serves the cached file, even for a re-signed URL', async () => {
    const root = tmp();
    const net = stub();
    const first = await (0, imageCache_1.resolveImage)(`${SIGNED}?jwt=AAA`, { root, token: 't', fetch: net.fetch });
    const second = await (0, imageCache_1.resolveImage)(`${SIGNED}?jwt=BBB`, { root, token: 't', fetch: net.fetch });
    node_assert_1.default.strictEqual(first, second);
    node_assert_1.default.strictEqual(path.dirname(first), (0, imageCache_1.issueImagesDir)(root));
    node_assert_1.default.deepStrictEqual(fs.readFileSync(first), PNG);
    node_assert_1.default.strictEqual(net.calls.length, 1);
    node_assert_1.default.deepStrictEqual(fs.readdirSync((0, imageCache_1.issueImagesDir)(root)), [path.basename(first)]); // no half-written .part left behind
});
(0, node_test_1.default)('resolveImage shares one download between simultaneous requests for the same image', async () => {
    const root = tmp();
    const net = stub();
    const [a, b] = await Promise.all([
        (0, imageCache_1.resolveImage)(`${SIGNED}?jwt=AAA`, { root, token: null, fetch: net.fetch }),
        (0, imageCache_1.resolveImage)(`${SIGNED}?jwt=BBB`, { root, token: null, fetch: net.fetch }),
    ]);
    node_assert_1.default.strictEqual(a, b);
    node_assert_1.default.strictEqual(net.calls.length, 1);
});
(0, node_test_1.default)('resolveImage rejects an HTML page served as an image and writes nothing', async () => {
    const root = tmp();
    await node_assert_1.default.rejects((0, imageCache_1.resolveImage)('https://github.com/user-attachments/assets/x.png', { root, token: null, fetch: stub(Buffer.from('<html>'), 'text/html').fetch }), /Not an image/);
    node_assert_1.default.strictEqual(fs.existsSync((0, imageCache_1.issueImagesDir)(root)), false);
});
(0, node_test_1.default)('resolveImage rejects a file over the size cap', async () => {
    const root = tmp();
    await node_assert_1.default.rejects((0, imageCache_1.resolveImage)(SIGNED, { root, token: null, fetch: stub(Buffer.alloc(imageUrls_1.MAX_IMAGE_BYTES + 1)).fetch }), /larger than/);
    node_assert_1.default.strictEqual(fs.existsSync((0, imageCache_1.issueImagesDir)(root)), false);
});
(0, node_test_1.default)('resolveImage refuses a URL it must not fetch, without calling the network', async () => {
    const net = stub();
    await node_assert_1.default.rejects((0, imageCache_1.resolveImage)('http://example.com/a.png', { root: tmp(), token: 't', fetch: net.fetch }), /Not a fetchable image URL/);
    node_assert_1.default.strictEqual(net.calls.length, 0);
});
(0, node_test_1.default)('a failed download is not remembered: the next request tries again', async () => {
    const root = tmp();
    let attempts = 0;
    const flaky = async () => {
        if (attempts++ === 0)
            throw new Error('offline');
        return { bytes: PNG, contentType: 'image/png' };
    };
    await node_assert_1.default.rejects((0, imageCache_1.resolveImage)(SIGNED, { root, token: null, fetch: flaky }), /offline/);
    node_assert_1.default.ok((await (0, imageCache_1.resolveImage)(SIGNED, { root, token: null, fetch: flaky })).endsWith('.png'));
});
(0, node_test_1.default)('mapLimit keeps the order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await (0, imageCache_1.mapLimit)([1, 2, 3, 4, 5, 6], 2, async (n) => {
        running++;
        peak = Math.max(peak, running);
        await new Promise(resolve => setTimeout(resolve, 5));
        running--;
        return n * 2;
    });
    node_assert_1.default.deepStrictEqual(out, [2, 4, 6, 8, 10, 12]);
    node_assert_1.default.strictEqual(peak, 2);
    node_assert_1.default.deepStrictEqual(await (0, imageCache_1.mapLimit)([], 4, async (n) => n), []);
});
(0, node_test_1.default)('withExcludeLine appends the line once, keeping existing text and a trailing newline', () => {
    node_assert_1.default.strictEqual((0, imageCache_1.withExcludeLine)('', imageCache_1.EXCLUDE_LINE), `${imageCache_1.EXCLUDE_LINE}\n`);
    node_assert_1.default.strictEqual((0, imageCache_1.withExcludeLine)('# comment\n', imageCache_1.EXCLUDE_LINE), `# comment\n${imageCache_1.EXCLUDE_LINE}\n`);
    node_assert_1.default.strictEqual((0, imageCache_1.withExcludeLine)('# comment', imageCache_1.EXCLUDE_LINE), `# comment\n${imageCache_1.EXCLUDE_LINE}\n`);
    const done = `a\r\n${imageCache_1.EXCLUDE_LINE}\r\n`;
    node_assert_1.default.strictEqual((0, imageCache_1.withExcludeLine)(done, imageCache_1.EXCLUDE_LINE), done);
});
(0, node_test_1.default)('ensureExcluded writes the line once into a repository\'s info/exclude', () => {
    const repo = tmp();
    git(repo, 'init');
    (0, imageCache_1.ensureExcluded)(repo);
    (0, imageCache_1.ensureExcluded)(repo);
    const text = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    node_assert_1.default.strictEqual(text.split('\n').filter(line => line === imageCache_1.EXCLUDE_LINE).length, 1);
});
(0, node_test_1.default)('ensureExcluded from a linked worktree edits the shared exclude file (.git is a file there)', () => {
    const main = tmp();
    git(main, 'init');
    git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-m', 'init');
    const worktree = path.join(tmp(), 'wt');
    git(main, 'worktree', 'add', worktree, '-b', 'wt-branch');
    (0, imageCache_1.ensureExcluded)(worktree);
    node_assert_1.default.ok(fs.readFileSync(path.join(main, '.git', 'info', 'exclude'), 'utf8').includes(imageCache_1.EXCLUDE_LINE));
});
(0, node_test_1.default)('ensureExcluded outside a repository does nothing and does not throw', () => {
    node_assert_1.default.doesNotThrow(() => (0, imageCache_1.ensureExcluded)(tmp()));
});
//# sourceMappingURL=imageCache.test.js.map