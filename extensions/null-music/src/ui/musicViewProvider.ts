'use strict';

import * as path from 'path';
import * as vscode from 'vscode';
import { Library } from '../library/library';
import { Player } from '../playback/player';
import { WebviewAudioOutput } from '../playback/webviewAudioOutput';
import { getMusicWebviewHtml } from './musicHtml';
import { MusicViewController } from './musicViewController';

export class MusicViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'null.musicView';
  private view?: vscode.WebviewView;
  private controller?: MusicViewController;
  private readonly subscriptions: Array<{ dispose(): void }> = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly player: Player,
    private readonly library: Library,
    private readonly output: WebviewAudioOutput,
    private readonly artDir: string
  ) {
    this.subscriptions.push(
      this.player.onDidChange(() => {
        this.controller?.sendPlayer();
        this.controller?.sendQueue();
      }),
      this.library.onDidChange(() => this.controller?.sendLibrary()),
      this.library.onDidChangeLikes(() => this.controller?.sendLiked()),
      this.library.onDidChangeSources(() => {
        if (this.view) this.refreshLocalResourceRoots(this.view);
      })
    );
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    const webview = webviewView.webview;
    this.refreshLocalResourceRoots(webviewView);

    // Attach before the html loads so the script's `ready` message is never missed.
    this.output.attach({
      postMessage: (message) => webview.postMessage(message),
      resolveUri: (uri) => webview.asWebviewUri(vscode.Uri.parse(uri)).toString(),
    });
    const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'lib', file)).toString();
    webview.html = getMusicWebviewHtml(this.getNonce(), webview.cspSource, asset('music.js'), asset('music.css'));

    this.controller = new MusicViewController(
      this.player,
      this.library,
      { postMessage: (msg) => void webview.postMessage(msg) },
      {
        executeCommand: async (cmd, ...args) => await vscode.commands.executeCommand(cmd, ...args),
        showErrorMessage: (msg) => void vscode.window.showErrorMessage(msg),
        artUrl: (artKey) => webview.asWebviewUri(vscode.Uri.file(path.join(this.artDir, artKey))).toString(),
      }
    );

    webview.onDidReceiveMessage(async (data) => {
      this.output.handleMessage(data);
      await this.controller?.handleMessage(data);
    });

    webviewView.onDidDispose(() => {
      this.output.detach();
      this.controller = undefined;
      this.view = undefined;
    });
  }

  /** Extension, art cache, library folders, playlist directories and the folders of playlist-only files — nothing else is readable. */
  public getLocalFolderRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [this.extensionUri, vscode.Uri.file(this.artDir)];
    for (const folder of this.library.folders) {
      try {
        roots.push(vscode.Uri.parse(folder));
      } catch {
        // skip a malformed stored folder
      }
    }
    for (const file of this.library.playlistPaths) {
      roots.push(vscode.Uri.file(path.dirname(file)));
    }
    for (const dir of this.library.externalDirs) {
      roots.push(vscode.Uri.file(dir));
    }
    return roots;
  }

  public refreshLocalResourceRoots(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalFolderRoots(),
    };
  }

  public dispose(): void {
    for (const s of this.subscriptions) s.dispose();
    this.subscriptions.length = 0;
  }

  private getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
