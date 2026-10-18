'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.PullContentProvider = void 0;
const githubApi_1 = require("../github/githubApi");
const githubAuth_1 = require("../github/githubAuth");
const pullDocs_1 = require("./pullDocs");
/** Serves `null-pr:` documents: a file as it was at the merge base or at the PR head, straight from GitHub. */
class PullContentProvider {
    async provideTextDocumentContent(uri) {
        const ref = (0, pullDocs_1.parseDocQuery)(uri.path, uri.query);
        if (!ref)
            return '';
        const session = await (0, githubAuth_1.getGithubSession)(false);
        try {
            const { bytes } = await (0, githubApi_1.fetchRepoFile)(ref.owner, ref.repo, ref.sha, ref.path, session?.accessToken ?? null, pullDocs_1.MAX_SIDE_BYTES);
            return (0, pullDocs_1.decodeBlob)(bytes);
        }
        catch (err) {
            if (err instanceof githubApi_1.TooLargeError)
                return pullDocs_1.PLACEHOLDER;
            throw err;
        }
    }
}
exports.PullContentProvider = PullContentProvider;
//# sourceMappingURL=pullContentProvider.js.map