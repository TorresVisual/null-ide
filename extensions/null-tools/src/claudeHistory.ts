'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface ClaudeCodeSession {
  sessionId: string;
  title: string;
  lastActive: string;
  messageCount: number;
  model?: string;
  branch?: string;
  filePath: string;
}

// Claude Code encodes workspace paths as: lowercase drive letter, :\ → --, remaining \/ → -
// e.g. D:\Coding\Apps\null-ide → D--Coding-Apps-null-ide
function encodeProjectPath(workspacePath: string): string {
  let p = workspacePath;
  p = p.replace(/^([A-Za-z]):[\\\/]/, (_, d: string) => d.toLowerCase() + '--');
  p = p.replace(/[\\\/]/g, '-');
  return p;
}

function parseSessionHead(filePath: string): ClaudeCodeSession | null {
  try {
    const buf = Buffer.alloc(8192);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    fs.closeSync(fd);
    const rawLines = buf.slice(0, bytesRead).toString('utf8').split('\n');

    const lines: Record<string, unknown>[] = [];
    for (const line of rawLines) {
      const t = line.trim();
      if (!t) continue;
      try { lines.push(JSON.parse(t) as Record<string, unknown>); } catch {}
      if (lines.length >= 40) break;
    }

    let aiTitle = '';
    let firstUserTitle = '';
    let model: string | undefined;
    let branch: string | undefined;
    let lastActive = '';
    let messageCount = 0;

    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;

      if (typeof line['timestamp'] === 'string') lastActive = line['timestamp'] as string;
      if (!branch && typeof line['gitBranch'] === 'string') branch = line['gitBranch'] as string;

      // ai-title is the most reliable title — Claude Code generates it from conversation content
      if (line['type'] === 'ai-title' && typeof line['aiTitle'] === 'string') {
        aiTitle = (line['aiTitle'] as string).replace(/-/g, ' ').slice(0, 60);
      }

      if (line['type'] === 'user') {
        messageCount++;
        if (!firstUserTitle) {
          const msg = line['message'] as Record<string, unknown> | undefined;
          const content = msg?.['content'];
          let raw = '';
          if (typeof content === 'string') {
            raw = content;
          } else if (Array.isArray(content)) {
            const textPart = (content as Record<string, unknown>[]).find(c => c['type'] === 'text');
            if (textPart && typeof textPart['text'] === 'string') raw = textPart['text'] as string;
          }
          if (raw) {
            const cleaned = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleaned.length >= 2) firstUserTitle = cleaned.slice(0, 60);
          }
        }
      }

      if (!model && line['type'] === 'assistant') {
        const msg = line['message'] as Record<string, unknown> | undefined;
        if (typeof msg?.['model'] === 'string') model = msg['model'] as string;
      }
    }

    // If no ai-title found in the head, scan the tail of the file (last 4 KB).
    // Claude Code emits ai-title after the first assistant response, which can
    // be deep in a long session file and outside the 8 KB head window.
    if (!aiTitle) {
      try {
        const size = fs.statSync(filePath).size;
        const tailOffset = Math.max(0, size - 4096);
        if (tailOffset > 0) {
          const tailBuf = Buffer.alloc(size - tailOffset);
          const tailFd = fs.openSync(filePath, 'r');
          fs.readSync(tailFd, tailBuf, 0, tailBuf.length, tailOffset);
          fs.closeSync(tailFd);
          for (const tline of tailBuf.toString('utf8').split('\n')) {
            const t = tline.trim();
            if (!t) continue;
            try {
              const obj = JSON.parse(t) as Record<string, unknown>;
              if (obj['type'] === 'ai-title' && typeof obj['aiTitle'] === 'string') {
                aiTitle = (obj['aiTitle'] as string).replace(/-/g, ' ').slice(0, 60);
              }
            } catch {}
          }
        }
      } catch {}
    }

    if (!aiTitle && !firstUserTitle && !lastActive) return null;

    const sessionId = path.basename(filePath, '.jsonl');

    if (!lastActive) {
      try { lastActive = fs.statSync(filePath).mtime.toISOString(); }
      catch { lastActive = new Date().toISOString(); }
    }

    // Prefer ai-title (Claude Code's generated slug), fall back to first user message
    const title = aiTitle || firstUserTitle || sessionId.slice(0, 8) + '…';

    return { sessionId, title, lastActive, messageCount, model, branch, filePath };
  } catch {
    return null;
  }
}

export class ClaudeHistoryIndex {
  private _watcher: vscode.FileSystemWatcher | null = null;
  readonly claudeProjectDir: string;

  constructor(private readonly _workspaceRoot: string) {
    this.claudeProjectDir = this._resolve();
  }

  private _resolve(): string {
    const homeDir = os.homedir();
    const encoded = encodeProjectPath(this._workspaceRoot);
    const direct = path.join(homeDir, '.claude', 'projects', encoded);
    if (fs.existsSync(direct)) return direct;

    // Fallback: scan project dirs and match by cwd field in first .jsonl line
    try {
      const projectsRoot = path.join(homeDir, '.claude', 'projects');
      const dirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => path.join(projectsRoot, d.name));

      for (const dir of dirs) {
        try {
          const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
          if (files.length === 0) continue;
          const sample = path.join(dir, files[0]);
          const buf = Buffer.alloc(512);
          const fd = fs.openSync(sample, 'r');
          const n = fs.readSync(fd, buf, 0, 512, 0);
          fs.closeSync(fd);
          const firstLine = buf.slice(0, n).toString('utf8').split('\n')[0];
          const obj = JSON.parse(firstLine) as Record<string, unknown>;
          const cwd = typeof obj['cwd'] === 'string' ? obj['cwd'] as string : '';
          if (cwd && path.normalize(cwd).toLowerCase() === path.normalize(this._workspaceRoot).toLowerCase()) {
            return dir;
          }
        } catch {}
      }
    } catch {}

    return path.join(homeDir, '.claude', 'projects', encoded);
  }

  async build(): Promise<ClaudeCodeSession[]> {
    try {
      if (!fs.existsSync(this.claudeProjectDir)) return [];
      const files = fs.readdirSync(this.claudeProjectDir)
        .filter((f: string) => f.endsWith('.jsonl'))
        .map((f: string) => path.join(this.claudeProjectDir, f));

      const withMtime = files.map((f: string) => {
        try { return { f, mtime: fs.statSync(f).mtimeMs }; }
        catch { return { f, mtime: 0 }; }
      }).sort((a: { mtime: number }, b: { mtime: number }) => b.mtime - a.mtime);

      const sessions: ClaudeCodeSession[] = [];
      for (const { f } of withMtime) {
        const s = parseSessionHead(f as string);
        if (s) sessions.push(s);
      }
      return sessions;
    } catch {
      return [];
    }
  }

  watch(onChange: (sessions: ClaudeCodeSession[]) => void): void {
    const dir = this.claudeProjectDir;
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(dir)),
      path.basename(dir) + '/*.jsonl',
    );
    this._watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const refresh = () => this.build().then(s => onChange(s));
    this._watcher.onDidCreate(refresh);
    this._watcher.onDidChange(refresh);
    this._watcher.onDidDelete(refresh);
  }

  dispose(): void {
    this._watcher?.dispose();
    this._watcher = null;
  }
}
