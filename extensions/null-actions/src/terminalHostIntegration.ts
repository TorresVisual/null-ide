'use strict';

import * as vscode from 'vscode';
import { TerminalHandle, TerminalHost } from './terminalRegistry';

export class VscodeTerminalHost implements TerminalHost {
  listTerminals(): TerminalHandle[] {
    return [...vscode.window.terminals];
  }

  createTerminal(options: { name: string; cwd?: string }): TerminalHandle {
    return vscode.window.createTerminal({ name: options.name, cwd: options.cwd });
  }
}
