'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const imageUrls_1 = require("./imageUrls");
const SIGNED = 'https://private-user-images.githubusercontent.com/91338024/659308528-2aaf4603-a019-489f-82f2-9a57c6854c55.png';
(0, node_test_1.default)('extractImageUrls decodes entities (signed URLs carry &amp;), skips emoji and repeats, ignores data-canonical-src', () => {
    const html = `<p><a href="x"><img width="10" alt="Image" src="${SIGNED}?jwt=a.b&amp;x=1" class="js-gh-image-fallback"></a>`
        + '<img class="emoji" alt="👍" src="https://github.githubassets.com/e.png">'
        + `<img src="${SIGNED}?jwt=a.b&amp;x=1">`
        + '<img data-canonical-src="https://x/orig.png" src="https://camo.githubusercontent.com/abc"></p>';
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.extractImageUrls)(html), [`${SIGNED}?jwt=a.b&x=1`, 'https://camo.githubusercontent.com/abc']);
});
(0, node_test_1.default)('extractImageUrls decodes one level only and finds nothing in markup without images', () => {
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.extractImageUrls)('<img src="https://x/a?q=&amp;lt;">'), ['https://x/a?q=&lt;']);
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.extractImageUrls)('<p>no pictures, just <code>&lt;img&gt;</code></p>'), []);
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.extractImageUrls)(''), []);
});
(0, node_test_1.default)('imageExtension trusts a real image content type, and falls back to the file name for GitHub raw answers', () => {
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('image/png', 'https://x/y'), 'png');
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('image/jpeg; charset=x', 'https://x/y'), 'jpg');
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('image/svg+xml', 'https://x/y'), 'svg');
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('application/vnd.github.raw+json; charset=utf-8', 'https://github.com/o/r/blob/b/2026/10/a.PNG?raw=true'), 'png');
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)(null, 'https://x/a.jpeg'), 'jpg');
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('application/octet-stream', 'https://x/a.webp'), 'webp');
});
(0, node_test_1.default)('imageExtension refuses what is not a stored image type: HTML error pages, other images, unknown names', () => {
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('text/html; charset=utf-8', 'https://x/a.png'), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('application/json', 'https://x/a.png'), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)('image/tiff', 'https://x/a.png'), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)(null, 'https://x/a.exe'), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)(null, 'https://x/a.png.exe'), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)(null, 'https://x/a.constructor'), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)(null, 'https://x/noextension'), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.imageExtension)(null, 'not a url'), null);
});
(0, node_test_1.default)('cacheKeyUrl ignores the jwt GitHub re-signs private images with, but nothing else', () => {
    node_assert_1.default.strictEqual((0, imageUrls_1.cacheKeyUrl)(`${SIGNED}?jwt=AAA`), (0, imageUrls_1.cacheKeyUrl)(`${SIGNED}?jwt=BBB&x=1`));
    node_assert_1.default.notStrictEqual((0, imageUrls_1.cacheKeyUrl)('https://camo.githubusercontent.com/a'), (0, imageUrls_1.cacheKeyUrl)('https://camo.githubusercontent.com/b'));
    node_assert_1.default.notStrictEqual((0, imageUrls_1.cacheKeyUrl)('https://example.com/i?id=1'), (0, imageUrls_1.cacheKeyUrl)('https://example.com/i?id=2'));
    node_assert_1.default.strictEqual((0, imageUrls_1.cacheKeyUrl)('not a url'), 'not a url');
});
(0, node_test_1.default)('cache file names are stable, flat, and cover every stored type', () => {
    const names = (0, imageUrls_1.cacheFileNames)(`${SIGNED}?jwt=AAA`);
    node_assert_1.default.strictEqual(names.length, 5);
    node_assert_1.default.ok(names.includes((0, imageUrls_1.cacheFileName)(`${SIGNED}?jwt=BBB`, 'png')));
    for (const name of names)
        node_assert_1.default.match(name, /^[0-9a-f]{40}\.(png|jpg|gif|webp|svg)$/);
});
(0, node_test_1.default)('imageFetchPlan sends repo file links through the Contents API and everything else straight out', () => {
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.imageFetchPlan)('https://github.com/TorresVisual/null-ide/blob/null-issue-assets/2026/10/a%20b.png?raw=true'), { kind: 'contents', owner: 'TorresVisual', repo: 'null-ide', ref: 'null-issue-assets', path: '2026/10/a b.png' });
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.imageFetchPlan)('https://github.com/o/r/raw/main/x.png'), { kind: 'contents', owner: 'o', repo: 'r', ref: 'main', path: 'x.png' });
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.imageFetchPlan)('https://github.com/user-attachments/assets/2aaf4603'), { kind: 'direct', url: 'https://github.com/user-attachments/assets/2aaf4603' });
    node_assert_1.default.deepStrictEqual((0, imageUrls_1.imageFetchPlan)(`${SIGNED}?jwt=a`), { kind: 'direct', url: `${SIGNED}?jwt=a` });
});
(0, node_test_1.default)('imageFetchPlan refuses non-https URLs, other schemes and garbage, without throwing', () => {
    for (const url of ['http://github.com/a.png', 'file:///C:/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'nope', '']) {
        node_assert_1.default.strictEqual((0, imageUrls_1.imageFetchPlan)(url), null, url);
    }
    node_assert_1.default.strictEqual((0, imageUrls_1.imageFetchPlan)('https://github.com/o/r/blob/main/%zz.png'), null);
});
(0, node_test_1.default)('tokenForUrl gives the token to GitHub itself on the first request only', () => {
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://github.com/user-attachments/assets/1', 't', 0), 't');
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://api.github.com/repos/o/r/contents/a.png', 't', 0), 't');
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://github.com/user-attachments/assets/1', 't', 1), null); // a redirect hop
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://private-user-images.githubusercontent.com/1/2.png', 't', 0), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://camo.githubusercontent.com/abc', 't', 0), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://github.com.evil.example/a.png', 't', 0), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://github.com@evil.example/a.png', 't', 0), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://evil.example/?github.com', 't', 0), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('https://github.com/a.png', null, 0), null);
    node_assert_1.default.strictEqual((0, imageUrls_1.tokenForUrl)('nope', 't', 0), null);
});
//# sourceMappingURL=imageUrls.test.js.map