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
    localProvider;
    lofiProvider;
    static viewType = 'null.musicView';
    view;
    controller;
    constructor(extensionUri, playbackManager, authStore, localProvider, lofiProvider) {
        this.extensionUri = extensionUri;
        this.playbackManager = playbackManager;
        this.authStore = authStore;
        this.localProvider = localProvider;
        this.lofiProvider = lofiProvider;
        this.playbackManager.onDidChangePlaybackState((state) => {
            this.controller?.sendPlaybackState(state);
        });
        this.authStore.onDidChangeAuth(async () => {
            await this.controller?.sendAuthState();
        });
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        // Build localResourceRoots: extension dir + all local music folder roots
        const localRoots = this.getLocalFolderRoots();
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri, ...localRoots],
        };
        const nonce = this.getNonce();
        webviewView.webview.html = (0, musicHtml_1.getMusicWebviewHtml)(nonce);
        const postToWebview = (msg) => {
            try {
                webviewView.webview.postMessage(msg);
            }
            catch (_) { }
        };
        // Wire the local audio adapter: the webview's <audio> element handles actual
        // playback, so we route calls from LocalMusicProvider → webview messages.
        if (this.localProvider) {
            this.localProvider.audioAdapter = {
                playFile: (uri, _trackId) => {
                    // Convert the local file URI to a webview-safe URI
                    let webviewUri = uri;
                    try {
                        const fileUri = vscode.Uri.parse(uri);
                        webviewUri = webviewView.webview.asWebviewUri(fileUri).toString();
                    }
                    catch (_) { }
                    postToWebview({ type: 'localPlay', uri: webviewUri });
                },
                pauseAudio: () => postToWebview({ type: 'localPause' }),
                resumeAudio: () => postToWebview({ type: 'localResume' }),
                seekAudio: (positionMs) => postToWebview({ type: 'localSeek', positionMs }),
                setVolume: (volumePercent) => postToWebview({ type: 'localVolume', volumePercent }),
            };
        }
        // Wire the lofi radio audio adapter
        if (this.lofiProvider) {
            this.lofiProvider.setAudioAdapter({
                playStream: (url) => postToWebview({ type: 'localPlay', uri: url }),
                pauseStream: () => postToWebview({ type: 'localPause' }),
                setVolume: (volumePercent) => postToWebview({ type: 'localVolume', volumePercent }),
            });
        }
        this.controller = new musicViewController_1.MusicViewController(this.playbackManager, this.authStore, {
            postMessage: (msg) => {
                postToWebview(msg);
            },
        }, {
            executeCommand: async (cmd, ...args) => {
                return await vscode.commands.executeCommand(cmd, ...args);
            },
            showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
        }, () => {
            const config = vscode.workspace.getConfiguration('null-music.spotify');
            return config.get('clientId', '');
        }, this.localProvider);
        webviewView.webview.onDidReceiveMessage(async (data) => {
            // After adding a new folder, refresh the localResourceRoots
            if (data?.type === 'localOpenFolder' || data?.type === 'localRemoveFolder') {
                this.refreshLocalResourceRoots(webviewView);
            }
            await this.controller?.handleMessage(data);
        });
    }
    /** Get the root URIs of all local folders so the webview can load their audio files. */
    getLocalFolderRoots() {
        if (!this.localProvider)
            return [];
        return this.localProvider.getFolderUris().map((u) => {
            try {
                return vscode.Uri.parse(u);
            }
            catch (_) {
                return null;
            }
        }).filter((u) => u !== null);
    }
    /**
     * Refreshes localResourceRoots after folders change.
     * Note: VSCode does not support updating options on an already-resolved webview,
     * so we re-create the HTML (which triggers a reload) only if roots changed.
     */
    refreshLocalResourceRoots(webviewView) {
        const localRoots = this.getLocalFolderRoots();
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri, ...localRoots],
        };
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