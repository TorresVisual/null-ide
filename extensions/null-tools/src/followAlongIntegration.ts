'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findProjectDir,
  pickNewestTranscript,
  isPathInWorkspace,
  parseAppendedLines,
  extractEdits,
  TranscriptEdit,
} from './followAlong';

const FADE_MS = 1200;

class FollowAlongWatcher implements vscode.Disposable {
  private dirWatcher?: fs.FSWatcher;
  private fileWatcher?: fs.FSWatcher;
  private activeFile: string | null = null;
  private offset = 0;
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly fadeTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly workspaceRoot: string) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
      isWholeLine: true,
    });
  }

  start(): void {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    const projectDir = findProjectDir(claudeProjectsDir, this.workspaceRoot);
    if (projectDir) {
      this.watchProjectDir(projectDir);
    } else {
      this.watchForProjectDir(claudeProjectsDir);
    }
  }

  dispose(): void {
    this.dirWatcher?.close();
    this.fileWatcher?.close();
    this.decorationType.dispose();
    for (const timer of this.fadeTimers.values()) clearTimeout(timer);
    this.fadeTimers.clear();
  }

  private watchForProjectDir(claudeProjectsDir: string): void {
    try {
      this.dirWatcher = fs.watch(claudeProjectsDir, () => {
        const projectDir = findProjectDir(claudeProjectsDir, this.workspaceRoot);
        if (projectDir) {
          this.dirWatcher?.close();
          this.dirWatcher = undefined;
          this.watchProjectDir(projectDir);
        }
      });
    } catch {
      // ~/.claude/projects doesn't exist yet (no session has ever run) — nothing to watch.
    }
  }

  private watchProjectDir(projectDir: string): void {
    // Skip backlog: start from whatever session is newest right now, at its current end.
    const newest = pickNewestTranscript(projectDir);
    if (newest) {
      this.activeFile = newest;
      this.offset = fs.statSync(newest).size;
    }
    try {
      this.fileWatcher = fs.watch(projectDir, (_event, filename) => {
        if (filename && !filename.endsWith('.jsonl')) return;
        this.onTranscriptChange(projectDir);
      });
    } catch {
      // Project dir was removed concurrently — nothing to watch.
    }
  }

  private onTranscriptChange(projectDir: string): void {
    const newest = pickNewestTranscript(projectDir);
    if (!newest) return;
    if (newest !== this.activeFile) {
      // A different (newer) session took over — don't replay its backlog either.
      this.activeFile = newest;
      this.offset = 0;
    }
    this.readAppended();
  }

  private readAppended(): void {
    if (!this.activeFile) return;
    let size: number;
    try {
      size = fs.statSync(this.activeFile).size;
    } catch {
      return;
    }
    if (size <= this.offset) {
      this.offset = Math.min(this.offset, size);
      return;
    }

    const buf = Buffer.alloc(size - this.offset);
    let fd: number;
    try {
      fd = fs.openSync(this.activeFile, 'r');
    } catch {
      return;
    }
    try {
      fs.readSync(fd, buf, 0, buf.length, this.offset);
    } finally {
      fs.closeSync(fd);
    }

    const { lines, consumedLength } = parseAppendedLines(buf.toString('utf8'));
    this.offset += consumedLength;

    for (const line of lines) {
      for (const edit of extractEdits(line)) {
        void this.applyEdit(edit);
      }
    }
  }

  private async applyEdit(edit: TranscriptEdit): Promise<void> {
    if (!isPathInWorkspace(edit.filePath, this.workspaceRoot)) return;

    let editor: vscode.TextEditor;
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(edit.filePath));
      editor = await vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true });
    } catch {
      return; // File may have been deleted/renamed since the edit landed.
    }

    const startLine = Math.max(0, edit.newStart - 1);
    const endLine = Math.min(editor.document.lineCount - 1, startLine + Math.max(0, edit.newLines - 1));
    const range = new vscode.Range(startLine, 0, endLine, editor.document.lineAt(endLine).text.length);

    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    editor.setDecorations(this.decorationType, [range]);

    const priorFade = this.fadeTimers.get(edit.filePath);
    if (priorFade) clearTimeout(priorFade);
    this.fadeTimers.set(edit.filePath, setTimeout(() => {
      editor.setDecorations(this.decorationType, []);
      this.fadeTimers.delete(edit.filePath);
    }, FADE_MS));
  }
}

export function registerFollowAlongFeature(context: vscode.ExtensionContext): void {
  const bar = vscode.window.createStatusBarItem('null.followAlong', vscode.StatusBarAlignment.Right, 0);
  bar.command = 'null.toggleFollowAlong';
  context.subscriptions.push(bar);

  let watcher: FollowAlongWatcher | undefined;

  const sync = () => {
    const enabled = vscode.workspace.getConfiguration('null.claude').get<boolean>('followAlong', false);
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    bar.text = enabled ? '$(eye) Follow Along' : '$(eye-closed) Follow Along';
    bar.tooltip = enabled
      ? 'Null: watching Claude Code\'s edits live — click to disable'
      : 'Null: click to follow Claude Code\'s edits live in the editor';
    bar.show();

    if (enabled && root && !watcher) {
      watcher = new FollowAlongWatcher(root);
      watcher.start();
    } else if ((!enabled || !root) && watcher) {
      watcher.dispose();
      watcher = undefined;
    }
  };

  sync();

  context.subscriptions.push(
    vscode.commands.registerCommand('null.toggleFollowAlong', async () => {
      const cfg = vscode.workspace.getConfiguration('null.claude');
      await cfg.update('followAlong', !cfg.get<boolean>('followAlong', false), vscode.ConfigurationTarget.Global);
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('null.claude.followAlong')) sync();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => sync()),
    { dispose: () => watcher?.dispose() },
  );
}
