/// <reference path="../webview/music/protocol.ts" />
'use strict';

import { Library } from '../library/library';
import { Player } from '../playback/player';
import { Track } from '../types';
import { toWireLibrary, toWirePlayerState, toWireQueue } from './wire';

export interface WebviewMessenger {
  postMessage(message: HostToWebview): void | Promise<boolean | void>;
}

export interface WebviewControllerHost {
  executeCommand(command: string, ...args: any[]): Promise<any>;
  showErrorMessage(message: string): void;
  /** Webview-loadable URL for a cover in the art directory. */
  artUrl(artKey: string): string | undefined;
}

/** Translates webview intents into Player/Library calls and publishes snapshots. Audio events go to WebviewAudioOutput, not here. */
export class MusicViewController {
  private lastQueue = '';

  constructor(
    private readonly player: Player,
    private readonly library: Library,
    private readonly messenger: WebviewMessenger,
    private readonly host: WebviewControllerHost
  ) {}

  public async handleMessage(data: any): Promise<void> {
    if (!data || typeof data.type !== 'string') return;
    const msg = data as WebviewToHost;

    try {
      switch (msg.type) {
        case 'ready':
          this.sendAll();
          break;

        case 'playPause':
          await this.player.playPause();
          break;
        case 'previous':
          await this.player.previous();
          break;
        case 'next':
          await this.player.next();
          break;
        case 'seek':
          if (typeof msg.positionMs === 'number') this.player.seek(msg.positionMs);
          break;
        case 'setVolume':
          if (typeof msg.volumePercent === 'number') this.player.setVolume(msg.volumePercent);
          break;
        case 'toggleShuffle':
          this.player.toggleShuffle();
          break;
        case 'toggleRepeat':
          this.player.toggleRepeat();
          break;

        case 'playTracks':
          await this.playTracks(msg);
          break;
        case 'toggleLike': {
          const id = msg.trackId ?? this.player.getState().track?.id;
          if (id) {
            await this.library.toggleLike(id);
            this.player.refresh();
          }
          break;
        }

        case 'queuePlayNext': {
          const t = this.library.trackById(msg.trackId);
          if (t) this.player.playNext(t);
          break;
        }
        case 'queueAdd': {
          const t = this.library.trackById(msg.trackId);
          if (t) this.player.addToQueue(t);
          break;
        }
        case 'queueRemove':
          await this.player.removeFromQueue(msg.key);
          break;
        case 'queueMove':
          // Upcoming order is random while shuffling, so a manual order would mean nothing.
          if (!this.player.queue.shuffle) this.player.moveInQueue(msg.key, msg.beforeKey);
          break;
        case 'queueClear':
          this.player.clearQueue();
          break;
        case 'queueJump':
          await this.player.jump(msg.key);
          break;

        case 'addFolder':
          await this.host.executeCommand('null-music.openLocalFolder');
          break;
        case 'importPlaylist':
          await this.host.executeCommand('null-music.importPlaylist');
          break;
        case 'removeFolder':
          if (msg.uri) await this.library.removeFolder(msg.uri);
          break;
        case 'removePlaylist':
          if (msg.id) await this.library.removePlaylist(msg.id);
          break;
        case 'rescan':
          await this.library.rescan();
          break;
      }
    } catch (err: any) {
      this.host.showErrorMessage(`Null Music: ${err.message || err}`);
    }
  }

  /** A (re)loaded webview starts empty: give it everything, including a fresh copy of the queue. */
  public sendAll(): void {
    this.lastQueue = '';
    this.sendPlayer();
    this.sendQueue();
    this.sendLibrary();
    this.sendLiked();
  }

  public sendPlayer(): void {
    this.messenger.postMessage({
      type: 'player',
      state: toWirePlayerState(this.player.getState(), this.host.artUrl),
      unavailable: [...this.player.unavailable],
    });
  }

  /** Skips the post when nothing the Queue tab shows has changed (position ticks fire constantly). */
  public sendQueue(): void {
    const snapshot = this.player.queue.snapshot();
    const signature = [
      snapshot.history.map((e) => e.key).join(','),
      snapshot.current?.key ?? '',
      snapshot.upcoming.map((e) => e.key).join(','),
      this.player.queue.shuffle,
    ].join('|');
    if (signature === this.lastQueue) return;
    this.lastQueue = signature;
    this.messenger.postMessage(toWireQueue(snapshot, this.player.queue.shuffle, this.host.artUrl));
  }

  public sendLibrary(): void {
    this.messenger.postMessage(toWireLibrary(this.library, this.host.artUrl));
  }

  public sendLiked(): void {
    this.messenger.postMessage({ type: 'liked', ids: this.library.likedTracks().map((t) => t.id) });
  }

  private async playTracks(msg: Extract<WebviewToHost, { type: 'playTracks' }>): Promise<void> {
    if (!Array.isArray(msg.ids)) return;
    const tracks = msg.ids.map((id) => this.library.trackById(id)).filter((t): t is Track => !!t);
    if (tracks.length === 0) return;
    let start = Math.max(0, tracks.findIndex((t) => t.id === msg.startId));
    if (msg.shuffle) {
      if (!this.player.queue.shuffle) this.player.toggleShuffle();
      start = Math.floor(Math.random() * tracks.length);
    }
    await this.player.playTracks(tracks, start);
  }
}
