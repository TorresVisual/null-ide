'use strict';

import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { dayRange, formatDuration } from './stats';

export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  private readonly subscription: { dispose(): void };
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly service: ActivityService) {
    this.item.command = 'null-activity.showTrackedData';
    this.subscription = service.onDidChange(() => this.update());
    this.timer = setInterval(() => this.update(), 60_000);
    this.update();
    this.item.show();
  }

  update(): void {
    if (!this.service.enabled) {
      this.item.text = '$(clock) Off';
      this.item.tooltip = 'Null Activity: tracking is off (setting null-activity.enabled)';
      return;
    }
    const ms = this.service.getDailyStats(dayRange(Date.now())).reduce((n, d) => n + d.ms, 0);
    this.item.text = `$(clock) ${formatDuration(ms)}`;
    this.item.tooltip = 'Null Activity: time tracked today. Click to see what is recorded.';
  }

  dispose(): void {
    clearInterval(this.timer);
    this.subscription.dispose();
    this.item.dispose();
  }
}
