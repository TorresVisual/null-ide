'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeRepos = mergeRepos;
exports.repoChoices = repoChoices;
exports.localPathsFrom = localPathsFrom;
exports.widgetEnv = widgetEnv;
const widgetTypes_1 = require("./widgetTypes");
function mergeRepos(existing, accountId, picked) {
    const others = existing.filter(e => e.account !== accountId);
    return (0, widgetTypes_1.parseRepos)([...others, ...picked.map(repo => ({ repo, account: accountId }))]);
}
function repoChoices(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.map(r => r?.full_name).filter((n) => typeof n === 'string' && widgetTypes_1.REPO_RE.test(n));
}
function localPathsFrom(remotes) {
    const out = new Map();
    for (const [dir, repo] of remotes) {
        if (repo && !out.has(repo.toLowerCase())) {
            out.set(repo.toLowerCase(), dir);
        }
    }
    return out;
}
/** The extension host runs with ELECTRON_RUN_AS_NODE and VSCODE_* set; a null.exe started from the widgets must not inherit them. */
function widgetEnv(env) {
    const out = {};
    for (const [k, v] of Object.entries(env)) {
        const name = k.toUpperCase();
        if (name !== 'ELECTRON_RUN_AS_NODE' && !name.startsWith('VSCODE_')) {
            out[k] = v;
        }
    }
    return out;
}
//# sourceMappingURL=widgetSetup.js.map