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
exports.activate = activate;
exports.deactivate = deactivate;
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const library_1 = require("./library/library");
const player_1 = require("./playback/player");
const sessionStore_1 = require("./playback/sessionStore");
const webviewAudioOutput_1 = require("./playback/webviewAudioOutput");
const commands_1 = require("./ui/commands");
const musicViewProvider_1 = require("./ui/musicViewProvider");
const statusBarController_1 = require("./ui/statusBarController");
/** Sound lives in the sidebar webview, so commands that need it open the view, then give focus back. */
async function revealView() {
    await vscode.commands.executeCommand('null.musicView.focus');
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
}
function activate(context) {
    const storage = context.globalStorageUri.fsPath;
    const artDir = path.join(storage, 'art');
    const library = new library_1.Library({
        state: context.globalState,
        cacheFile: path.join(storage, 'library-cache.json'),
        artDir,
        extensions: () => vscode.workspace.getConfiguration('null-music.local').get('supportedExtensions', []),
    });
    const output = new webviewAudioOutput_1.WebviewAudioOutput({ revealView });
    const sessions = new sessionStore_1.SessionStore(context.globalState);
    const player = new player_1.Player({
        output,
        session: sessions,
        isLiked: (id) => library.isLiked(id),
        defaultQueue: () => library.tracks,
        onDuration: (track, ms) => library.learnDuration(track.id, ms),
        onSkipped: (n) => vscode.window.setStatusBarMessage(`$(warning) Null Music: skipped ${n} unplayable track${n === 1 ? '' : 's'}`, 5000),
        onError: (message) => vscode.window.showErrorMessage(`Null Music: ${message}`),
    });
    player.onDidChangeTrack((track) => {
        const enabled = vscode.workspace.getConfiguration('null-music.notifications').get('showOnSongChange', false);
        if (track && enabled) {
            vscode.window.showInformationMessage(`Now Playing: ${track.name} • ${track.artist}`);
        }
    });
    const statusBar = new statusBarController_1.StatusBarController(player);
    const musicViewProvider = new musicViewProvider_1.MusicViewProvider(context.extensionUri, player, library, output, artDir);
    context.subscriptions.push(statusBar, player, library, musicViewProvider, vscode.window.registerWebviewViewProvider(musicViewProvider_1.MusicViewProvider.viewType, musicViewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    (0, commands_1.registerCommands)(context, player, library);
    // Never block activation: show cached tracks, restore the session paused, then re-scan.
    void (async () => {
        await library.loadCache();
        const session = sessions.load();
        if (session && player.queue.length === 0) {
            player.restore(session, (id) => library.trackById(id));
        }
        await library.rescan();
    })().catch((err) => console.error('Null Music: library startup failed', err));
    return { player, library };
}
function deactivate() { }
//# sourceMappingURL=extension.js.map