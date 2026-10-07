'use strict';

import { AuthStore } from '../auth/authStore';
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
    private readonly authStore: AuthStore,
    private readonly messenger: WebviewMessenger,
    private readonly host: WebviewControllerHost,
    private readonly getClientId?: () => string
  ) {}

  public async handleMessage(data: any): Promise<void> {
    if (!data || !data.type) {
      return;
    }

    try {
      switch (data.type) {
        case 'ready':
          await this.sendAuthState();
          this.sendPlaybackState(this.playbackManager.getCurrentState());
          break;

        case 'signIn':
          await this.host.executeCommand('null-music.signIn', data.clientId);
          break;

        case 'openDevDashboard':
          await this.host.executeCommand('vscode.open', 'https://developer.spotify.com/dashboard');
          break;

        case 'signOut':
          await this.host.executeCommand('null-music.signOut');
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
          break;

        case 'playTrack':
          if (data.uri) {
            await this.playbackManager.play({ uri: data.uri });
          }
          break;

        case 'playContext':
          if (data.contextUri) {
            await this.playbackManager.play({ contextUri: data.contextUri });
          }
          break;

        case 'getPlaylists':
          const playlists = await this.playbackManager.getUserPlaylists();
          this.messenger.postMessage({ type: 'playlistsUpdate', playlists });
          break;

        case 'search':
          if (data.query) {
            const results = await this.playbackManager.search(data.query);
            this.messenger.postMessage({ type: 'searchResults', results });
          }
          break;

        case 'getDevices':
          const devices = await this.playbackManager.getDevices();
          this.messenger.postMessage({ type: 'devicesUpdate', devices });
          break;

        case 'transferDevice':
          if (data.deviceId) {
            await this.playbackManager.transferPlayback(data.deviceId);
            const updated = await this.playbackManager.getDevices();
            this.messenger.postMessage({ type: 'devicesUpdate', devices: updated });
          }
          break;
      }
    } catch (err: any) {
      this.host.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  }

  public async sendAuthState(): Promise<void> {
    const clientId = this.getClientId?.() || '';
    const provider = this.playbackManager.activeProvider;
    if (!provider) {
      this.messenger.postMessage({ type: 'authUpdate', isAuthenticated: false, user: null, clientId });
      return;
    }

    const isAuth = await provider.isAuthenticated();
    const user = isAuth ? await provider.getCurrentUser().catch(() => null) : null;
    this.messenger.postMessage({ type: 'authUpdate', isAuthenticated: isAuth, user, clientId });
  }

  public sendPlaybackState(state: any): void {
    this.messenger.postMessage({ type: 'stateUpdate', state });
  }
}
