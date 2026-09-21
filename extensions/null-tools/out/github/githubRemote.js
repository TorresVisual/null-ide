'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseGithubRemote = parseGithubRemote;
exports.getWorkspaceGithubRepo = getWorkspaceGithubRepo;
const child_process_1 = require("child_process");
function parseGithubRemote(remoteUrl) {
    const trimmed = remoteUrl.trim();
    const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (httpsMatch)
        return { owner: httpsMatch[1], repo: httpsMatch[2] };
    const sshMatch = trimmed.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (sshMatch)
        return { owner: sshMatch[1], repo: sshMatch[2] };
    return null;
}
function getWorkspaceGithubRepo(cwd) {
    try {
        const url = (0, child_process_1.execSync)('git remote get-url origin', { cwd, encoding: 'utf8', timeout: 5000 });
        return parseGithubRemote(url);
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=githubRemote.js.map