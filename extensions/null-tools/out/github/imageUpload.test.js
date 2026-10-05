'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const imageUrls_1 = require("./imageUrls");
const imageUpload_1 = require("./imageUpload");
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const file = (name = 'image.png') => ({ name, mime: 'image/png', bytes: PNG });
/**
 * A GitHub stand-in. uploadImage remembers which repos' assets branch exists, across calls, so every test below
 * uses its own repo name.
 */
function fakeApi(over = {}) {
    const log = [];
    let active = 0;
    let peak = 0;
    let branch = false;
    const api = {
        getRefSha: async () => { log.push('get'); return branch ? 'sha' : null; },
        createOrphanBranch: async () => { log.push('create'); await tick(); branch = true; },
        putFile: async (_owner, _repo, _branch, filePath) => {
            log.push(`put ${filePath}`);
            active++;
            peak = Math.max(peak, active);
            await tick();
            active--;
        },
        ...over,
    };
    return { api, log, peak: () => peak };
}
(0, node_test_1.default)('uploadPath is yyyy/mm/<uuid>.<ext> in UTC', () => {
    node_assert_1.default.strictEqual((0, imageUpload_1.uploadPath)(new Date('2026-10-05T23:59:00Z'), 'abc', 'png'), '2026/10/abc.png');
    node_assert_1.default.strictEqual((0, imageUpload_1.uploadPath)(new Date('2026-03-01T00:00:00Z'), 'abc', 'webp'), '2026/03/abc.webp');
});
(0, node_test_1.default)('imageMarkdown links the file on the assets branch with ?raw=true and keeps the alt text from breaking the syntax', () => {
    const repo = { owner: 'o', repo: 'r' };
    node_assert_1.default.strictEqual((0, imageUpload_1.imageMarkdown)(repo, '2026/10/u.png', 'Screen Shot.png'), `![Screen Shot](https://github.com/o/r/blob/${imageUpload_1.ASSET_BRANCH}/2026/10/u.png?raw=true)`);
    node_assert_1.default.ok((0, imageUpload_1.imageMarkdown)(repo, 'p.png', 'a]b[c.png').startsWith('![a b c]('));
    node_assert_1.default.ok((0, imageUpload_1.imageMarkdown)(repo, 'p.png', '.png').startsWith('![image]('));
});
(0, node_test_1.default)('checkUpload accepts the five image types and names the problem otherwise', () => {
    node_assert_1.default.deepStrictEqual((0, imageUpload_1.checkUpload)('a.png', 'image/png', 10), { ext: 'png' });
    node_assert_1.default.deepStrictEqual((0, imageUpload_1.checkUpload)('a.jpeg', 'image/jpeg', 10), { ext: 'jpg' });
    node_assert_1.default.deepStrictEqual((0, imageUpload_1.checkUpload)('a.webp', '', 10), { ext: 'webp' }); // a dropped file can have no MIME type
    node_assert_1.default.match((0, imageUpload_1.checkUpload)('a.tiff', 'image/tiff', 10).error, /PNG, JPG, GIF, WebP and SVG/);
    node_assert_1.default.match((0, imageUpload_1.checkUpload)('a.png.exe', 'application/octet-stream', 10).error, /PNG, JPG/);
    node_assert_1.default.match((0, imageUpload_1.checkUpload)('a.png', 'image/png', 0).error, /empty/);
    node_assert_1.default.match((0, imageUpload_1.checkUpload)('a.png', 'image/png', imageUrls_1.MAX_IMAGE_BYTES + 1).error, /10 MB/);
});
(0, node_test_1.default)('three parallel uploads create the assets branch once and commit one at a time', async () => {
    const net = fakeApi();
    const markdown = await Promise.all([1, 2, 3].map(() => (0, imageUpload_1.uploadImage)({ owner: 'o', repo: 'parallel' }, 't', file(), net.api)));
    node_assert_1.default.strictEqual(net.log.filter(l => l === 'create').length, 1);
    node_assert_1.default.strictEqual(net.log.filter(l => l.startsWith('put ')).length, 3);
    node_assert_1.default.strictEqual(net.peak(), 1);
    node_assert_1.default.strictEqual(new Set(markdown).size, 3); // a fresh file name each time
    for (const md of markdown)
        node_assert_1.default.match(md, /^!\[image\]\(https:\/\/github\.com\/o\/parallel\/blob\/null-issue-assets\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png\?raw=true\)$/);
});
(0, node_test_1.default)('an assets branch that already exists is not created again', async () => {
    const net = fakeApi({ getRefSha: async () => 'sha' });
    await (0, imageUpload_1.uploadImage)({ owner: 'o', repo: 'existing' }, 't', file(), net.api);
    node_assert_1.default.deepStrictEqual(net.log.map(l => l.split(' ')[0]), ['put']);
});
(0, node_test_1.default)('a failed upload does not block the next one, and the branch is looked up again', async () => {
    let failOnce = true;
    const net = fakeApi({
        putFile: async () => {
            if (failOnce) {
                failOnce = false;
                throw new Error('GitHub API 403: Resource not accessible');
            }
        },
    });
    await node_assert_1.default.rejects((0, imageUpload_1.uploadImage)({ owner: 'o', repo: 'flaky' }, 't', file(), net.api), /403/);
    await (0, imageUpload_1.uploadImage)({ owner: 'o', repo: 'flaky' }, 't', file(), net.api);
    node_assert_1.default.strictEqual(net.log.filter(l => l === 'get').length, 2);
});
(0, node_test_1.default)('a refused file never reaches GitHub', async () => {
    const net = fakeApi();
    await node_assert_1.default.rejects((0, imageUpload_1.uploadImage)({ owner: 'o', repo: 'refused' }, 't', { name: 'a.txt', mime: 'text/plain', bytes: PNG }, net.api), imageUpload_1.UploadRejected);
    node_assert_1.default.deepStrictEqual(net.log, []);
});
//# sourceMappingURL=imageUpload.test.js.map