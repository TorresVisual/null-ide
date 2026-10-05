'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildIssuePrompt = buildIssuePrompt;
const imageCache_1 = require("./github/imageCache");
const imageUrls_1 = require("./github/imageUrls");
const promptFormat_1 = require("./github/promptFormat");
const MAX_PROMPT_IMAGES = 30;
/**
 * The prompt text for `issue`, plus a warning when it is less complete than it should be. It never throws: offline, the issue
 * body alone still beats nothing, and one image that won't download shouldn't cost the rest.
 */
async function buildIssuePrompt(store, issue) {
    let conversation;
    try {
        conversation = await store.getConversation(issue.number);
    }
    catch (err) {
        return { text: (0, promptFormat_1.formatIssueAsPrompt)(issue), warning: `Copied without comments or images: ${err.message}` };
    }
    const { post, comments } = conversation;
    const all = (0, imageUrls_1.extractImageUrls)([post, ...comments].map(p => p.bodyHTML).join('\n'));
    const found = await (0, imageCache_1.mapLimit)(all.slice(0, MAX_PROMPT_IMAGES), 4, url => store.resolveImage(url).then(file => file, () => null));
    const paths = found.filter((file) => file !== null);
    const missed = all.length - paths.length;
    return {
        text: (0, promptFormat_1.formatIssueAsPrompt)({ ...issue, body: post.body }, comments.map(c => ({ author: c.author.login, createdAt: c.createdAt, body: c.body })), paths),
        warning: missed > 0 ? `${missed} image${missed === 1 ? '' : 's'} couldn't be downloaded and ${missed === 1 ? 'is' : 'are'} not in the prompt.` : null,
    };
}
//# sourceMappingURL=issuePrompt.js.map