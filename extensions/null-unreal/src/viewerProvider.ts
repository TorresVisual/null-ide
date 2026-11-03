import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AssetStore } from './assetStore';
import { assetsDir } from './cache';
import { realExportFs } from './cli';
import { Resolved } from './assets';
import { ExportDoc } from './exportFormat';
import { latestLog } from './logs';
import { findMounts, Mount } from './packagePath';
import { FromWebview, ToWebview } from './viewer/messages';
import { buildHtml, Page, pageFor } from './viewer/page';
import { packageToFile, sidecarFile, thumbnailMap } from './viewer/refs';

export const VIEW_TYPE = 'null-unreal.assetViewer';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

class AssetDocument implements vscode.CustomDocument {
  constructor(readonly uri: vscode.Uri) {}
  dispose(): void {}
}

class AssetViewerProvider implements vscode.CustomReadonlyEditorProvider<AssetDocument> {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: AssetStore,
    private readonly resolve: () => Resolved,
  ) {}

  openCustomDocument(uri: vscode.Uri): AssetDocument {
    return new AssetDocument(uri);
  }

  resolveCustomEditor(document: AssetDocument, panel: vscode.WebviewPanel): void {
    attach(this.context, this.store, this.resolve, document.uri, panel);
  }
}

export function registerViewer(
  context: vscode.ExtensionContext,
  store: AssetStore,
  resolve: () => Resolved,
): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new AssetViewerProvider(context, store, resolve), {
      webviewOptions: { retainContextWhenHidden: false },
    }),
  );
}

