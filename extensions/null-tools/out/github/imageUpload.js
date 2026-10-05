'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.UploadRejected = exports.ASSET_BRANCH = void 0;
exports.uploadPath = uploadPath;
exports.imageMarkdown = imageMarkdown;
exports.checkUpload = checkUpload;
exports.uploadImage = uploadImage;
// Attaching an image to an issue: the file is committed to an orphan branch of the repo (GitHub has no public API for
// the drag-and-drop uploads of its own site) and the issue text links to it. No `vscode` import: node:test runs this
// against a fake GitHub.
const crypto_1 = require("crypto");
const githubApi_1 = require("./githubApi");
const imageUrls_1 = require("./imageUrls");
exports.ASSET_BRANCH = 'null-issue-assets';
const README = `# ${exports.ASSET_BRANCH}

Images attached to issues from Null IDE. The issue text links to the files on this branch.
It has no parent commit, so it carries none of the project's history, and nothing else lives here.
`;
/** The file's place on the assets branch: `yyyy/mm/<uuid>.<ext>`, so no two uploads can collide. */
function uploadPath(now, uuid, ext) {
    return `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${uuid}.${ext}`;
}
/** The markdown for the uploaded file; `?raw=true` is how github.com serves a repo file as an image. */
function imageMarkdown(repo, filePath, name) {
    const alt = name.replace(/\.[^.]+$/, '').replace(/[[\]\r\n]/g, ' ').trim() || 'image';
    return `![${alt}](https://github.com/${repo.owner}/${repo.repo}/blob/${exports.ASSET_BRANCH}/${filePath}?raw=true)`;
}
/** A file the panel refuses to upload (wrong type, empty, too big); the message is for the user. */
class UploadRejected extends Error {
}
exports.UploadRejected = UploadRejected;
/** The host's own check, whatever the webview already did. */
function checkUpload(name, mime, byteLength) {
    const ext = (0, imageUrls_1.imageExtension)(mime, `https://x.invalid/${encodeURIComponent(name)}`);
    if (!ext)
        return { error: 'Only PNG, JPG, GIF, WebP and SVG images can be attached.' };
    if (byteLength === 0)
        return { error: 'That image is empty.' };
    if (byteLength > imageUrls_1.MAX_IMAGE_BYTES)
        return { error: `Images can be at most ${imageUrls_1.MAX_IMAGE_BYTES / (1024 * 1024)} MB.` };
    return { ext };
}
const githubUploadApi = { getRefSha: githubApi_1.getRefSha, createOrphanBranch: githubApi_1.createOrphanBranch, putFile: githubApi_1.putFile };
/** Repos whose assets branch is known to exist. Dropped again when an upload fails, in case the branch was deleted. */
const ready = new Set();
/**
 * Uploads run one at a time: commits to one branch in parallel conflict, and the first upload of a repo creates the branch
 * (a second create answers 422). ponytail: one queue for every repo; split per repo if uploads to several repos ever matter.
 */
let queue = Promise.resolve();
/** Uploads one image and returns the markdown to insert. Rejects with `UploadRejected` for a file that isn't allowed, never reaching GitHub. */
function uploadImage(repo, token, file, api = githubUploadApi) {
    const check = checkUpload(file.name, file.mime, file.bytes.length);
    if ('error' in check)
        return Promise.reject(new UploadRejected(check.error));
    const key = `${repo.owner}/${repo.repo}`;
    const run = async () => {
        try {
            if (!ready.has(key)) {
                if (!(await api.getRefSha(repo.owner, repo.repo, exports.ASSET_BRANCH, token))) {
                    await api.createOrphanBranch(repo.owner, repo.repo, exports.ASSET_BRANCH, README, token);
                }
                ready.add(key);
            }
            const filePath = uploadPath(new Date(), (0, crypto_1.randomUUID)(), check.ext);
            await api.putFile(repo.owner, repo.repo, exports.ASSET_BRANCH, filePath, file.bytes.toString('base64'), `Add ${filePath}`, token);
            return imageMarkdown(repo, filePath, file.name);
        }
        catch (err) {
            ready.delete(key);
            throw err;
        }
    };
    const result = queue.then(run, run);
    queue = result.then(() => undefined, () => undefined);
    return result;
}
//# sourceMappingURL=imageUpload.js.map