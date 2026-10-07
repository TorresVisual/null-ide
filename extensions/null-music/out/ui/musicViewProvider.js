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
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const musicHtml_1 = require("./musicHtml");
const musicViewController_1 = require("./musicViewController");
class MusicViewProvider {
    extensionUri;
    playbackManager;
    localProvider;
    static viewType = 'null.musicView';
    view;
    controller;
    constructor(extensionUri, playbackManager, localProvider) {
        this.extensionUri = extensionUri;
        this.playbackManager = playbackManager;
        this.localProvider = localProvider;
        this.playbackManager.onDidChangePlaybackState((state) => {
            this.controller?.sendPlaybackState(state);
        });
    }
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        this.refreshLocalResourceRoots(webviewView);
        const nonce = this.getNonce();
        const cspSource = webviewView.webview.cspSource;
        webviewView.webview.html = (0, musicHtml_1.getMusicWebviewHtml)(nonce, cspSource);
        const postToWebview = (msg) => {
            try {
                webviewView.webview.postMessage(msg);
            }
            catch (_) { }
        };
        // Wire audio adapter from LocalMusicProvider -> Webview HTML5 <audio> element
        this.localProvider.setAudioAdapter({
            playFile: (uri, _trackId) => {
                let webviewUri = uri;
                if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
                    try {
                        let fileUri;
                        if (uri.startsWith('file://')) {
                            fileUri = vscode.Uri.parse(uri);
                        }
                        else {
                            fileUri = vscode.Uri.file(uri);
                        }
                        webviewUri = webviewView.webview.asWebviewUri(fileUri).toString();
                    }
                    catch (_) { }
                }
                postToWebview({ type: 'localPlay', uri: webviewUri, trackUri: uri });
            },
            pauseAudio: () => postToWebview({ type: 'localPause' }),
            resumeAudio: () => postToWebview({ type: 'localResume' }),
            seekAudio: (positionMs) => postToWebview({ type: 'localSeek', positionMs }),
            setVolume: (volumePercent) => postToWebview({ type: 'localVolume', volumePercent }),
        });
        this.controller = new musicViewController_1.MusicViewController(this.playbackManager, this.localProvider, {
            postMessage: (msg) => {
                postToWebview(msg);
            },
        }, {
            executeCommand: async (cmd, ...args) => {
                return await vscode.commands.executeCommand(cmd, ...args);
            },
            showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
        });
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data?.type === 'localOpenFolder' ||
                data?.type === 'localRemoveFolder' ||
                data?.type === 'localImportPlaylist' ||
                data?.type === 'localRemovePlaylist') {
                this.refreshLocalResourceRoots(webviewView);
            }
            await this.controller?.handleMessage(data);
        });
    }
    getLocalFolderRoots() {
        const roots = [this.extensionUri];
        if (vscode.workspace.workspaceFolders) {
            for (const wf of vscode.workspace.workspaceFolders) {
                roots.push(wf.uri);
            }
        }
        for (const u of this.localProvider.getFolderUris()) {
            try {
                roots.push(vscode.Uri.parse(u));
            }
            catch (_) { }
        }
        for (const pl of this.localProvider.getPlaylists()) {
            try {
                roots.push(vscode.Uri.file(path.dirname(pl.filePath)));
            }
            catch (_) { }
        }
        // Include drive roots on Windows or root on Unix so local audio files can be loaded
        if (process.platform === 'win32') {
            const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
            for (const letter of letters) {
                try {
                    const driveRoot = `${letter}:\\`;
                    if (fs.existsSync(driveRoot)) {
                        roots.push(vscode.Uri.file(driveRoot));
                    }
                }
                catch (_) { }
            }
        }
        else {
            try {
                roots.push(vscode.Uri.file('/'));
            }
            catch (_) { }
        }
        return roots;
    }
    refreshLocalResourceRoots(webviewView) {
        const localRoots = this.getLocalFolderRoots();
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: localRoots,
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