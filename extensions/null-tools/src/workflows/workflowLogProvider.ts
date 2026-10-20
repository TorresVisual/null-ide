'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { ApiError } from '../github/githubApi';
import { describeFailure } from '../pulls/pullModel';
import { TRUNCATED_NOTICE, pathRefs, renderJobDoc, repoRelative } from './jobLog';
import { parseLogDoc } from './workflowLogDocs';
import { JobLog, fetchJobLog, getJob } from './workflowsApi';
import { isActive } from './workflowsModel';

const MAX_LINKS = 200;

export interface LogContext {
  tokenFor(owner: string, repo: string): string | null;
  folderFor(owner: string, repo: string): vscode.Uri | undefined;
}

const insideFolder = (folder: string, target: string): boolean => {
  const rel = path.relative(folder, target);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/**
 * Serves `null-workflows:` documents: one read-only tab per job (or per step). A job that is still running shows its steps
 * and whatever log text the endpoint returns, is refreshed on the poll tick, and stops being refreshed once it completes
 * or its tab closes. The provider has no timer of its own.
 */
export class WorkflowLogProvider implements vscode.TextDocumentContentProvider, vscode.DocumentLinkProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  /** Documents whose job has not finished, by uri string. */
  private readonly live = new Map<string, vscode.Uri>();
  /** The job's page on GitHub, for the truncation notice's link. */
  private readonly pages = new Map<string, string>();

  constructor(private readonly ctx: LogContext) {}

  hasLive(): boolean { return this.live.size > 0; }
  refreshLive(): void { for (const uri of this.live.values()) this.changed.fire(uri); }
  forget(uri: vscode.Uri): void {
    this.live.delete(uri.toString());
    this.pages.delete(uri.toString());
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = parseLogDoc(uri.path, uri.query);
    if (!ref) return '';
    const token = this.ctx.tokenFor(ref.owner, ref.repo);
    const key = uri.toString();
    try {
      const job = await getJob(ref.owner, ref.repo, ref.jobId, token);
      if (isActive(job)) this.live.set(key, uri); else this.live.delete(key);
      if (job.url) this.pages.set(key, job.url);
      let log: JobLog | null = null;
      let gone = false;
      try {
        log = await fetchJobLog(ref.owner, ref.repo, ref.jobId, token);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) gone = true;
        else if (!isActive(job)) throw err; // a running job's log is best-effort
      }
      return renderJobDoc({ job, log: log?.text ?? null, truncated: log?.truncated ?? false, step: ref.step, gone: gone && !isActive(job), now: Date.now() });
    } catch (err) {
      this.live.delete(key);
      return `Could not load this log: ${describeFailure(err)}`;
    }
  }

  /** Links `path:line` and `path(line,col)` in error/warning lines to workspace files that exist, and the truncation notice to GitHub. */
  async provideDocumentLinks(doc: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const ref = parseLogDoc(doc.uri.path, doc.uri.query);
    if (!ref) return [];
    const out: vscode.DocumentLink[] = [];
    const page = this.pages.get(doc.uri.toString());
    if (page && doc.lineCount > 0 && doc.lineAt(0).text === TRUNCATED_NOTICE) out.push(new vscode.DocumentLink(doc.lineAt(0).range, vscode.Uri.parse(page)));
    const folder = this.ctx.folderFor(ref.owner, ref.repo);
    if (!folder) return out;
    const exists = new Map<string, boolean>();
    for (let i = 0; i < doc.lineCount && out.length < MAX_LINKS; i++) {
      const text = doc.lineAt(i).text;
      if (!/##\[(error|warning)\]|\b(error|warning|fatal)\b/i.test(text)) continue;
      for (const r of pathRefs(text)) {
        const rel = repoRelative(r.path);
        if (!rel) continue;
        const target = vscode.Uri.joinPath(folder, rel);
        if (!insideFolder(folder.fsPath, target.fsPath)) continue;
        let ok = exists.get(target.fsPath);
        if (ok === undefined) {
          ok = await vscode.workspace.fs.stat(target).then(() => true, () => false);
          exists.set(target.fsPath, ok);
        }
        if (ok) out.push(new vscode.DocumentLink(new vscode.Range(i, r.start, i, r.end), target.with({ fragment: `L${r.line}${r.col ? `,${r.col}` : ''}` })));
      }
    }
    return out;
  }
}
