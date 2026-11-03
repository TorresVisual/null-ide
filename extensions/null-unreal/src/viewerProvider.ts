import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AssetStore } from './assetStore';
import { assetsDir } from './cache';
import { ExportDoc } from './exportFormat';
import { Resolved } from './assets';
import { latestLog } from './logs';
import { FromWebview, ToWebview } from './viewer/messages';
import { buildHtml, Page, pageFor } from './viewer/page';
import { sidecarFile } from './viewer/refs';

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

  // The assets folder needs the project, so it is absent when the project does not resolve.
  const assetsRoot = (): string | undefined => {
    try {
      return assetsDir(resolve().project.dir);
    } catch {
      return undefined;
    }
  };
  const roots = [lib];
  const first = assetsRoot();
  if (first) roots.push(vscode.Uri.file(first));
  panel.webview.options = { enableScripts: true, localResourceRoots: roots };

  let page: Page | undefined;
  let loaded = false;
  let last: ToWebview = { type: 'exporting' };
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
    return { type: 'ready', name: path.posix.basename(doc.package), kind: doc.kind, data: doc.data, sidecars };
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
        break;
      case 'reexport':
        void open(true);
        break;
      case 'update':
        void open(false);
        break;
      case 'reopenText':
        void vscode.commands.executeCommand('vscode.openWith', uri, 'default');
        break;
      case 'openLog':
        void openLog(resolve);
        break;
      default:
        // exportReferenced and openAsset arrive with the material graph.
        break;
    }
  });
  panel.onDidDispose(() => watcher.dispose());

  const hit = store.peek(file);
  show(hit ? pageFor(hit.kind) : 'properties');
  void open(false);
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
