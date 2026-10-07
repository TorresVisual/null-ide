'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { LocalMusicProvider } from '../provider/local/localProvider';
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
    private readonly localProvider: LocalMusicProvider
  ) {
    this.playbackManager.onDidChangePlaybackState((state) => {
      this.controller?.sendPlaybackState(state);
    });
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    this.refreshLocalResourceRoots(webviewView);

    const nonce = this.getNonce();
    const cspSource = webviewView.webview.cspSource;
    webviewView.webview.html = getMusicWebviewHtml(nonce, cspSource);

    const postToWebview = (msg: any) => {
      try {
        webviewView.webview.postMessage(msg);
      } catch (_) {}
    };

    // Wire audio adapter from LocalMusicProvider -> Webview HTML5 <audio> element
    this.localProvider.setAudioAdapter({
      playFile: (uri: string, _trackId: string) => {
        let webviewUri = uri;
        if (!uri.startsWith('http://') && !uri.startsWith('https://')) {
          try {
            let fileUri: vscode.Uri;
            if (uri.startsWith('file://')) {
              fileUri = vscode.Uri.parse(uri);
            } else {
              fileUri = vscode.Uri.file(uri);
            }
            webviewUri = webviewView.webview.asWebviewUri(fileUri).toString();
          } catch (_) {}
        }
        postToWebview({ type: 'localPlay', uri: webviewUri, trackUri: uri });
      },
      pauseAudio: () => postToWebview({ type: 'localPause' }),
      resumeAudio: () => postToWebview({ type: 'localResume' }),
      seekAudio: (positionMs: number) => postToWebview({ type: 'localSeek', positionMs }),
      setVolume: (volumePercent: number) => postToWebview({ type: 'localVolume', volumePercent }),
    });

    this.controller = new MusicViewController(
      this.playbackManager,
      this.localProvider,
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
      }
    );

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (
        data?.type === 'localOpenFolder' ||
        data?.type === 'localRemoveFolder' ||
        data?.type === 'localImportPlaylist' ||
        data?.type === 'localRemovePlaylist'
      ) {
        this.refreshLocalResourceRoots(webviewView);
      }
      await this.controller?.handleMessage(data);
    });
  }

  public getLocalFolderRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [this.extensionUri];

    if (vscode.workspace.workspaceFolders) {
      for (const wf of vscode.workspace.workspaceFolders) {
        roots.push(wf.uri);
      }
    }

    for (const u of this.localProvider.getFolderUris()) {
      try {
        roots.push(vscode.Uri.parse(u));
      } catch (_) {}
    }

    for (const pl of this.localProvider.getPlaylists()) {
      try {
        roots.push(vscode.Uri.file(path.dirname(pl.filePath)));
      } catch (_) {}
    }

    // Include drive roots on Windows or root on Unix so local audio files can be loaded
    if (process.platform === 'win32') {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      for (const letter of letters) {
        try {
          const driveRoot = `${letter}:\\`;
          if (fs.existsSync(driveRoot)) {
            roots.push(vscode.Uri.file(driveRoot));
          }
        } catch (_) {}
      }
    } else {
      try {
        roots.push(vscode.Uri.file('/'));
      } catch (_) {}
    }

    return roots;
  }

  public refreshLocalResourceRoots(webviewView: vscode.WebviewView): void {
    const localRoots = this.getLocalFolderRoots();
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: localRoots,
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
