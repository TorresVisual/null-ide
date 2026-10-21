'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPO_RE = exports.MAX_PRS = exports.MAX_ISSUES = exports.MAX_PROJECTS = exports.SCHEMA = void 0;
exports.parseRepos = parseRepos;
exports.SCHEMA = 1;
exports.MAX_PROJECTS = 8, exports.MAX_ISSUES = 10, exports.MAX_PRS = 10;
// Owners never contain a dot and a repo is never just dots, so `../x` and `./x` cannot pass.
exports.REPO_RE = /^[A-Za-z0-9_-]{1,100}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/;
/** The only gate between a settings value and a GitHub search string. */
function parseRepos(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set();
    const out = [];
    for (const e of raw) {
        const repo = e?.repo, account = e?.account;
        if (typeof repo !== 'string' || typeof account !== 'string' || !account || !exports.REPO_RE.test(repo)) {
            continue;
        }
        const key = `${account}\n${repo.toLowerCase()}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push({ repo, account });
    }
    return out;
}
//# sourceMappingURL=widgetTypes.js.map