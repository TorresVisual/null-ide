'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig } from './buttonConfig';

interface TrackedItem {
  item: vscode.StatusBarItem;
  priority: number;
}

export class StatusBarController {
  private items = new Map<string, TrackedItem>();

  update(buttons: ActionButtonConfig[]): void {
    const nextIds = new Set(buttons.map(b => b.id));

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
    item.text = button.icon ? `$(${button.icon}) ${button.label}` : button.label;
    item.tooltip = button.tooltip;
    item.color = button.color;
    item.backgroundColor = button.background !== 'none'
      ? new vscode.ThemeColor(`statusBarItem.${button.background}Background`)
      : undefined;
    item.command = { command: 'null-actions.runButton', title: button.label, arguments: [button.id] };
    item.show();
  }
}
