'use strict';

import * as vscode from 'vscode';
import { AgentsViewProvider } from './agentsPanel';

export class SoundManager {
  private _provider: AgentsViewProvider | null = null;
  private _enabled: boolean;

  constructor() {
    this._enabled = vscode.workspace.getConfiguration('null.soundDesign').get<boolean>('enabled', true);
  }

  attach(agentsProvider: AgentsViewProvider): void { this._provider = agentsProvider; }

  post(name: string): void {
    if (!this._enabled) return;
    this._provider?._view?.webview.postMessage({ type: 'playSound', name });
  }

  toggle(): boolean {
    this._enabled = !this._enabled;
    vscode.workspace.getConfiguration('null.soundDesign').update('enabled', this._enabled, true);
    return this._enabled;
  }
}
