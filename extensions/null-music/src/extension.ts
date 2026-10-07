'use strict';

import * as vscode from 'vscode';
import { AuthStore } from './auth/authStore';
import { SpotifyAuth } from './auth/spotifyAuth';
import { PlaybackManager } from './playback/playbackManager';
import { ProviderRegistry } from './provider/providerRegistry';
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

  const providerRegistry = new ProviderRegistry();
  providerRegistry.register(spotifyProvider);

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
  const musicViewProvider = new MusicViewProvider(context.extensionUri, playbackManager, authStore);

  context.subscriptions.push(
    statusBar,
    playbackManager,
    vscode.window.registerWebviewViewProvider(MusicViewProvider.viewType, musicViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Commands
  registerCommands(context, playbackManager, authStore);

  return {
    playbackManager,
    providerRegistry,
    authStore,
  };
}

export function deactivate(): void {}
