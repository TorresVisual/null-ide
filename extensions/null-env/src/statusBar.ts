import * as vscode from 'vscode';
import type { EnvState } from './envState';

export function registerStatusBar(context: vscode.ExtensionContext, state: EnvState): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  item.command = 'null.env.check';
  item.name = 'Null Environment';

  const render = (): void => {
    const warnings = state.warnings();
    if (warnings.length === 0) {
      item.hide();
      return;
    }
    item.text = `$(warning) ${warnings.length} missing`;
    item.tooltip = `Missing for this workspace: ${warnings.map(f => f.label).join(', ')}. Click to fix.`;
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    item.show();
  };

  context.subscriptions.push(item, state.onDidChange(render));
  render();
}
