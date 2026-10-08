'use strict';
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
exports.MusicViewProvider = void 0;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const musicHtml_1 = require("./musicHtml");
const musicViewController_1 = require("./musicViewController");
class MusicViewProvider {
    extensionUri;
    player;
    library;
    output;
    artDir;
    static viewType = 'null.musicView';
    view;
    controller;
    subscriptions = [];
    constructor(extensionUri, player, library, output, artDir) {
        this.extensionUri = extensionUri;
        this.player = player;
        this.library = library;
        this.output = output;
        this.artDir = artDir;
        this.subscriptions.push(this.player.onDidChange(() => {
            this.controller?.sendPlayer();
            this.controller?.sendQueue();
        }), this.library.onDidChange(() => this.controller?.sendLibrary()), this.library.onDidChangeLikes(() => this.controller?.sendLiked()), this.library.onDidChangeSources(() => {
            if (this.view)
                this.refreshLocalResourceRoots(this.view);
        }));
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        const webview = webviewView.webview;
        this.refreshLocalResourceRoots(webviewView);
        // Attach before the html loads so the script's `ready` message is never missed.
        this.output.attach({
            postMessage: (message) => webview.postMessage(message),
            resolveUri: (uri) => webview.asWebviewUri(vscode.Uri.parse(uri)).toString(),
        });
        const asset = (file) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file)).toString();
        webview.html = (0, musicHtml_1.getMusicWebviewHtml)(this.getNonce(), webview.cspSource, asset('music.js'), asset('music.css'));
        this.controller = new musicViewController_1.MusicViewController(this.player, this.library, { postMessage: (msg) => void webview.postMessage(msg) }, {
            executeCommand: async (cmd, ...args) => await vscode.commands.executeCommand(cmd, ...args),
            showErrorMessage: (msg) => void vscode.window.showErrorMessage(msg),
            artUrl: (artKey) => webview.asWebviewUri(vscode.Uri.file(path.join(this.artDir, artKey))).toString(),
        });
        webview.onDidReceiveMessage(async (data) => {
            this.output.handleMessage(data);
            await this.controller?.handleMessage(data);
        });
        webviewView.onDidDispose(() => {
            this.output.detach();
            this.controller = undefined;
            this.view = undefined;
        });
    }
    /** Extension, art cache, library folders, playlist directories and the folders of playlist-only files — nothing else is readable. */
    getLocalFolderRoots() {
        const roots = [this.extensionUri, vscode.Uri.file(this.artDir)];
        for (const folder of this.library.folders) {
            try {
                roots.push(vscode.Uri.parse(folder));
            }
            catch {
                // skip a malformed stored folder
            }
        }
        for (const file of this.library.playlistPaths) {
            roots.push(vscode.Uri.file(path.dirname(file)));
        }
        for (const dir of this.library.externalDirs) {
            roots.push(vscode.Uri.file(dir));
        }
        return roots;
    }
    refreshLocalResourceRoots(webviewView) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: this.getLocalFolderRoots(),
        };
    }
    dispose() {
        for (const s of this.subscriptions)
            s.dispose();
        this.subscriptions.length = 0;
    }
    getNonce() {
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let text = '';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
exports.MusicViewProvider = MusicViewProvider;
//# sourceMappingURL=musicViewProvider.js.map