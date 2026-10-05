'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.draftKey = draftKey;
/** `workspaceState` key for the unsent text of one issue's comment box (`target` = the issue number) or of the New issue form (`'new'`). */
function draftKey(repo, target) {
    return `null.issues.draft:${repo.owner}/${repo.repo}#${target}`;
}
//# sourceMappingURL=issueDrafts.js.map