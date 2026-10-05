'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheFileName = exports.MAX_IMAGE_BYTES = exports.IMAGE_TYPES = void 0;
exports.extractImageUrls = extractImageUrls;
exports.imageExtension = imageExtension;
exports.cacheKeyUrl = cacheKeyUrl;
exports.cacheFileNames = cacheFileNames;
exports.imageFetchPlan = imageFetchPlan;
exports.tokenForUrl = tokenForUrl;
// Pure URL logic for issue images: which URLs in rendered HTML are real images, where each one is fetched from,
// whether the token may be sent, and what the cached file is called. No fs and no network, so node:test runs it.
const crypto_1 = require("crypto");
/** The image types the panel stores and uploads, by file extension. */
exports.IMAGE_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};
exports.MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
/** One pass, so `&amp;lt;` becomes `&lt;` and not `<`. */
const decodeEntities = (text) => text.replace(/&(?:amp|quot|#39|lt|gt);/g, entity => ENTITIES[entity]);
/**
 * The `src` of every non-emoji `<img>` in GitHub-rendered HTML, in order and without repeats. Entity-decoded:
 * GitHub writes the `&` of a signed URL's query as `&amp;`.
 */
function extractImageUrls(html) {
    const urls = [];
    for (const tag of html.match(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
        if (/\bclass="[^"]*\bemoji\b/i.test(tag))
            continue;
        const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1]; // `\s` so data-canonical-src doesn't match
        if (!src)
            continue;
        const url = decodeEntities(src);
        if (!urls.includes(url))
            urls.push(url);
    }
    return urls;
}
/** Content types that don't say what the bytes are (the Contents API's raw media type is one), so the file name decides. */
const UNINFORMATIVE_TYPES = ['', 'application/octet-stream', 'binary/octet-stream'];
/**
 * The extension to store an image under, or null when it isn't one of IMAGE_TYPES. A content type that names
 * something else (an HTML error page, a TIFF) wins over a misleading file name.
 */
function imageExtension(contentType, url) {
    const type = (contentType ?? '').split(';')[0].trim().toLowerCase();
    const byType = Object.keys(exports.IMAGE_TYPES).find(ext => exports.IMAGE_TYPES[ext] === type);
    if (byType)
        return byType;
    if (!UNINFORMATIVE_TYPES.includes(type) && !type.startsWith('application/vnd.github.raw'))
        return null;
    let pathname;
    try {
        pathname = new URL(url).pathname;
    }
    catch {
        return null;
    }
    const ext = /\.([a-z0-9]+)$/i.exec(pathname)?.[1].toLowerCase();
    const normalized = ext === 'jpeg' ? 'jpg' : ext;
    return normalized && Object.keys(exports.IMAGE_TYPES).includes(normalized) ? normalized : null; // not `in`: that also matches "constructor"
}
/**
 * The URL minus what changes without the image changing. GitHub re-signs `private-user-images` links (`?jwt=…`, valid
 * for 5 minutes) on every fetch, so the same image would otherwise be downloaded again on each refresh.
 * Other hosts keep their query: `example.com/i?id=1` and `?id=2` are different images.
 */
function cacheKeyUrl(url) {
    try {
        const u = new URL(url);
        if (u.hostname === 'private-user-images.githubusercontent.com') {
            u.search = '';
            u.hash = '';
        }
        return u.href;
    }
    catch {
        return url;
    }
}
const cacheBaseName = (url) => (0, crypto_1.createHash)('sha1').update(cacheKeyUrl(url)).digest('hex');
const cacheFileName = (url, ext) => `${cacheBaseName(url)}.${ext}`;
exports.cacheFileName = cacheFileName;
/** Every file name a cached copy of `url` could have (the type isn't known before a download), for the existence probe. */
function cacheFileNames(url) {
    const base = cacheBaseName(url);
    return Object.keys(exports.IMAGE_TYPES).map(ext => `${base}.${ext}`);
}
/**
 * How to download `url`: a file in a repo (`github.com/o/r/blob/<ref>/<path>`, what uploaded images link to) goes
 * through the Contents API; everything else is fetched as is. null for anything that isn't a plain https URL.
 * `ref` can't contain a slash: a branch like `feature/x` fails to resolve and the image just stays a chip.
 */
function imageFetchPlan(url) {
    let u;
    try {
        u = new URL(url);
    }
    catch {
        return null;
    }
    if (u.protocol !== 'https:')
        return null;
    const m = u.hostname === 'github.com' ? /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/([^/]+)\/(.+)$/.exec(u.pathname) : null;
    if (!m)
        return { kind: 'direct', url: u.href };
    try {
        return { kind: 'contents', owner: m[1], repo: m[2], ref: decodeURIComponent(m[3]), path: decodeURIComponent(m[4]) };
    }
    catch {
        return null; // malformed %-escape
    }
}
/**
 * The token for one request of an image fetch: only GitHub's own hosts, only the first request. A redirect (to a signed
 * storage URL, say) must never carry it, and `github.com.evil.example` or `github.com@evil.example` aren't GitHub.
 */
function tokenForUrl(url, token, hop) {
    if (!token || hop > 0)
        return null;
    try {
        const host = new URL(url).hostname;
        return host === 'github.com' || host === 'api.github.com' ? token : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=imageUrls.js.map