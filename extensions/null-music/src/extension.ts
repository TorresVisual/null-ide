'use strict';

import * as vscode from 'vscode';
import { AuthStore } from './auth/authStore';
import { SpotifyAuth } from './auth/spotifyAuth';
import { PlaybackManager } from './playback/playbackManager';
import { ProviderRegistry } from './provider/providerRegistry';
import { LocalMusicProvider } from './provider/local/localProvider';
import { LofiProvider } from './provider/lofi/lofiProvider';
import { SpotifyProvider } from './provider/spotify/spotifyProvider';
import { registerCommands } from './ui/commands';
import { MusicViewProvider } from './ui/musicViewProvider';
import { StatusBarController } from './ui/statusBarController';

export interface NullMusicApi {
  readonly playbackManager: PlaybackManager;
  readonly providerRegistry: ProviderRegistry;
  readonly authStore: AuthStore;
}

export function activate(context: vscode.ExtensionContext): NullMusicApi {
  const authStore = new AuthStore(context.secrets);

  const getSpotifyClientId = () => {
    const config = vscode.workspace.getConfiguration('null-music.spotify');
    return config.get<string>('clientId', '');
  };

  const getSpotifyClientSecret = () => {
    const config = vscode.workspace.getConfiguration('null-music.spotify');
    return config.get<string>('clientSecret', '');
  };

  const spotifyAuth = new SpotifyAuth({
    authStore,
    getClientId: getSpotifyClientId,
    getClientSecret: getSpotifyClientSecret,
    openUrl: async (url) => {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    },
  });

  const spotifyProvider = new SpotifyProvider(spotifyAuth);
  const lofiProvider = new LofiProvider();
  // Local provider — audio adapter is wired after the webview is created
  const localProvider = new LocalMusicProvider(undefined, context);

  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(spotifyProvider);
  providerRegistry.register(lofiProvider);
  providerRegistry.register(localProvider);

  // Set initial active provider from configuration if specified
  const initialProvider = vscode.workspace.getConfiguration('null-music').get<string>('provider', 'spotify');
  if (initialProvider && providerRegistry.get(initialProvider)) {
    providerRegistry.setActiveProviderId(initialProvider);
  }

  const getPollingInterval = () => {
    const config = vscode.workspace.getConfiguration('null-music.playback');
    return config.get<number>('pollingIntervalMs', 2500);
  };

  const onNotification = (message: string) => {
    const config = vscode.workspace.getConfiguration('null-music.notifications');
    if (config.get<boolean>('showOnSongChange', false)) {
      vscode.window.showInformationMessage(message);
    }
  };

  const playbackManager = new PlaybackManager({
    providerRegistry,
    getPollingIntervalMs: getPollingInterval,
    onNotification,
  });

  // Status Bar
  const statusBar = new StatusBarController(playbackManager);

  // Webview View
  const musicViewProvider = new MusicViewProvider(
    context.extensionUri,
    playbackManager,
    authStore,
    localProvider,
    lofiProvider
  );

  context.subscriptions.push(
    statusBar,
    playbackManager,
    vscode.window.registerWebviewViewProvider(MusicViewProvider.viewType, musicViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('null-music.provider')) {
        const newProvider = vscode.workspace.getConfiguration('null-music').get<string>('provider', 'spotify');
        if (newProvider && providerRegistry.get(newProvider)) {
          providerRegistry.setActiveProviderId(newProvider);
        }
      }
    })
  );

  // Commands
  registerCommands(context, playbackManager, authStore, localProvider, providerRegistry);

  return {
    playbackManager,
    providerRegistry,
    authStore,
  };
}

export function deactivate(): void {}
