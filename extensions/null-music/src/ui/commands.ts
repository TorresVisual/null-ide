'use strict';

import * as vscode from 'vscode';
import { PlaybackManager } from '../playback/playbackManager';
import { LocalMusicProvider } from '../provider/local/localProvider';
import { formatSec, parseTimeToMs } from './commandHelpers';

export function registerCommands(
  context: vscode.ExtensionContext,
  playbackManager: PlaybackManager,
  localProvider: LocalMusicProvider
): void {
  const register = (command: string, callback: (...args: any[]) => any) => {
    context.subscriptions.push(vscode.commands.registerCommand(command, callback));
  };

  register('null-music.playPause', async () => {
    try {
      await playbackManager.playPause();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  });

  register('null-music.play', async () => {
    try {
      await playbackManager.play();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  });

  register('null-music.pause', async () => {
    try {
      await playbackManager.pause();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  });

  register('null-music.nextTrack', async () => {
    try {
      await playbackManager.next();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  });

  register('null-music.previousTrack', async () => {
    try {
      await playbackManager.previous();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  });

  register('null-music.seek', async () => {
    const state = playbackManager.getCurrentState();
    if (!state?.track) {
      vscode.window.showInformationMessage('No track currently playing to seek.');
      return;
    }

    const currentSec = Math.floor(state.progressMs / 1000);
    const durationSec = Math.floor(state.durationMs / 1000);

    const items: vscode.QuickPickItem[] = [
      { label: '$(playback-play) Forward 30 seconds', description: `+30s (to ${formatSec(currentSec + 30)})` },
      { label: '$(playback-play) Rewind 30 seconds', description: `-30s (to ${formatSec(Math.max(0, currentSec - 30))})` },
      { label: '$(playback-play) Forward 10 seconds', description: `+10s` },
      { label: '$(playback-play) Rewind 10 seconds', description: `-10s` },
      { label: '$(history) Restart Track', description: 'Go to 0:00' },
      { label: '$(edit) Custom Position (seconds or mm:ss)', description: 'Enter specific position' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `Seek in current track (Current: ${formatSec(currentSec)} / ${formatSec(durationSec)})`,
    });

    if (!pick) return;

    if (pick.label.includes('Forward 30')) {
      await playbackManager.seek(state.progressMs + 30000);
    } else if (pick.label.includes('Rewind 30')) {
      await playbackManager.seek(Math.max(0, state.progressMs - 30000));
    } else if (pick.label.includes('Forward 10')) {
      await playbackManager.seek(state.progressMs + 10000);
    } else if (pick.label.includes('Rewind 10')) {
      await playbackManager.seek(Math.max(0, state.progressMs - 10000));
    } else if (pick.label.includes('Restart Track')) {
      await playbackManager.seek(0);
    } else if (pick.label.includes('Custom Position')) {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter position in seconds (e.g. 90) or mm:ss (e.g. 1:30)',
      });
      if (input) {
        const ms = parseTimeToMs(input);
        if (ms !== null) {
          await playbackManager.seek(ms);
        } else {
          vscode.window.showErrorMessage('Invalid time format. Please enter seconds or mm:ss.');
        }
      }
    }
  });

  register('null-music.setVolume', async () => {
    const items: vscode.QuickPickItem[] = [
      { label: '100%', description: 'Maximum volume' },
      { label: '75%', description: 'High volume' },
      { label: '50%', description: 'Medium volume' },
      { label: '25%', description: 'Low volume' },
      { label: '0%', description: 'Mute' },
      { label: '$(edit) Custom Volume (0-100%)', description: 'Enter custom volume percentage' },
    ];

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select or enter volume level',
    });

    if (!pick) return;

    if (pick.label.includes('Custom Volume')) {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter volume percentage (0 - 100)',
        validateInput: (v) => {
          const num = parseInt(v, 10);
          return isNaN(num) || num < 0 || num > 100 ? 'Please enter a number between 0 and 100' : null;
        },
      });
      if (input) {
        await playbackManager.setVolume(parseInt(input, 10));
      }
    } else {
      const vol = parseInt(pick.label, 10);
      await playbackManager.setVolume(vol);
    }
  });

  register('null-music.volumeUp', async () => {
    await playbackManager.volumeUp(10);
  });

  register('null-music.volumeDown', async () => {
    await playbackManager.volumeDown(10);
  });

  register('null-music.toggleShuffle', async () => {
    await playbackManager.toggleShuffle();
  });

  register('null-music.toggleRepeat', async () => {
    await playbackManager.toggleRepeat();
  });

  register('null-music.likeCurrentTrack', async () => {
    const state = playbackManager.getCurrentState();
    if (!state?.track) {
      vscode.window.showInformationMessage('No track currently playing.');
      return;
    }
    const isNowLiked = await playbackManager.toggleLike();
    if (isNowLiked) {
      vscode.window.showInformationMessage(`Saved "${state.track.name}" to Liked Songs`);
    } else {
      vscode.window.showInformationMessage(`Removed "${state.track.name}" from Liked Songs`);
    }
  });

  register('null-music.showCurrentTrack', () => {
    const state = playbackManager.getCurrentState();
    if (!state?.track) {
      vscode.window.showInformationMessage('Null Music: No track is currently playing.');
      return;
    }
    vscode.window.showInformationMessage(
      `Now Playing: ${state.track.name} by ${state.track.artist}`
    );
  });

  register('null-music.search', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Search local music library by title, artist, or folder',
      placeHolder: 'e.g. ambient, soundtrack, artist name…',
    });

    if (query === undefined) return;

    const results = await playbackManager.search(query);
    if (results.tracks.length === 0) {
      vscode.window.showInformationMessage(`No tracks found matching "${query}".`);
      return;
    }

    const items: Array<vscode.QuickPickItem & { trackUri: string }> = results.tracks.map((t) => ({
      label: `$(play) ${t.name}`,
      description: t.artist,
      detail: t.album ? `Folder: ${t.album.split(/[/\\]/).pop()}` : undefined,
      trackUri: t.uri,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Search results for "${query}" (select to play)`,
    });

    if (selected) {
      const allTracks = localProvider.getAllTracks();
      const idx = allTracks.findIndex((t) => t.uri === selected.trackUri);
      if (idx >= 0) {
        localProvider.queueAndPlay(allTracks, idx);
        await playbackManager.refreshNow();
      }
    }
  });

  register('null-music.browsePlaylists', async () => {
    try {
      const playlists = await playbackManager.getUserPlaylists();
      if (playlists.length === 0) {
        const choice = await vscode.window.showInformationMessage(
          'No folders or playlists found. What would you like to add?',
          'Import Playlist (.m3u8)',
          'Add Music Folder'
        );
        if (choice === 'Import Playlist (.m3u8)') {
          await vscode.commands.executeCommand('null-music.importPlaylist');
        } else if (choice === 'Add Music Folder') {
          await vscode.commands.executeCommand('null-music.openLocalFolder');
        }
        return;
      }

      const items: Array<vscode.QuickPickItem & { uri: string }> = playlists.map((p) => {
        let icon = '$(folder)';
        if (p.id === 'local-favorites') {
          icon = '$(heart)';
        } else if (p.owner === 'Imported Playlist') {
          icon = '$(list-ordered)';
        }
        return {
          label: `${icon} ${p.name}`,
          description: `${p.trackCount} track${p.trackCount !== 1 ? 's' : ''} • ${p.owner}`,
          detail: p.description || undefined,
          uri: p.uri,
        };
      });

      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a playlist or folder to play',
      });

      if (pick) {
        await playbackManager.play({ contextUri: pick.uri });
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  });

  register('null-music.importPlaylist', async () => {
    const files = await vscode.window.showOpenDialog({
      canSelectFolders: false,
      canSelectFiles: true,
      canSelectMany: false,
      filters: {
        'Playlists (*.m3u8, *.m3u)': ['m3u8', 'm3u'],
      },
      openLabel: 'Import Playlist',
      title: 'Select a .m3u8 or .m3u playlist file',
    });

    if (!files || files.length === 0) return;

    try {
      const playlist = await localProvider.importPlaylist(files[0].fsPath || files[0].toString());
      if (playlist.tracks.length === 0) {
        vscode.window.showWarningMessage(
          `Playlist "${playlist.name}" was imported, but contained no tracks.`
        );
      } else {
        const action = await vscode.window.showInformationMessage(
          `Imported playlist "${playlist.name}" (${playlist.tracks.length} tracks)`,
          'Play Now'
        );
        if (action === 'Play Now') {
          await playbackManager.play({
            contextUri: `local:playlist:${encodeURIComponent(playlist.id)}`,
          });
        }
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to import playlist: ${err.message || err}`);
    }
  });

  register('null-music.openLocalFolder', async () => {
    const folders = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Add Music Folder',
      title: 'Select a folder containing audio files',
    });

    if (!folders || folders.length === 0) return;

    const folderUri = folders[0].toString();
    const tracks = await localProvider.addFolder(folderUri);
    if (tracks.length === 0) {
      vscode.window.showWarningMessage(
        'No supported audio files found in that folder. Supported formats: MP3, FLAC, OGG, WAV, M4A, AAC, Opus, WMA.'
      );
    } else {
      vscode.window.showInformationMessage(
        `Added ${tracks.length} track${tracks.length !== 1 ? 's' : ''} from "${folders[0].fsPath}"`
      );
    }
  });

  register('null-music.focus', async () => {
    await vscode.commands.executeCommand('null.musicView.focus');
  });
}
