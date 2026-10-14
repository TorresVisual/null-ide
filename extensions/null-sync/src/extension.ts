'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { EnableDeps } from './enable';
import { extensionHost } from './extensionHost';
import { fetchJson, fetchText } from './gistHttp';
import { LocalFiles } from './localFiles';
import { acquire } from './lock';
import { SyncEngine } from './syncEngine';
import { CATEGORY_DEFAULTS, Category, NullSyncApi, StoredState, SyncAccount } from './types';

const STATE_KEY = 'null-sync.state';
const PASSPHRASE_KEY = 'null-sync/passphrase';
const STARTUP_MS = 10_000;
const DEBOUNCE_MS = 30_000;
const INTERVAL_MS = 10 * 60_000;

/** The part of null-accounts' public API used here (a separate extension, so no shared import). */
interface AccountRecord {
  id: string;
  provider: string;
  host: string;
  username: string;
  authMethod: string;
}
interface AccountsApi {
  getAccounts(): AccountRecord[];
  getToken(account: AccountRecord, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
}

/** Windows paths are case-insensitive (Null IDE is Windows-only). */
const samePath = (a: string, b: string): boolean => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export function activate(context: vscode.ExtensionContext): NullSyncApi {
  const config = () => vscode.workspace.getConfiguration('null-sync');
  const storage = context.globalStorageUri.fsPath;
  // `<User>/globalStorage/<publisher.name>` -> `<User>`, where settings.json, keybindings.json and snippets/ live.
  const userDir = path.dirname(path.dirname(storage));
  fs.mkdirSync(storage, { recursive: true });

  const accountsApi = () => vscode.extensions.getExtension<AccountsApi>('null.null-accounts')?.activate();
  const categories = (): Record<Category, boolean> => ({
    ...CATEGORY_DEFAULTS,
    ...config().get<Partial<Record<Category, boolean>>>('categories'),
  });
  const githubAccounts = async (): Promise<SyncAccount[]> =>
    ((await accountsApi())?.getAccounts() ?? [])
      .filter((a) => a.provider === 'github' && a.host === 'github.com' && a.authMethod !== 'ssh')
      .map(({ id, username }) => ({ id, username }));
  const token = async (accountId: string, interactive: boolean): Promise<string | undefined> => {
    const api = await accountsApi();
    const account = api?.getAccounts().find((a) => a.id === accountId);
    return api && account ? api.getToken(account, ['gist'], { interactive }) : undefined;
  };
  const io = { json: fetchJson, text: fetchText };

  const files = new LocalFiles({
    userDir,
    backupsDir: path.join(storage, 'backups'),
    now: Date.now,
    isDirty: (absolutePath) => vscode.workspace.textDocuments.some((doc) => doc.isDirty && samePath(doc.uri.fsPath, absolutePath)),
  });

  const engine = new SyncEngine({
    enabled: () => config().get<boolean>('enabled', false),
    categories,
    excluded: () => config().get<string[]>('excludedSettings', []),
    accounts: githubAccounts,
    token,
    io,
    files,
    passphrase: async () => context.secrets.get(PASSPHRASE_KEY),
    clearPassphrase: async () => context.secrets.delete(PASSPHRASE_KEY),
    state: { get: () => context.globalState.get<StoredState>(STATE_KEY) },
    setState: async (state) => { await context.globalState.update(STATE_KEY, state); },
    lock: () => acquire(path.join(storage, 'lock')),
    now: Date.now,
    extensions: extensionHost,
    confirmOverwrite: async (file) =>
      (await vscode.window.showWarningMessage(`${file} has unsaved changes. Overwrite it with the synced version?`, { modal: true }, 'Overwrite')) === 'Overwrite',
  });

  const enableDeps: EnableDeps = {
    accounts: githubAccounts,
    token,
    io,
    categories: () => (Object.keys(CATEGORY_DEFAULTS) as Category[]).filter((category) => categories()[category]),
    savePassphrase: async (passphrase) => { await context.secrets.store(PASSPHRASE_KEY, passphrase); },
    setState: async (state) => { await context.globalState.update(STATE_KEY, state); },
  };

  const changed = new vscode.EventEmitter<void>();
  context.subscriptions.push(changed, engine.onDidChange(() => changed.fire()));
  registerCommands(context, engine, enableDeps, userDir);

  // Background triggers: shortly after startup, after a synced file changes (debounced), and on a timer. None prompt.
  const background = (): void => void engine.run({ interactive: false });
  let debounce: NodeJS.Timeout | undefined;
  const fileChanged = (): void => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(background, DEBOUNCE_MS);
  };
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(vscode.Uri.file(userDir), '{settings.json,keybindings.json,snippets/*}'),
  );
  const startup = setTimeout(background, STARTUP_MS);
  const timer = setInterval(background, INTERVAL_MS);
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(fileChanged),
    watcher.onDidCreate(fileChanged),
    watcher.onDidDelete(fileChanged),
    vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('null-sync')) background(); }),
    { dispose: () => { clearTimeout(startup); clearInterval(timer); if (debounce) clearTimeout(debounce); } },
  );

  return {
    getStatus: () => engine.getStatus(),
    onDidChangeStatus: changed.event,
    syncNow: () => engine.run({ interactive: true }),
    resolveConflict: (file, side) => engine.resolve(file, side),
    uninstallRemoved: (id) => engine.uninstallRemoved(id),
    syncActivity: (exchange) => engine.syncActivity(exchange),
  };
}

export function deactivate(): void {}
