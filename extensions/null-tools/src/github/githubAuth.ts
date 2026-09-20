'use strict';

import * as vscode from 'vscode';

const SCOPES = ['repo'];

export function getGithubSession(createIfNone: boolean): Thenable<vscode.AuthenticationSession | undefined> {
  return vscode.authentication.getSession('github', SCOPES, { createIfNone, silent: !createIfNone });
}
