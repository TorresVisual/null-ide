'use strict';

import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { computeGitStatuses, GitStatus } from '../dashboardGitStatus';
import { requestGraphql, requestJson } from '../github/githubApi';
import { parseGithubRemote } from '../github/githubRemote';
import { PresenceOwnership } from '../presenceOwnership';
import { getRecentProjectsFilePath, readRecentProjects } from '../recentProjects';
import { findInstall } from '../updater';
import { fetchRepos } from './widgetFetch';
import { WidgetRefresher } from './widgetRefresher';
import { buildProjects } from './widgetSections';
import { localPathsFrom, mergeRepos, repoChoices, widgetEnv } from './widgetSetup';
import { SnapshotStore, widgetsDir } from './widgetStore';
import { WidgetRepo, parseRepos } from './widgetTypes';

/** The slice of null-accounts' API used here (a structural copy, as in githubSession.ts). */
interface AccountsApi {
  getAccounts(): Array<{ id: string; provider: string; username: string; host: string }>;
  getToken(account: { id: string; provider: string; username: string; host: string }, scopes?: string[], options?: { interactive?: boolean }): Promise<string | undefined>;
}
const accountsApi = (): AccountsApi | undefined => vscode.extensions.getExtension<AccountsApi>('null.null-accounts')?.exports;

const gitRemote = (cwd: string): Promise<string | null> => new Promise(resolve =>
  execFile('git', ['remote', 'get-url', 'origin'], { cwd, timeout: 5000 }, (err, out) => {
    const ref = err ? null : parseGithubRemote(out);
    resolve(ref ? `${ref.owner}/${ref.repo}` : null);
  }));

const settings = (): { enabled: boolean; repos: WidgetRepo[] } => {
  const c = vscode.workspace.getConfiguration('null.widgets');
  return { enabled: c.get<boolean>('enabled', false), repos: parseRepos(c.get<unknown>('repos', [])) };
};

export function registerWidgetsFeature(context: vscode.ExtensionContext): void {
  const supported = process.platform === 'win32';
  const notSupported = (): void => void vscode.window.showInformationMessage('Desktop widgets are only available on Windows.');
  const out = vscode.window.createOutputChannel('Null Widgets');
  const log = (m: string): void => out.appendLine(m);
  let refresher: WidgetRefresher | undefined;  // set below; the refresh command may run before (or without) it

  /** Starts the widgets (a second start of a running exe only un-hides hidden widgets): `<install>\null_widgets.exe`. False when this build has no exe. */
  const startWidgets = (): boolean => {
    const install = findInstall(context);
    const exe = install && path.join(install.installDir, 'null_widgets.exe');
    if (!exe || !fs.existsSync(exe)) { return false; }
    const child = spawn(exe, [], { detached: true, stdio: 'ignore', windowsHide: true, cwd: os.tmpdir(), env: widgetEnv(process.env) });
    child.once('error', err => log(`could not start null_widgets.exe: ${err.message}`));
    child.unref();
    return true;
  };

  const setup = async (): Promise<void> => {
    if (!supported) { notSupported(); return; }
    const api = accountsApi();
    const accounts = api?.getAccounts().filter(a => a.provider === 'github') ?? [];
    if (!api || accounts.length === 0) {
      void vscode.window.showWarningMessage('Add a GitHub account first (Null: Accounts), then run Set Up Widgets again.');
      return;
    }
    const account = accounts.length === 1 ? accounts[0]
      : (await vscode.window.showQuickPick(accounts.map(a => ({ label: a.username, description: a.host, a })), { title: 'Widgets: pick an account' }))?.a;
    if (!account) { return; }
    const token = await api.getToken(account, ['repo'], { interactive: true });
    if (!token) { return; }
    let names: string[];
    try {
      names = repoChoices(await requestJson<unknown>('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', token));
    } catch (err) { void vscode.window.showErrorMessage(`Could not list repositories: ${(err as Error).message}`); return; }
    const chosen = new Set(settings().repos.filter(r => r.account === account.id).map(r => r.repo.toLowerCase()));
    const picked = await vscode.window.showQuickPick(names.map(label => ({ label, picked: chosen.has(label.toLowerCase()) })), {
      canPickMany: true, title: 'Widgets: repositories for Issues and Pull Requests',
      placeHolder: 'Private issue and pull request titles will appear on your desktop. Pick none for Projects only.',
    });
    if (!picked) { return; }
    const cfg = vscode.workspace.getConfiguration('null.widgets');
    await cfg.update('repos', mergeRepos(settings().repos, account.id, picked.map(p => p.label)), vscode.ConfigurationTarget.Global);
    await cfg.update('enabled', true, vscode.ConfigurationTarget.Global);
    if (startWidgets()) {
      void vscode.window.showInformationMessage('Widgets are set up and shown on your desktop. To start them at every login, tick "Desktop widgets" in Null: Setup.');
    } else {
      void vscode.window.showWarningMessage('Widgets are set up, but this Null IDE has no null_widgets.exe. Install or update Null IDE from a release build.');
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('null.widgets.setup', setup),
    vscode.commands.registerCommand('null.widgets.refresh', async () => {
      if (!supported) { notSupported(); return; }
      if (!settings().enabled) { void vscode.window.showInformationMessage('Run "Null: Set Up Widgets" first.'); return; }
      await refresher?.refresh();
    }),
    out,
  );
  if (!supported) { return; }

  let dir: string;
  try { dir = widgetsDir(); } catch (err) { log(`disabled: ${(err as Error).message}`); return; }
  const store = new SnapshotStore(dir);
  const ownership = new PresenceOwnership(dir, log, 'widgets-owner.json');
  const api = (): AccountsApi | undefined => accountsApi();

  const live = new WidgetRefresher({
    now: Date.now,
    settings,
    ownership,
    store,
    fetch: async (accountId, repos) => {
      const a = api(); const account = a?.getAccounts().find(x => x.id === accountId);
      return fetchRepos({
        token: async () => (a && account ? a.getToken(account, ['repo'], { interactive: false }) : undefined),
        graphql: <T>(q: string, v: Record<string, unknown>, token: string) => requestGraphql<T>(q, v, token),
        localPaths: () => cachedLocal,
      }, accountId, repos);
    },
    projects: async () => {
      const entries = readRecentProjects(getRecentProjectsFilePath());
      const dirs = entries.filter(e => !e.isWorkspaceFile).map(e => e.path);
      const statuses = new Map<string, GitStatus | null>();
      await computeGitStatuses(dirs.slice(0, 20), (p, s) => statuses.set(p, s));
      const remotes = new Map<string, string | null>();
      await computeGitStatuses<string>(dirs, (p, r) => remotes.set(p, r), 4, gitRemote);
      cachedLocal = localPathsFrom(remotes);
      return buildProjects(entries, statuses);
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: h => clearTimeout(h as NodeJS.Timeout),
    log,
  });
  refresher = live;
  let cachedLocal: ReadonlyMap<string, string> = new Map();

  live.start();
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(s => live.setFocused(s.focused)),
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('null.widgets')) { live.onConfigChanged(); } }),
    { dispose: () => live.dispose() },
  );
  if (vscode.window.state.focused) { live.setFocused(true); }
}
