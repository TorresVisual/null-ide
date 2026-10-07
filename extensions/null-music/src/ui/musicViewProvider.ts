'use strict';

import * as vscode from 'vscode';
import { AuthStore } from '../auth/authStore';
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
    private readonly authStore: AuthStore
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

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const nonce = this.getNonce();
    webviewView.webview.html = getMusicWebviewHtml(nonce);

    this.controller = new MusicViewController(
      this.playbackManager,
      this.authStore,
      {
        postMessage: (msg) => {
          if (this.view?.visible) {
            this.view.webview.postMessage(msg);
          }
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
      await this.controller?.handleMessage(data);
    });
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
