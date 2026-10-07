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
const vscode = __importStar(require("vscode"));
const authStore_1 = require("./auth/authStore");
const spotifyAuth_1 = require("./auth/spotifyAuth");
const playbackManager_1 = require("./playback/playbackManager");
const providerRegistry_1 = require("./provider/providerRegistry");
const localProvider_1 = require("./provider/local/localProvider");
const lofiProvider_1 = require("./provider/lofi/lofiProvider");
const spotifyProvider_1 = require("./provider/spotify/spotifyProvider");
const commands_1 = require("./ui/commands");
const musicViewProvider_1 = require("./ui/musicViewProvider");
const statusBarController_1 = require("./ui/statusBarController");
function activate(context) {
    const authStore = new authStore_1.AuthStore(context.secrets);
    const getSpotifyClientId = () => {
        const config = vscode.workspace.getConfiguration('null-music.spotify');
        return config.get('clientId', '');
    };
    const getSpotifyClientSecret = () => {
        const config = vscode.workspace.getConfiguration('null-music.spotify');
        return config.get('clientSecret', '');
    };
    const spotifyAuth = new spotifyAuth_1.SpotifyAuth({
        authStore,
        getClientId: getSpotifyClientId,
        getClientSecret: getSpotifyClientSecret,
        openUrl: async (url) => {
            await vscode.env.openExternal(vscode.Uri.parse(url));
        },
    });
    const spotifyProvider = new spotifyProvider_1.SpotifyProvider(spotifyAuth);
    const lofiProvider = new lofiProvider_1.LofiProvider();
    // Local provider — audio adapter is wired after the webview is created
    const localProvider = new localProvider_1.LocalMusicProvider(undefined, context);
    const providerRegistry = new providerRegistry_1.ProviderRegistry();
    providerRegistry.register(spotifyProvider);
    providerRegistry.register(lofiProvider);
    providerRegistry.register(localProvider);
    // Set initial active provider from configuration if specified
    const initialProvider = vscode.workspace.getConfiguration('null-music').get('provider', 'spotify');
    if (initialProvider && providerRegistry.get(initialProvider)) {
        providerRegistry.setActiveProviderId(initialProvider);
    }
    const getPollingInterval = () => {
        const config = vscode.workspace.getConfiguration('null-music.playback');
        return config.get('pollingIntervalMs', 2500);
    };
    const onNotification = (message) => {
        const config = vscode.workspace.getConfiguration('null-music.notifications');
        if (config.get('showOnSongChange', false)) {
            vscode.window.showInformationMessage(message);
        }
    };
    const playbackManager = new playbackManager_1.PlaybackManager({
        providerRegistry,
        getPollingIntervalMs: getPollingInterval,
        onNotification,
    });
    // Status Bar
    const statusBar = new statusBarController_1.StatusBarController(playbackManager);
    // Webview View
    const musicViewProvider = new musicViewProvider_1.MusicViewProvider(context.extensionUri, playbackManager, authStore, localProvider, lofiProvider);
    context.subscriptions.push(statusBar, playbackManager, vscode.window.registerWebviewViewProvider(musicViewProvider_1.MusicViewProvider.viewType, musicViewProvider, {
        webviewOptions: { retainContextWhenHidden: true },
    }), vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('null-music.provider')) {
            const newProvider = vscode.workspace.getConfiguration('null-music').get('provider', 'spotify');
            if (newProvider && providerRegistry.get(newProvider)) {
                providerRegistry.setActiveProviderId(newProvider);
            }
        }
    }));
    // Commands
    (0, commands_1.registerCommands)(context, playbackManager, authStore, localProvider, providerRegistry);
    return {
        playbackManager,
        providerRegistry,
        authStore,
    };
}
function deactivate() { }
//# sourceMappingURL=extension.js.map