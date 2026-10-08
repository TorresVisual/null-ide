'use strict';

import * as vscode from 'vscode';
import { openDashboard } from './dashboardIntegration';

export function registerRecentProjectsUriHandler(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      if (uri.path !== '/recent-projects') { return; }

      await openDashboard();
    },
  }));
}
