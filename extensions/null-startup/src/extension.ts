'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { Capture } from './capture';
import { ReportStore } from './reportStore';
import { normalizeRetention } from './settings';
import { takeSnapshot } from './snapshotSource';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Null Startup');
  const log = (message: string) => output.appendLine(message);
  const config = () => vscode.workspace.getConfiguration('null-startup');

  const store = new ReportStore({
    dir: path.join(context.globalStorageUri.fsPath, 'reports'),
    fs: {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => undefined),
      readdir: (dir) => fs.readdir(dir),
      readFile: (file) => fs.readFile(file, 'utf8'),
      writeFile: (file, data) => fs.writeFile(file, data, 'utf8'),
      unlink: (file) => fs.unlink(file),
    },
    retention: () => normalizeRetention(config().get('retention')),
    log,
  });
  context.subscriptions.push(output);

  if (config().get('enabled') === false) return;

  const capture = new Capture({
    snapshot: () => takeSnapshot(log),
    save: (report) => store.save(report),
    now: () => Date.now(),
    windowId: crypto.randomBytes(4).toString('hex'),
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms);
      return { dispose: () => clearTimeout(t) };
    },
    log,
    onSaved: () => {},
  });
  context.subscriptions.push({ dispose: () => capture.dispose() });
  void capture.run();
}

export function deactivate(): void {}
