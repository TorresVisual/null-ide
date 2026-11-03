import * as vscode from 'vscode';

export function createRunStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
  item.text = '$(play) Run';
  item.tooltip = 'Run the Unreal project (null-unreal run)';
  item.command = 'null-unreal.run';
  item.show();
  return item;
}
