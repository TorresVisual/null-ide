'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { DiscordActivity, DiscordRpcClient } from './discordRpcClient';

const NULL_REPO_URL = 'https://github.com/TorresVisual/null-ide';

/** Maps VS Code language IDs to Discord Rich Presence asset keys. */
const LANGUAGE_KEYS: Record<string, string> = {
  typescript: 'typescript',
  typescriptreact: 'typescript',
  javascript: 'javascript',
  javascriptreact: 'javascript',
  python: 'python',
  rust: 'rust',
  go: 'go',
  java: 'java',
  csharp: 'csharp',
  cpp: 'cpp',
  c: 'c',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  markdown: 'markdown',
  yaml: 'yaml',
  sql: 'sql',
  shellscript: 'shell',
  powershell: 'powershell',
  ruby: 'ruby',
  php: 'php',
  swift: 'swift',
  kotlin: 'kotlin',
  dart: 'dart',
  lua: 'lua',
  r: 'r',
  dockerfile: 'docker',
};

interface PresenceConfig {
  enabled: boolean;
  clientId: string;
  showFileName: boolean;
  showWorkspace: boolean;
  privacyMode: boolean;
  idleTimeoutSec: number;
  showDebug: boolean;
  showRepositoryButton: boolean;
}

function getConfig(): PresenceConfig {
  const cfg = vscode.workspace.getConfiguration('null.discord');
  const clientId = (cfg.get<string>('clientId') ?? '').trim();
  return {
    enabled: cfg.get<boolean>('enabled', true),
    clientId,
    showFileName: cfg.get<boolean>('showFileName', true),
    showWorkspace: cfg.get<boolean>('showWorkspace', true),
    privacyMode: cfg.get<boolean>('privacyMode', false),
    idleTimeoutSec: cfg.get<number>('idleTimeoutSec', 300),
    showDebug: cfg.get<boolean>('showDebug', true),
    showRepositoryButton: cfg.get<boolean>('showRepositoryButton', true),
  };
}

function languageKey(document: vscode.TextDocument): string {
  const mapped = LANGUAGE_KEYS[document.languageId];
  if (mapped) { return mapped; }
  const id = document.languageId.replace(/[^a-z0-9]+/gi, '').toLowerCase();
  return id || 'code';
}

function languageLabel(document: vscode.TextDocument): string {
  return document.languageId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/react$/i, ' React')
    .replace(/^./, (c) => c.toUpperCase());
}

function workspaceLabel(editor?: vscode.TextEditor): string | undefined {
  if (!editor) { return undefined; }
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (folder?.name) { return folder.name; }
  if (vscode.workspace.name) { return vscode.workspace.name; }
  return undefined;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) { return text; }
  return `${text.slice(0, max - 1)}…`;
}

async function gitRemoteUrl(): Promise<string | undefined> {
  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) { return undefined; }

  try {
    const git = gitExt.isActive ? gitExt.exports.getAPI(1) : (await gitExt.activate()).getAPI(1);
    const repo = git.repositories.find((r: { ui: { selected: boolean } }) => r.ui.selected) ?? git.repositories[0];
    const remote = repo?.state?.remotes?.[0]?.fetchUrl as string | undefined;
    if (!remote) { return undefined; }

    if (remote.startsWith('git@') || remote.startsWith('ssh://')) {
      return remote.replace('ssh://', '').replace(':', '/').replace(/^git@/, 'https://').replace(/\.git$/, '');
    }
    return remote.replace(/(https:\/\/)([^@]*)@/, '$1').replace(/\.git$/, '');
  } catch {
    return undefined;
  }
}

export class DiscordPresenceManager implements vscode.Disposable {
  private client: DiscordRpcClient | null = null;
  private connected = false;
  private readonly sessionStart = Date.now();
  private lastActivityAt = Date.now();
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  start(): void {
    void this.scheduleUpdate(0);
  }

