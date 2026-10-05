'use strict';

// Copy as prompt: fetches the whole conversation, downloads its images into the local cache and formats the lot.
// Thin glue over tested pieces (extractImageUrls, resolveImage, formatIssueAsPrompt); it needs the store, so it has no unit test.

import { IssuesStore } from './github/issuesStore';
import { GithubIssue } from './github/types';
import { mapLimit } from './github/imageCache';
import { extractImageUrls } from './github/imageUrls';
import { formatIssueAsPrompt } from './github/promptFormat';

const MAX_PROMPT_IMAGES = 30;

/**
 * The prompt text for `issue`, plus a warning when it is less complete than it should be. It never throws: offline, the issue
 * body alone still beats nothing, and one image that won't download shouldn't cost the rest.
 */
export async function buildIssuePrompt(store: IssuesStore, issue: GithubIssue): Promise<{ text: string; warning: string | null }> {
  let conversation: Awaited<ReturnType<IssuesStore['getConversation']>>;
  try {
    conversation = await store.getConversation(issue.number);
  } catch (err) {
    return { text: formatIssueAsPrompt(issue), warning: `Copied without comments or images: ${(err as Error).message}` };
  }
  const { post, comments } = conversation;
  const all = extractImageUrls([post, ...comments].map(p => p.bodyHTML).join('\n'));
  const found = await mapLimit(all.slice(0, MAX_PROMPT_IMAGES), 4, url => store.resolveImage(url).then(file => file, () => null));
  const paths = found.filter((file): file is string => file !== null);
  const missed = all.length - paths.length;
  return {
    text: formatIssueAsPrompt(
      { ...issue, body: post.body },
      comments.map(c => ({ author: c.author.login, createdAt: c.createdAt, body: c.body })),
      paths),
    warning: missed > 0 ? `${missed} image${missed === 1 ? '' : 's'} couldn't be downloaded and ${missed === 1 ? 'is' : 'are'} not in the prompt.` : null,
  };
}
