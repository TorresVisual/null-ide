"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIEW_TYPE = void 0;
exports.registerViewer = registerViewer;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const cache_1 = require("./cache");
const logs_1 = require("./logs");
const page_1 = require("./viewer/page");
const refs_1 = require("./viewer/refs");
exports.VIEW_TYPE = 'null-unreal.assetViewer';
const errorText = (e) => (e instanceof Error ? e.message : String(e));
class AssetDocument {
    uri;
    constructor(uri) {
        this.uri = uri;
    }
    dispose() { }
}
class AssetViewerProvider {
    context;
    store;
    resolve;
    constructor(context, store, resolve) {
        this.context = context;
        this.store = store;
        this.resolve = resolve;
    }
    openCustomDocument(uri) {
        return new AssetDocument(uri);
    }
    resolveCustomEditor(document, panel) {
        attach(this.context, this.store, this.resolve, document.uri, panel);
    }
}
function registerViewer(context, store, resolve) {
    context.subscriptions.push(vscode.window.registerCustomEditorProvider(exports.VIEW_TYPE, new AssetViewerProvider(context, store, resolve), {
        webviewOptions: { retainContextWhenHidden: false },
    }));
}
// One panel for one .uasset. The page is chosen by the export's kind, so the HTML is only swapped when the kind
// is known and differs from the page on screen; a swapped page sends `ready` and gets the document then.
function attach(context, store, resolve, uri, panel) {
    const file = uri.fsPath;
    const lib = vscode.Uri.joinPath(context.extensionUri, 'lib');
    // The assets folder needs the project, so it is absent when the project does not resolve.
    const assetsRoot = () => {
        try {
            return (0, cache_1.assetsDir)(resolve().project.dir);
        }
        catch {
            return undefined;
        }
    };
    const roots = [lib];
    const first = assetsRoot();
    if (first)
        roots.push(vscode.Uri.file(first));
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    let page;
    let loaded = false;
    let last = { type: 'exporting' };
    const send = (m) => {
        if (loaded)
            void panel.webview.postMessage(m);
    };
    const show = (p) => {
        page = p;
        loaded = false;
        panel.webview.html = (0, page_1.buildHtml)({
            page: p,
            nonce: nonce(),
            cspSource: panel.webview.cspSource,
            scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, `${p}.js`)).toString(),
            styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(lib, 'viewer.css')).toString(),
            title: path.basename(file),
        });
    };
    const publish = (m, p) => {
        last = m;
        if (p !== page)
            show(p);
        else
            send(m);
    };
    const readyMessage = (doc) => {
        const assets = assetsRoot();
        const sidecars = {};
        for (const [key, v] of Object.entries(doc.sidecars)) {
            if (typeof v !== 'string') {
                sidecars[key] = v;
                continue;
            }
            const p = assets ? (0, refs_1.sidecarFile)(assets, doc, key) : undefined;
            sidecars[key] =
                p && fs.existsSync(p)
                    ? panel.webview.asWebviewUri(vscode.Uri.file(p)).toString()
                    : { unreadable: 'the file is missing from the cache' };
        }
        return { type: 'ready', name: path.posix.basename(doc.package), kind: doc.kind, data: doc.data, sidecars };
    };
    const open = async (force) => {
        try {
            resolve();
        }
        catch (e) {
            publish({ type: 'failed', error: errorText(e) }, page ?? 'properties');
            return;
        }
        if (!force) {
            const hit = store.peek(file);
            if (hit)
                return publish(readyMessage(hit), (0, page_1.pageFor)(hit.kind));
        }
        publish({ type: 'exporting' }, page ?? 'properties');
        try {
            const doc = await store.get(file, { force });
            publish(readyMessage(doc), (0, page_1.pageFor)(doc.kind));
        }
        catch (e) {
            publish({ type: 'failed', error: errorText(e) }, page ?? 'properties');
        }
    };
    // A change on disk only tells the webview; the store is never asked to export.
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(file), path.basename(file)));
    watcher.onDidChange(() => {
        if (last.type === 'ready')
            send({ type: 'stale' });
    });
    panel.webview.onDidReceiveMessage((m) => {
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
    show(hit ? (0, page_1.pageFor)(hit.kind) : 'properties');
    void open(false);
}
async function openLog(resolve) {
    let projectDir;
    try {
        projectDir = resolve().project.dir;
    }
    catch (e) {
        void vscode.window.showWarningMessage(`Null Unreal: ${errorText(e)}`);
        return;
    }
    const file = (0, logs_1.latestLog)(projectDir, 'export');
    if (!file) {
        void vscode.window.showInformationMessage('Null Unreal: no export log yet.');
        return;
    }
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
}
function nonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++)
        out += chars[Math.floor(Math.random() * chars.length)];
    return out;
}
//# sourceMappingURL=viewerProvider.js.map