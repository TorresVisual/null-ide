/// <reference path="./protocol.ts" />
'use strict';

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getCommitGraphHtml } from './commitGraphHtml';
import { PAGE_SIZE } from './gitGraphService';
import { GraphLayouter } from './graphLayout';
import { parseWebviewMessage } from './graphMessages';
import { openFileDiff } from './graphDiff';
import { GraphSession, ReadyAvailability } from './graphSession';

const VIEW_TYPE = 'null.commitGraph';
const STALE_AFTER_MS = 60_000;
const MAX_FOCUS_PAGES = 20;

/** Owns the single, reused Commit Graph tab. The webview renders; every decision and every git call happens here. */
export class CommitGraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private lease: vscode.Disposable | undefined;
  private disposables: vscode.Disposable[] = [];
  private readonly layouter = new GraphLayouter();
  private rows: GraphRow[] = [];
  private nextSkip = 0;
  private hasMore = false;
  private generation = 0;
  private loading: Promise<void> | undefined;
  private ready = false;
  private pendingFocus: string | undefined;
  private hiddenAt: number | undefined;
  private latestSelect: string | undefined;
  private detailCache: { sha: string; parent: string | undefined; files: GraphFile[] } | undefined;

  constructor(private readonly context: vscode.ExtensionContext, private readonly session: GraphSession) {}

  async reveal(sha?: string): Promise<void> {
    if (sha) this.pendingFocus = sha;
    if (this.panel) {
      this.panel.reveal();
      if (sha && this.ready) await this.flushFocus();
      return;
    }
    const lib = vscode.Uri.joinPath(this.context.extensionUri, 'lib');
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Commit Graph', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [lib],
    });
    panel.iconPath = {
      light: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commit-graph.svg'),
      dark: vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commit-graph-dark.svg'),
    };
    this.panel = panel;
    this.ready = false;
    const asset = (file: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, file)).toString();
    panel.webview.html = getCommitGraphHtml(crypto.randomBytes(16).toString('base64'), panel.webview.cspSource, asset('commitGraph.js'), asset('commitGraph.css'));

    this.lease = this.session.acquire();
    this.disposables.push(
      panel.webview.onDidReceiveMessage((raw) => void this.handleRaw(raw)),
      this.session.onDidChange(() => { if (this.ready) void this.reload(); }),
      panel.onDidChangeViewState((e) => {
        if (!e.webviewPanel.visible) { this.hiddenAt = Date.now(); return; }
        if (this.hiddenAt !== undefined && Date.now() - this.hiddenAt > STALE_AFTER_MS) void this.session.checkNow();
        this.hiddenAt = undefined;
      }),
      panel.onDidDispose(() => this.closed()),
    );
  }

  dispose(): void {
    this.panel?.dispose();
    this.closed();
  }

  private closed(): void {
    this.panel = undefined;
    this.ready = false;
    this.generation++;
    this.rows = [];
    this.detailCache = undefined;
    this.latestSelect = undefined;
    this.lease?.dispose();
    this.lease = undefined;
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  /** Test seam (`_null.graph.snapshot`): what the tab currently holds. */
  snapshot(): { open: boolean; rowCount: number; headSha: string | undefined; detailSha: string | undefined } {
    return {
      open: this.panel !== undefined,
      rowCount: this.rows.length,
      headSha: this.rows.find((r) => r.refs.some((ref) => ref.current))?.sha,
      detailSha: this.detailCache?.sha,
    };
  }

  private post(message: GraphHostToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  /** Entry point for webview messages and for the `_null.graph.dispatch` test seam; untrusted input is validated first. */
  async handleRaw(raw: unknown): Promise<void> {
    const message = parseWebviewMessage(raw);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        this.ready = true;
        await this.reload();
        break;
      case 'refresh': await this.reload(); break;
      case 'loadMore': await this.loadMore(); break;
      case 'select': await this.sendDetail(message.sha); break;
      case 'goto': await this.focus(message.sha); break;
      case 'openDiff': await this.openDiff(message.sha, message.file); break;
      case 'banner': await vscode.commands.executeCommand(`null.graph.${message.action}`); break;
      case 'manageTrust': await vscode.commands.executeCommand('workbench.trust.manage'); break;
    }
  }

  private async reload(): Promise<void> {
    let generation = ++this.generation;
    const availability = await this.session.availability();
    if (!availability.ok) { this.post({ type: 'unavailable', reason: availability.reason }); return; }
    try {
      await this.session.busy.whenIdle();
      const page = await availability.service.loadPage(0, PAGE_SIZE);
      if (generation !== this.generation) return;
      this.layouter.reset();
      this.rows = this.layouter.layoutPage(page.commits);
      this.nextSkip = page.rawCount;
      this.hasMore = page.hasMore;
      // A loadMore that started while this reload was in flight holds the old skip offset; bumping here drops it.
      generation = ++this.generation;
      this.post({ type: 'rows', rows: this.rows, hasMore: this.hasMore, reset: true });
      this.post({ type: 'state', inProgress: await availability.service.inProgress() });
      void this.session.prime();
      await this.flushFocus();
    } catch (err) {
      if (generation === this.generation) this.post({ type: 'loadError', message: errorText(err), retry: 'refresh' });
    }
  }

  private loadMore(): Promise<void> {
    return (this.loading ??= this.doLoadMore().finally(() => { this.loading = undefined; }));
  }

  private async doLoadMore(): Promise<void> {
    const generation = this.generation;
    const availability = await this.session.availability();
    if (!availability.ok || !this.hasMore) return;
    try {
      const page = await availability.service.loadPage(this.nextSkip, PAGE_SIZE);
      if (generation !== this.generation) return;
      const fresh = this.layouter.layoutPage(page.commits);
      this.rows.push(...fresh);
      this.nextSkip += page.rawCount;
      this.hasMore = page.hasMore;
      this.post({ type: 'rows', rows: fresh, hasMore: this.hasMore, reset: false });
    } catch (err) {
      if (generation === this.generation) this.post({ type: 'loadError', message: errorText(err), retry: 'loadMore' });
    }
  }

  private async flushFocus(): Promise<void> {
    const sha = this.pendingFocus;
    this.pendingFocus = undefined;
    if (sha) await this.focus(sha);
  }

  /** Loads further pages until the commit is in the list (bounded), then asks the webview to select it. */
  private async focus(sha: string): Promise<void> {
    for (let pages = 0; !this.rows.some((r) => r.sha === sha) && this.hasMore && pages < MAX_FOCUS_PAGES; pages++) {
      await this.loadMore();
    }
    if (this.rows.some((r) => r.sha === sha)) this.post({ type: 'focus', sha });
    else void vscode.window.showInformationMessage('Commit Graph: that commit is not in the loaded history.');
  }

  private async sendDetail(sha: string): Promise<void> {
    this.latestSelect = sha;
    const availability = await this.session.availability();
    if (!availability.ok) return;
    try {
      const detail = await availability.service.commitDetail(sha);
      if (this.latestSelect !== sha) return;
      this.post({ type: 'detail', detail });
      const parent = detail.parents[0];
      const files = await availability.service.commitFiles(sha, parent);
      if (this.latestSelect !== sha) return; // a newer selection owns the cache that openDiff validates against
      this.detailCache = { sha, parent, files };
      this.post({ type: 'files', sha, files });
    } catch (err) {
      void vscode.window.showErrorMessage(`Commit Graph: ${errorText(err)}`);
    }
  }

  private async openDiff(sha: string, filePath: string): Promise<void> {
    const cache = this.detailCache;
    const file = cache?.sha === sha ? cache.files.find((f) => f.path === filePath) : undefined;
    if (!cache || !file) return; // only files the host itself listed for this commit
    const availability: ReadyAvailability | undefined = await this.session.availability().then((a) => (a.ok ? a : undefined));
    if (!availability) return;
    try {
      await openFileDiff(availability.root, sha, cache.parent, file);
    } catch (err) {
      void vscode.window.showErrorMessage(`Commit Graph: ${errorText(err)}`);
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
