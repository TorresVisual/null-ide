'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig } from './buttonConfig';
import { statusText, statusTooltip } from './buttonState';
import { ButtonRunState } from './terminalRegistry';

// How long a pass/fail result stays on the button before it reverts.
const RESULT_MS = 8000;

interface TrackedItem {
  item: vscode.StatusBarItem;
  priority: number;
}

export class StatusBarController {
  private items = new Map<string, TrackedItem>();
  private buttons = new Map<string, ActionButtonConfig>();
  private shown = new Map<string, ButtonRunState>();
  private expiry = new Map<string, ReturnType<typeof setTimeout>>();

  /** Overlays a button's run state; a finished result reverts on its own. */
  setState(id: string, state: ButtonRunState | undefined): void {
    clearTimeout(this.expiry.get(id));
    this.expiry.delete(id);
    if (state) { this.shown.set(id, state); } else { this.shown.delete(id); }
    if (state && state.kind !== 'running') {
      this.expiry.set(id, setTimeout(() => this.setState(id, undefined), RESULT_MS));
    }
    const item = this.items.get(id)?.item;
    const button = this.buttons.get(id);
    if (item && button) { this.applyButton(item, button); }
  }

  /** True while the button shows a failed result (a click then reveals the terminal). */
  showsFailure(id: string): boolean {
    return this.shown.get(id)?.kind === 'failed';
  }

  update(buttons: ActionButtonConfig[]): void {
    const nextIds = new Set(buttons.map(b => b.id));
    this.buttons = new Map(buttons.map(b => [b.id, b]));

    for (const [id, tracked] of this.items) {
      if (!nextIds.has(id)) {
        tracked.item.dispose();
        this.items.delete(id);
      }
    }

    for (const button of buttons) {
      const existing = this.items.get(button.id);
      // Priority is fixed at creation time by the VS Code API (there's no
      // setter) — recreate the item if it changed.
      if (existing && existing.priority !== button.priority) {
        existing.item.dispose();
        this.items.delete(button.id);
      }

      const tracked = this.items.get(button.id) ?? this.create(button);
      this.applyButton(tracked.item, button);
      this.items.set(button.id, tracked);
    }
  }

  dispose(): void {
    this.expiry.forEach(clearTimeout);
    this.expiry.clear();
    for (const tracked of this.items.values()) {
      tracked.item.dispose();
    }
    this.items.clear();
  }

  private create(button: ActionButtonConfig): TrackedItem {
    const item = vscode.window.createStatusBarItem(`null-actions.${button.id}`, vscode.StatusBarAlignment.Left, button.priority);
    return { item, priority: button.priority };
  }

  private applyButton(item: vscode.StatusBarItem, button: ActionButtonConfig): void {
    const state = this.shown.get(button.id);
    item.text = statusText(button.label, button.icon, state);
    item.tooltip = statusTooltip(button.tooltip, state);
    item.color = button.color;
    item.backgroundColor = button.background !== 'none'
      ? new vscode.ThemeColor(`statusBarItem.${button.background}Background`)
      : undefined;
    item.command = { command: 'null-actions.runButton', title: button.label, arguments: [button.id] };
    item.show();
  }
}