// One panel for one .uasset. The page is chosen by the export's kind, so the HTML is only swapped when the kind
// is known and differs from the page on screen; a swapped page sends `ready` and gets the document then.
function attach(
  context: vscode.ExtensionContext,
  store: AssetStore,
  resolve: () => Resolved,
  uri: vscode.Uri,
  panel: vscode.WebviewPanel,
): void {
  const file = uri.fsPath;
  const lib = vscode.Uri.joinPath(context.extensionUri, 'lib');

  // The assets folder and the mounts need the project; without one, nothing resolves and nothing is linked.
  const assetsRoot = (): string | undefined => {
    try {
      return assetsDir(resolve().project.dir);
    } catch {
      return undefined;
    }
  };
  const mounts = (): Mount[] => findMountsSafe(resolve);
  const roots = [lib];
  const first = assetsRoot();
  if (first) roots.push(vscode.Uri.file(first));
  panel.webview.options = { enableScripts: true, localResourceRoots: roots };

  let page: Page | undefined;
  let loaded = false;
  let last: ToWebview = { type: 'exporting' };
  // Thumbnails are sent after the document, so a page that is still loading gets them on its `ready`.
  let thumbs: ToWebview | undefined;
  const send = (m: ToWebview) => {
    if (loaded) void panel.webview.postMessage(m);
  };
  const show = (p: Page) => {
    page = p;
    loaded = false;
    panel.webview.html = buildHtml({
      page: p,
      nonce: nonce(),
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, `${p}.js`)).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, 'viewer.css')).toString(),
      title: path.basename(file),
    });
  };
  const publish = (m: ToWebview, p: Page) => {
    last = m;
    if (p !== page) show(p);
    else send(m);
  };

  // Cached PNG of each package, as a webview URI; null when that texture is not cached. Peeks only, never exports.
  const thumbsFor = (packages: string[]): Record<string, string | null> => {
    const assets = assetsRoot();
    const all = mounts();
    return thumbnailMap(packages, (p) => {
      const f = packageToFile(p, all);
      const d = f ? store.peek(f) : undefined;
      const png = d && assets ? sidecarFile(assets, d, 'preview') : undefined;
      return png && fs.existsSync(png) ? panel.webview.asWebviewUri(vscode.Uri.file(png)).toString() : undefined;
    });
  };
  const textureOverrides = (d: Record<string, unknown>): string[] => {
    const o = d.overrides as { texture?: Record<string, unknown> } | undefined;
    return Object.values(o?.texture ?? {}).filter((p): p is string => typeof p === 'string');
  };
  const stringsIn = (v: unknown): string[] => (Array.isArray(v) ? v.filter((p): p is string => typeof p === 'string') : []);

  // A material instance walks its cached parent chain (peek only) and sends it with its texture thumbnails.
  const instanceExtra = (doc: ExportDoc) => {
    const all = mounts();
    const chain: { package: string; kind: string; data: Record<string, unknown> }[] = [];
    let pkg: unknown = doc.data.parent;
    while (typeof pkg === 'string' && chain.length < 32) {
      const f = packageToFile(pkg, all);
      const parent = f ? store.peek(f) : undefined;
      if (!parent) break;
      chain.push({ package: parent.package, kind: parent.kind, data: parent.data });
      pkg = parent.kind === 'material-instance' ? parent.data.parent : undefined;
    }
    const packages = [doc.data, ...chain.map((c) => c.data)].flatMap(textureOverrides);
    return { chain, thumbs: thumbsFor(packages) };
  };

  const readyMessage = (doc: ExportDoc): ToWebview => {
    const assets = assetsRoot();
    const sidecars: Record<string, string | { unreadable: string }> = {};
    for (const [key, v] of Object.entries(doc.sidecars)) {
      if (typeof v !== 'string') {
        sidecars[key] = v;
        continue;
      }
      const p = assets ? sidecarFile(assets, doc, key) : undefined;
      sidecars[key] =
        p && fs.existsSync(p)
          ? panel.webview.asWebviewUri(vscode.Uri.file(p)).toString()
          : { unreadable: 'the file is missing from the cache' };
    }
    if (doc.kind === 'material') {
      thumbs = { type: 'thumbs', byPackage: thumbsFor(stringsIn(doc.data.usedTextures)) };
    } else {
      thumbs = undefined;
    }
    const extra = doc.kind === 'material-instance' ? instanceExtra(doc) : undefined;
    return { type: 'ready', name: path.posix.basename(doc.package), kind: doc.kind, data: doc.data, sidecars, extra };
  };

  const open = async (force: boolean): Promise<void> => {
    try {
      resolve();
    } catch (e) {
      publish({ type: 'failed', error: errorText(e) }, page ?? 'properties');
      return;
    }
    if (!force) {
      const hit = store.peek(file);
      if (hit) return publish(readyMessage(hit), pageFor(hit.kind));
    }
    publish({ type: 'exporting' }, page ?? 'properties');
    try {
      const doc = await store.get(file, { force });
      publish(readyMessage(doc), pageFor(doc.kind));
    } catch (e) {
      publish({ type: 'failed', error: errorText(e) }, page ?? 'properties');
    }
  };

  // Export the used textures that are not cached yet, in one batched run, then send the new thumbnails.
  const exportReferenced = async (): Promise<void> => {
    const doc = store.peek(file);
    if (!doc || doc.kind !== 'material') return;
    const all = mounts();
    const missing = stringsIn(doc.data.usedTextures)
      .filter((p) => {
        const f = packageToFile(p, all);
        return f !== undefined && store.peek(f) === undefined;
      })
      .map((p) => packageToFile(p, all) as string);
    if (missing.length === 0) return;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Null Unreal: exporting ${missing.length} referenced texture(s)` },
        () => store.getMany(missing),
      );
    } catch (e) {
      void vscode.window.showErrorMessage(`Null Unreal: ${errorText(e)}`);
    }
    thumbs = { type: 'thumbs', byPackage: thumbsFor(stringsIn(doc.data.usedTextures)) };
    send(thumbs);
  };

  // A change on disk only tells the webview; the store is never asked to export.
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(path.dirname(file), path.basename(file)),
  );
  watcher.onDidChange(() => {
    if (last.type === 'ready') send({ type: 'stale' });
  });

  panel.webview.onDidReceiveMessage((m: FromWebview) => {
    switch (m.type) {
      case 'ready':
        loaded = true;
        send(last);
        if (thumbs) send(thumbs);
        break;
      case 'reexport':
        void open(true);
        break;
      case 'update':
        void open(false);
        break;
      case 'exportReferenced':
        void exportReferenced();
        break;
      case 'openAsset': {
        const f = packageToFile(m.package, mounts());
        if (f) void vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(f), VIEW_TYPE);
        break;
      }
      case 'reopenText':
        void vscode.commands.executeCommand('vscode.openWith', uri, 'default');
        break;
      case 'openLog':
        void openLog(resolve);
        break;
    }
  });
  panel.onDidDispose(() => watcher.dispose());

  const hit = store.peek(file);
  show(hit ? pageFor(hit.kind) : 'properties');
  void open(false);
}

// The mounts need the project; without one, no package resolves and links stay inert.
function findMountsSafe(resolve: () => Resolved): Mount[] {
  try {
    return findMounts(resolve().project.dir, realExportFs);
  } catch {
    return [];
  }
}

async function openLog(resolve: () => Resolved): Promise<void> {
  let projectDir: string;
  try {
    projectDir = resolve().project.dir;
  } catch (e) {
    void vscode.window.showWarningMessage(`Null Unreal: ${errorText(e)}`);
    return;
  }
  const file = latestLog(projectDir, 'export');
  if (!file) {
    void vscode.window.showInformationMessage('Null Unreal: no export log yet.');
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
}

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
