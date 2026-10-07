'use strict';

import * as vscode from 'vscode';
import { PlaybackManager } from './playback/playbackManager';
import { LocalMusicProvider } from './provider/local/localProvider';
import { registerCommands } from './ui/commands';
import { MusicViewProvider } from './ui/musicViewProvider';
import { StatusBarController } from './ui/statusBarController';

export interface NullMusicApi {
  readonly playbackManager: PlaybackManager;
  readonly localProvider: LocalMusicProvider;
}

export function activate(context: vscode.ExtensionContext): NullMusicApi {
  const localProvider = new LocalMusicProvider(undefined, context);

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
    provider: localProvider,
    getPollingIntervalMs: getPollingInterval,
    onNotification,
  });

  // Status Bar
  const statusBar = new StatusBarController(playbackManager);

  // Webview View
  const musicViewProvider = new MusicViewProvider(
    context.extensionUri,
    playbackManager,
    localProvider
  );

  context.subscriptions.push(
    statusBar,
    playbackManager,
    vscode.window.registerWebviewViewProvider(MusicViewProvider.viewType, musicViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Commands
  registerCommands(context, playbackManager, localProvider);

  return {
    playbackManager,
    localProvider,
  };
}

export function deactivate(): void {}
