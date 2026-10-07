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
const vscode = __importStar(require("vscode"));
const musicHtml_1 = require("./musicHtml");
const musicViewController_1 = require("./musicViewController");
class MusicViewProvider {
    extensionUri;
    playbackManager;
    authStore;
    static viewType = 'null.musicView';
    view;
    controller;
    constructor(extensionUri, playbackManager, authStore) {
        this.extensionUri = extensionUri;
        this.playbackManager = playbackManager;
        this.authStore = authStore;
        this.playbackManager.onDidChangePlaybackState((state) => {
            this.controller?.sendPlaybackState(state);
        });
        this.authStore.onDidChangeAuth(async () => {
            await this.controller?.sendAuthState();
        });
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri],
        };
        const nonce = this.getNonce();
        webviewView.webview.html = (0, musicHtml_1.getMusicWebviewHtml)(nonce);
        this.controller = new musicViewController_1.MusicViewController(this.playbackManager, this.authStore, {
            postMessage: (msg) => {
                if (this.view?.visible) {
                    this.view.webview.postMessage(msg);
                }
            },
        }, {
            executeCommand: async (cmd, ...args) => {
                return await vscode.commands.executeCommand(cmd, ...args);
            },
            showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
        }, () => {
            const config = vscode.workspace.getConfiguration('null-music.spotify');
            return config.get('clientId', '');
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            await this.controller?.handleMessage(data);
        });
    }
    getNonce() {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
exports.MusicViewProvider = MusicViewProvider;
//# sourceMappingURL=musicViewProvider.js.map