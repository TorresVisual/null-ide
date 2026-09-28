'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { findProjectDir, pickNewestTranscript, isPathInWorkspace, parseAppendedLines } from './followAlong';
import { WhyAnnotation, WhyIndex, excerpt } from './whyIsThisHere';

const EXCERPT_LENGTH = 300;

// Watches the active Claude Code session's transcript (same approach as
// FollowAlongWatcher in followAlongIntegration.ts, minus the decorations)
// and keeps a WhyIndex of it up to date.
class WhyWatcher implements vscode.Disposable {
  private dirWatcher?: fs.FSWatcher;
  private fileWatcher?: fs.FSWatcher;
  private activeFile: string | null = null;
  private offset = 0;
  private index: WhyIndex | null = null;

  constructor(private readonly workspaceRoot: string) {}

  start(): void {
    const claudeProjectsDir = path.join(os.homedir(), '.claude', 'projects');
    const projectDir = findProjectDir(claudeProjectsDir, this.workspaceRoot);
    if (projectDir) this.watchProjectDir(projectDir);
    else this.watchForProjectDir(claudeProjectsDir);
  }

  dispose(): void {
    this.dirWatcher?.close();
    this.fileWatcher?.close();
  }

  getIndex(): WhyIndex | null {
    return this.index;
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
    // Skip backlog, same choice as Follow Along (#99): start indexing from
    // whatever session is newest right now, at its current end.
    const newest = pickNewestTranscript(projectDir);
    if (newest) {
      this.activeFile = newest;
      this.offset = fs.statSync(newest).size;
      this.index = new WhyIndex(path.basename(newest, '.jsonl'));
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
      this.activeFile = newest;
      this.offset = 0;
      this.index = new WhyIndex(path.basename(newest, '.jsonl'));
    }
    this.readAppended();
  }

  private readAppended(): void {
    if (!this.activeFile || !this.index) return;
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
    this.index.ingest(lines);
  }
}

function buildHoverMarkdown(annotation: WhyAnnotation): vscode.MarkdownString {
  const md = new vscode.MarkdownString();

  if (annotation.sessionTitle) {
    md.appendMarkdown('**');
    md.appendText(annotation.sessionTitle);
    md.appendMarkdown('**\n\n');
  }
  if (annotation.prompt) {
    md.appendMarkdown('**You asked:** ');
    md.appendText(excerpt(annotation.prompt, EXCERPT_LENGTH));
    md.appendMarkdown('\n\n');
  }
  md.appendMarkdown('**Claude said:** ');
  if (annotation.claudeSaid) {
    md.appendText(excerpt(annotation.claudeSaid, EXCERPT_LENGTH));
  } else {
    md.appendMarkdown('_(no explanation — this edit landed without a preceding message)_');
  }
  md.appendMarkdown('\n\n');

  if (annotation.timestamp) {
    const when = new Date(annotation.timestamp);
    if (!Number.isNaN(when.getTime())) md.appendMarkdown(`*${when.toLocaleString()}*\n\n`);
  }
  md.appendMarkdown(`[Resume this session](vscode://anthropic.claude-code/open?session=${annotation.sessionId})`);
  return md;
}

export function registerWhyIsThisHereFeature(context: vscode.ExtensionContext): void {
  let watcher: WhyWatcher | undefined;
  let root: string | undefined;

  const sync = () => {
    const newRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (newRoot === root) return;
    watcher?.dispose();
    watcher = undefined;
    root = newRoot;
    if (root) {
      watcher = new WhyWatcher(root);
      watcher.start();
    }
  };
  sync();

  const hoverProvider: vscode.HoverProvider = {
    provideHover(document, position) {
      if (!watcher || !root) return undefined;
      const index = watcher.getIndex();
      if (!index) return undefined;
      if (!isPathInWorkspace(document.uri.fsPath, root)) return undefined;

      const line = document.lineAt(position.line);
      const match = index.findAnnotation(document.uri.fsPath, position.line + 1, line.text);
      return match ? new vscode.Hover(buildHoverMarkdown(match.annotation), line.range) : undefined;
    },
  };

  context.subscriptions.push(
    vscode.languages.registerHoverProvider({ scheme: 'file' }, hoverProvider),
    vscode.workspace.onDidChangeWorkspaceFolders(() => sync()),
    { dispose: () => watcher?.dispose() },
  );
}
