'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { Library } from './library/library';
import { Player } from './playback/player';
import { SessionStore } from './playback/sessionStore';
import { WebviewAudioOutput } from './playback/webviewAudioOutput';
import { registerCommands } from './ui/commands';
import { MusicViewProvider } from './ui/musicViewProvider';
import { StatusBarController } from './ui/statusBarController';

export interface NullMusicApi {
  readonly player: Player;
  readonly library: Library;
}

/** Sound lives in the sidebar webview, so commands that need it open the view, then give focus back. */
async function revealView(): Promise<void> {
  await vscode.commands.executeCommand('null.musicView.focus');
  await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
}

export function activate(context: vscode.ExtensionContext): NullMusicApi {
  const storage = context.globalStorageUri.fsPath;
  const artDir = path.join(storage, 'art');

  const library = new Library({
    state: context.globalState,
    cacheFile: path.join(storage, 'library-cache.json'),
    artDir,
    extensions: () => vscode.workspace.getConfiguration('null-music.local').get<string[]>('supportedExtensions', []),
  });

  const output = new WebviewAudioOutput({ revealView });
  const sessions = new SessionStore(context.globalState);
  const player = new Player({
    output,
    session: sessions,
    isLiked: (id) => library.isLiked(id),
    defaultQueue: () => library.tracks,
    onDuration: (track, ms) => library.learnDuration(track.id, ms),
    onSkipped: (n) =>
      vscode.window.setStatusBarMessage(`$(warning) Null Music: skipped ${n} unplayable track${n === 1 ? '' : 's'}`, 5000),
    onError: (message) => vscode.window.showErrorMessage(`Null Music: ${message}`),
  });

  player.onDidChangeTrack((track) => {
    const enabled = vscode.workspace.getConfiguration('null-music.notifications').get<boolean>('showOnSongChange', false);
    if (track && enabled) {
      vscode.window.showInformationMessage(`Now Playing: ${track.name} • ${track.artist}`);
    }
  });

  const statusBar = new StatusBarController(player);
  const musicViewProvider = new MusicViewProvider(context.extensionUri, player, library, output, artDir);

  context.subscriptions.push(
    statusBar,
    player,
    library,
    musicViewProvider,
    vscode.window.registerWebviewViewProvider(MusicViewProvider.viewType, musicViewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  registerCommands(context, player, library);

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

export function deactivate(): void {}
