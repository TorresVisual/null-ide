'use strict';

import * as vscode from 'vscode';
import { ApiError } from '../github/githubApi';
import { createLineComment, replyToComment } from './pullApi';
import { getGithubSession } from '../github/githubAuth';
import { PULL_SCHEME, parseDocQuery } from './pullDocs';
import { PullDetail, ReviewComment, ReviewThread, describeFailure } from './pullModel';
import { sideUri } from './pullDiff';

const NOTICE_KEY = 'null.pulls.commentNoticeShown';

function toComment(c: ReviewComment): vscode.Comment {
  return {
    body: new vscode.MarkdownString(c.body),
    mode: vscode.CommentMode.Preview,
    author: { name: c.author, iconPath: c.avatar ? vscode.Uri.parse(c.avatar) : undefined },
  };
}

/** Review threads of the PRs the tree has opened, shown in the diff editors, plus posting new comments and replies. */
export class PullReview implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('null.pulls', 'Pull Request Review');
  private readonly byPull = new Map<number, vscode.CommentThread[]>();
  /** First comment of each existing thread: GitHub replies hang off it. */
  private readonly roots = new WeakMap<vscode.CommentThread, number>();

  constructor(private readonly globalState: vscode.Memento) {
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: doc =>
        doc.uri.scheme === PULL_SCHEME && parseDocQuery(doc.uri.path, doc.uri.query)
          ? [new vscode.Range(0, 0, Math.max(doc.lineCount - 1, 0), 0)]
          : undefined,
    };
  }

  /** (Re)shows `threads` for one PR. GitHub rejects a comment on a line outside the diff; the error is shown as is. */
  show(detail: PullDetail, threads: ReviewThread[]): void {
    this.drop(detail.pull.number);
    const shown = threads.map(t => {
      const first = (t.startLine ?? t.line) - 1;
      const thread = this.controller.createCommentThread(sideUri(detail, t.path, t.side), new vscode.Range(first, 0, t.line - 1, 0), t.comments.map(toComment));
      thread.canReply = true;
      thread.state = t.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
      thread.collapsibleState = t.resolved ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
      this.roots.set(thread, t.comments[0].id);
      return thread;
    });
    this.byPull.set(detail.pull.number, shown);
  }

  clear(): void {
    for (const n of [...this.byPull.keys()]) this.drop(n);
  }

  private drop(pull: number): void {
    for (const thread of this.byPull.get(pull) ?? []) thread.dispose();
    this.byPull.delete(pull);
  }

  /** Command handler for the thread's submit button: a reply on an existing thread, otherwise a new line comment. */
  async submit(reply: vscode.CommentReply): Promise<void> {
    const { thread, text } = reply;
    const ref = parseDocQuery(thread.uri.path, thread.uri.query);
    if (!ref || !text.trim()) return;
    const session = await getGithubSession(true);
    if (!session) return;
    try {
      const root = this.roots.get(thread);
      const posted = root === undefined
        ? await this.postNew(ref, thread, text, session.accessToken)
        : await replyToComment(ref.owner, ref.repo, ref.pull, root, text, session.accessToken);
      if (root === undefined) {
        this.roots.set(thread, posted.id);
        thread.canReply = true;
      }
      thread.comments = [...thread.comments, toComment(posted)];
      this.noticeOnce(ref);
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not post the comment: ${describeFailure(err)}`);
    }
  }

  /** The selected range as one comment; when GitHub rejects the range (422: it crosses hunks) the first line alone. */
  private async postNew(ref: NonNullable<ReturnType<typeof parseDocQuery>>, thread: vscode.CommentThread, body: string, token: string): Promise<ReviewComment> {
    const input = { body, commitId: ref.head, path: ref.path, side: ref.side };
    const first = (thread.range?.start.line ?? 0) + 1;
    const last = (thread.range?.end.line ?? 0) + 1;
    // ponytail: a new comment on the left side of a renamed file posts the old name as `path`, which GitHub rejects (422, shown as the toast). Carry the current path in DocRef to fix.
    try {
      return await createLineComment(ref.owner, ref.repo, ref.pull, { ...input, startLine: first, line: last }, token);
    } catch (err) {
      if (first === last || !(err instanceof ApiError) || err.status !== 422) throw err;
      return createLineComment(ref.owner, ref.repo, ref.pull, { ...input, line: first }, token);
    }
  }

  /** Comments go out at once and notify the author; say so after the first one, with the way to delete a mistake. */
  private noticeOnce(ref: { owner: string; repo: string; pull: number }): void {
    if (this.globalState.get<boolean>(NOTICE_KEY)) return;
    void this.globalState.update(NOTICE_KEY, true);
    void vscode.window.showInformationMessage(
      'Pull request comments are posted immediately and notify the author. Editing or deleting one is done on GitHub.',
      'Open on GitHub',
    ).then(choice => {
      if (choice) void vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${ref.owner}/${ref.repo}/pull/${ref.pull}`));
    });
  }

  dispose(): void {
    this.clear();
    this.controller.dispose();
  }
}