  dispose(): void {
    this.disposed = true;
    if (this.updateTimer) { clearTimeout(this.updateTimer); }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); }
    void this.client?.clearActivity().catch(() => undefined);
    void this.client?.disconnect().catch(() => undefined);
    this.client = null;
    this.connected = false;
  }

  notifyActivity(): void {
    this.lastActivityAt = Date.now();
    void this.scheduleUpdate(750);
  }

  notifyConfigChange(): void {
    void this.client?.disconnect().catch(() => undefined);
    this.client = null;
    this.connected = false;
    void this.scheduleUpdate(0);
  }

  private async scheduleUpdate(delayMs: number): Promise<void> {
    if (this.disposed) { return; }
    if (this.updateTimer) { clearTimeout(this.updateTimer); }

    this.updateTimer = setTimeout(() => {
      void this.pushPresence();
    }, delayMs);
  }

  private async pushPresence(): Promise<void> {
    if (this.disposed) { return; }

    const config = getConfig();
    if (!config.enabled || !config.clientId) {
      if (this.connected) {
        await this.client?.clearActivity().catch(() => undefined);
        await this.client?.disconnect().catch(() => undefined);
        this.client = null;
        this.connected = false;
      }
      return;
    }

    try {
      if (!this.client) {
        this.client = new DiscordRpcClient(config.clientId);
      }
      if (!this.connected) {
        await this.client.connect();
        this.connected = true;
      }

      const activity = await this.buildActivity(config);
      await this.client.setActivity(activity);
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
    } catch {
      this.connected = false;
      await this.client?.disconnect().catch(() => undefined);
      this.client = null;
      this.queueReconnect();
    }
  }

  private queueReconnect(): void {
    if (this.disposed || this.reconnectTimer) { return; }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.scheduleUpdate(0);
    }, 15_000);
  }

  private async buildActivity(config: PresenceConfig): Promise<DiscordActivity> {
    const editor = vscode.window.activeTextEditor;
    const debugging = config.showDebug && !!vscode.debug.activeDebugSession;
    const idle = config.idleTimeoutSec > 0
      && Date.now() - this.lastActivityAt >= config.idleTimeoutSec * 1000;

    const activity: DiscordActivity = {
      startTimestamp: this.sessionStart,
      smallImageKey: 'null',
      smallImageText: 'Null IDE',
    };

    if (config.showRepositoryButton) {
      const repoUrl = await gitRemoteUrl();
      activity.buttons = [{
        label: repoUrl ? 'View Repository' : 'Null IDE',
        url: repoUrl ?? NULL_REPO_URL,
      }];
    }

    if (debugging) {
      activity.details = 'Debugging';
      activity.state = config.showWorkspace ? workspaceLabel(editor) ?? 'Null IDE' : undefined;
      activity.largeImageKey = 'debug';
      activity.largeImageText = 'Debugging';
      return activity;
    }

    if (!editor || idle) {
      activity.details = idle ? 'Idle in Null IDE' : 'In Null IDE';
      activity.state = config.showWorkspace ? workspaceLabel(editor) ?? (idle ? undefined : 'Idle') : undefined;
      activity.largeImageKey = 'null';
      activity.largeImageText = 'Null IDE';
      return activity;
    }

    const langKey = languageKey(editor.document);
    const langText = languageLabel(editor.document);

    if (config.privacyMode) {
      activity.details = 'Editing code';
      activity.state = config.showWorkspace ? workspaceLabel(editor) : langText;
    } else if (config.showFileName) {
      activity.details = truncate(path.basename(editor.document.fileName), 128);
      activity.state = config.showWorkspace
        ? workspaceLabel(editor) ?? langText
        : langText;
    } else {
      activity.details = langText;
      activity.state = config.showWorkspace ? workspaceLabel(editor) : undefined;
    }

    activity.largeImageKey = langKey;
    activity.largeImageText = langText;
    return activity;
  }
}
