'use strict';

import * as vscode from 'vscode';
import { AuthStore } from '../auth/authStore';
import { LocalMusicProvider } from '../provider/local/localProvider';
import { LofiProvider } from '../provider/lofi/lofiProvider';
import { PlaybackManager } from '../playback/playbackManager';
import { getMusicWebviewHtml } from './musicHtml';
import { MusicViewController } from './musicViewController';

export class MusicViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'null.musicView';
  private view?: vscode.WebviewView;
  private controller?: MusicViewController;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly playbackManager: PlaybackManager,
    private readonly authStore: AuthStore,
    private readonly localProvider?: LocalMusicProvider,
    private readonly lofiProvider?: LofiProvider
  ) {
    this.playbackManager.onDidChangePlaybackState((state) => {
      this.controller?.sendPlaybackState(state);
    });

    this.authStore.onDidChangeAuth(async () => {
      await this.controller?.sendAuthState();
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    // Build localResourceRoots: extension dir + all local music folder roots
    const localRoots = this.getLocalFolderRoots();
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri, ...localRoots],
    };

    const nonce = this.getNonce();
    webviewView.webview.html = getMusicWebviewHtml(nonce);

    const postToWebview = (msg: any) => {
      try {
        webviewView.webview.postMessage(msg);
      } catch (_) {}
    };

    // Wire the local audio adapter: the webview's <audio> element handles actual
    // playback, so we route calls from LocalMusicProvider → webview messages.
    if (this.localProvider) {
      (this.localProvider as any).audioAdapter = {
        playFile: (uri: string, _trackId: string) => {
          // Convert the local file URI to a webview-safe URI
          let webviewUri = uri;
          try {
            const fileUri = vscode.Uri.parse(uri);
            webviewUri = webviewView.webview.asWebviewUri(fileUri).toString();
          } catch (_) {}
          postToWebview({ type: 'localPlay', uri: webviewUri });
        },
        pauseAudio: () => postToWebview({ type: 'localPause' }),
        resumeAudio: () => postToWebview({ type: 'localResume' }),
        seekAudio: (positionMs: number) => postToWebview({ type: 'localSeek', positionMs }),
        setVolume: (volumePercent: number) => postToWebview({ type: 'localVolume', volumePercent }),
      };
    }

    // Wire the lofi radio audio adapter
    if (this.lofiProvider) {
      this.lofiProvider.setAudioAdapter({
        playStream: (url: string) => postToWebview({ type: 'localPlay', uri: url }),
        pauseStream: () => postToWebview({ type: 'localPause' }),
        setVolume: (volumePercent: number) => postToWebview({ type: 'localVolume', volumePercent }),
      });
    }

    this.controller = new MusicViewController(
      this.playbackManager,
      this.authStore,
      {
        postMessage: (msg) => {
          postToWebview(msg);
        },
      },
      {
        executeCommand: async (cmd, ...args) => {
          return await vscode.commands.executeCommand(cmd, ...args);
        },
        showErrorMessage: (msg) => vscode.window.showErrorMessage(msg),
      },
      () => {
        const config = vscode.workspace.getConfiguration('null-music.spotify');
        return config.get<string>('clientId', '');
      },
      this.localProvider
    );

    webviewView.webview.onDidReceiveMessage(async (data) => {
      // After adding a new folder, refresh the localResourceRoots
      if (data?.type === 'localOpenFolder' || data?.type === 'localRemoveFolder') {
        this.refreshLocalResourceRoots(webviewView);
      }
      await this.controller?.handleMessage(data);
    });
  }

  /** Get the root URIs of all local folders so the webview can load their audio files. */
  private getLocalFolderRoots(): vscode.Uri[] {
    if (!this.localProvider) return [];
    return this.localProvider.getFolderUris().map((u) => {
      try {
        return vscode.Uri.parse(u);
      } catch (_) {
        return null;
      }
    }).filter((u): u is vscode.Uri => u !== null);
  }

  /**
   * Refreshes localResourceRoots after folders change.
   * Note: VSCode does not support updating options on an already-resolved webview,
   * so we re-create the HTML (which triggers a reload) only if roots changed.
   */
  private refreshLocalResourceRoots(webviewView: vscode.WebviewView): void {
    const localRoots = this.getLocalFolderRoots();
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri, ...localRoots],
    };
  }

  private getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
