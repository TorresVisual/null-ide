'use strict';

import * as vscode from 'vscode';
import { ActionButtonConfig, ParseResult, parseButtonConfigs } from './buttonConfig';

export function readButtonConfigs(): ParseResult {
  const raw = vscode.workspace.getConfiguration().get('null-actions.buttons');
  return parseButtonConfigs(raw);
}

export async function writeButtonConfigs(buttons: ActionButtonConfig[]): Promise<void> {
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration().update('null-actions.buttons', buttons, target);
}
