'use strict';

import { LocalMusicProvider } from '../provider/local/localProvider';
import { PlaybackManager } from '../playback/playbackManager';

export interface WebviewMessenger {
  postMessage(message: any): void | Promise<boolean | void>;
}

export interface WebviewControllerHost {
  executeCommand(command: string, ...args: any[]): Promise<any>;
  showErrorMessage(message: string): void;
}

export class MusicViewController {
  constructor(
    private readonly playbackManager: PlaybackManager,
    private readonly localProvider: LocalMusicProvider,
    private readonly messenger: WebviewMessenger,
    private readonly host: WebviewControllerHost
  ) {}

  public async handleMessage(data: any): Promise<void> {
    if (!data || !data.type) {
      return;
    }

    try {
      switch (data.type) {
        case 'ready':
          this.sendPlaybackState(this.playbackManager.getCurrentState());
          await this.sendLocalLibrary();
          break;

        case 'playPause':
          await this.playbackManager.playPause();
          break;

        case 'play':
          await this.playbackManager.play();
          break;

        case 'pause':
          await this.playbackManager.pause();
          break;

        case 'previous':
          await this.playbackManager.previous();
          break;

        case 'next':
          await this.playbackManager.next();
          break;

        case 'seek':
          if (typeof data.positionMs === 'number') {
            await this.playbackManager.seek(data.positionMs);
          }
          break;

        case 'setVolume':
          if (typeof data.volumePercent === 'number') {
            await this.playbackManager.setVolume(data.volumePercent);
          }
          break;

        case 'toggleShuffle':
          await this.playbackManager.toggleShuffle();
          break;

        case 'toggleRepeat':
          await this.playbackManager.toggleRepeat();
          break;

        case 'toggleLike':
          await this.playbackManager.toggleLike();
          await this.sendLocalLibrary();
          break;

        case 'toggleTrackLike':
          if (data.trackId) {
            const isLiked = await this.localProvider.isLiked(data.trackId);
            if (isLiked) {
              await this.localProvider.removeTrack(data.trackId);
            } else {
              await this.localProvider.saveTrack(data.trackId);
            }
            await this.sendLocalLibrary();
            await this.playbackManager.refreshNow();
          }
          break;

        case 'localOpenFolder':
          await this.host.executeCommand('null-music.openLocalFolder');
          await this.sendLocalLibrary();
          break;

        case 'localRemoveFolder':
          if (data.folderUri) {
            await this.localProvider.removeFolder(data.folderUri);
            await this.sendLocalLibrary();
          }
          break;

        case 'localImportPlaylist':
          await this.host.executeCommand('null-music.importPlaylist');
          await this.sendLocalLibrary();
          break;

        case 'localRemovePlaylist':
          if (data.playlistId) {
            await this.localProvider.removePlaylist(data.playlistId);
            await this.sendLocalLibrary();
          }
          break;

        case 'localPlayTrack':
          if (data.trackUri) {
            const allTracks = this.localProvider.getAllTracks();
            const idx = allTracks.findIndex((t) => t.uri === data.trackUri);
            if (idx >= 0) {
              this.localProvider.queueAndPlay(allTracks, idx);
              await this.playbackManager.refreshNow();
            }
          }
          break;

        case 'localPlayFolder':
          if (data.folderUri) {
            await this.playbackManager.play({
              contextUri: `local:folder:${encodeURIComponent(data.folderUri)}`,
            });
          }
          break;

        case 'localPlayPlaylist':
          if (data.playlistId) {
            await this.playbackManager.play({
              contextUri: `local:playlist:${encodeURIComponent(data.playlistId)}`,
            });
          }
          break;

        case 'localGetLibrary':
          await this.sendLocalLibrary();
          break;

        case 'localAudioDuration':
          if (typeof data.durationMs === 'number') {
            this.localProvider.notifyDuration(data.durationMs, data.trackUri);
            await this.playbackManager.refreshNow();
          }
          break;

        case 'localAudioTimeUpdate':
          if (typeof data.positionMs === 'number') {
            this.localProvider.notifyTimeUpdate(data.positionMs);
          }
          break;

        case 'localAudioPlayStarted':
          this.localProvider.notifyAudioPlayStarted();
          break;

        case 'localAudioPaused':
          this.localProvider.notifyAudioPaused();
          break;

        case 'localAudioPlayFailed':
        case 'localAudioError':
          this.localProvider.notifyPlaybackFailed(data.error || 'Playback error');
          await this.playbackManager.refreshNow();
          if (data.error && !data.silent) {
            this.host.showErrorMessage(`Null Music: ${data.error}`);
          }
          break;

        case 'localAudioEnded':
          await this.localProvider.notifyEnded();
          await this.playbackManager.refreshNow();
          break;
      }
    } catch (err: any) {
      this.host.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  }

  public sendPlaybackState(state: any): void {
    this.messenger.postMessage({ type: 'stateUpdate', state });
  }

  public async sendLocalLibrary(): Promise<void> {
    const rawTracks = this.localProvider.getAllTracks();
    const tracks = await Promise.all(
      rawTracks.map(async (t) => ({
        ...t,
        isLiked: await this.localProvider.isLiked(t.id),
      }))
    );
    const folders = this.localProvider.getFolderUris();
    const playlists = this.localProvider.getPlaylists();
    this.messenger.postMessage({ type: 'localLibraryUpdate', tracks, folders, playlists });
  }
}
