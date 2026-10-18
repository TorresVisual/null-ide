'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLACEHOLDER = exports.MAX_SIDE_BYTES = exports.PULL_SCHEME = void 0;
exports.docQuery = docQuery;
exports.parseDocQuery = parseDocQuery;
exports.decodeBlob = decodeBlob;
/** URI scheme of one side of a pull-request file; served by `PullContentProvider` from the Contents API. */
exports.PULL_SCHEME = 'null-pr';
/** Per side. A binary or larger file is shown as `PLACEHOLDER`, so the diff editor always opens. */
exports.MAX_SIDE_BYTES = 2 * 1024 * 1024;
exports.PLACEHOLDER = 'Binary or too large to show — open the pull request on GitHub.';
const SHA = /^[0-9a-f]{40}$/;
const NAME = /^[A-Za-z0-9._-]+$/;
const dotsOnly = (s) => /^\.+$/.test(s);
/** The query half of the document URI. The path is the URI's own path, so the tab title and language mode come out right. */
function docQuery(ref) {
    return new URLSearchParams({
        o: ref.owner, r: ref.repo, n: String(ref.pull), s: ref.sha, h: ref.head, d: ref.side,
    }).toString();
}
/** The reference a document URI encodes, or null when anything about it is off (it then never reaches the network). */
function parseDocQuery(uriPath, query) {
    const params = new URLSearchParams(query);
    const owner = params.get('o') ?? '';
    const repo = params.get('r') ?? '';
    const pull = Number(params.get('n'));
    const sha = params.get('s') ?? '';
    const head = params.get('h') ?? '';
    const side = params.get('d');
    const path = uriPath.replace(/^\//, '');
    if (!NAME.test(owner) || dotsOnly(owner) || !NAME.test(repo) || dotsOnly(repo))
        return null;
    if (!Number.isInteger(pull) || pull <= 0)
        return null;
    if (!SHA.test(sha) || !SHA.test(head))
        return null;
    if (side !== 'LEFT' && side !== 'RIGHT')
        return null;
    if (!path || path.split('/').some(part => part === '..' || part === ''))
        return null;
    return { owner, repo, pull, path, sha, head, side };
}
/** File text for the editor. A NUL byte marks a binary file, which would only show as garbage. */
function decodeBlob(bytes) {
    return bytes.includes(0) ? exports.PLACEHOLDER : bytes.toString('utf8');
}
//# sourceMappingURL=pullDocs.js.map