'use strict';

import * as vscode from 'vscode';
import { PlaybackManager } from '../playback/playbackManager';
import { PlaybackState } from '../types';
import { buildStatusBarModel } from './statusBarModel';

export class StatusBarController implements vscode.Disposable {
  private mainItem: vscode.StatusBarItem;
  private prevItem?: vscode.StatusBarItem;
  private playPauseItem?: vscode.StatusBarItem;
  private nextItem?: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly playbackManager: PlaybackManager) {
    this.mainItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100
    );
    this.mainItem.command = 'null-music.focus';

    this.disposables.push(
      this.mainItem,
      this.playbackManager.onDidChangePlaybackState((state) => this.update(state)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('null-music.statusBar')) {
          this.rebuildControls();
          this.update(this.playbackManager.getCurrentState());
        }
      })
    );

    this.rebuildControls();
    this.update(this.playbackManager.getCurrentState());
  }

  private rebuildControls(): void {
    const config = vscode.workspace.getConfiguration('null-music.statusBar');
    const showControls = config.get<boolean>('showControls', false);

    if (this.prevItem) { this.prevItem.dispose(); this.prevItem = undefined; }
    if (this.playPauseItem) { this.playPauseItem.dispose(); this.playPauseItem = undefined; }
    if (this.nextItem) { this.nextItem.dispose(); this.nextItem = undefined; }

    if (showControls) {
      this.prevItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 103);
      this.prevItem.text = '$(chevron-left)';
      this.prevItem.tooltip = 'Previous Track (Null Music)';
      this.prevItem.command = 'null-music.previousTrack';
      this.prevItem.show();

      this.playPauseItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
      this.playPauseItem.text = '$(play)';
      this.playPauseItem.tooltip = 'Play / Pause (Null Music)';
      this.playPauseItem.command = 'null-music.playPause';
      this.playPauseItem.show();

      this.nextItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
      this.nextItem.text = '$(chevron-right)';
      this.nextItem.tooltip = 'Next Track (Null Music)';
      this.nextItem.command = 'null-music.nextTrack';
      this.nextItem.show();
    }
  }

  public update(state: PlaybackState | null): void {
    const config = vscode.workspace.getConfiguration('null-music.statusBar');
    const isEnabled = config.get<boolean>('enabled', true);

    if (!isEnabled) {
      this.mainItem.hide();
      this.prevItem?.hide();
      this.playPauseItem?.hide();
      this.nextItem?.hide();
      return;
    }

    const formatPattern = config.get<string>('format', '${title} - ${artist}');
    const model = buildStatusBarModel(state, formatPattern);

    this.mainItem.text = model.text;

    const tooltip = new vscode.MarkdownString(model.tooltipText, true);
    tooltip.isTrusted = true;
    this.mainItem.tooltip = tooltip;
    this.mainItem.show();

    if (this.playPauseItem) {
      this.playPauseItem.text = model.isPlaying ? '$(debug-pause)' : '$(play)';
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
