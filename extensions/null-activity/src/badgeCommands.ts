'use strict';

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ActivityService } from './activityService';
import { buildBadges } from './badgeModel';
import { BadgeAccount, BadgePublisher, PublishedState } from './badgePublisher';
import { renderBadge } from './badgeSvg';
import { fetchJson } from './gistHttp';

const STATE_KEY = 'null-activity.badge';
const REFRESH_MS = 60 * 60_000;
const FIRST_REFRESH_MS = 60_000;

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

export function registerBadges(context: vscode.ExtensionContext, service: ActivityService, log: (message: string) => void): void {
  const accountsApi = async () => vscode.extensions.getExtension<AccountsApi>('null.null-accounts')?.activate();

  const publisher = new BadgePublisher({
    source: service,
    accounts: async (): Promise<BadgeAccount[]> =>
      (await accountsApi())?.getAccounts().filter((a) => a.provider === 'github' && a.host === 'github.com' && a.authMethod !== 'ssh') ?? [],
    chooseAccount: async (accounts) =>
      (await vscode.window.showQuickPick(
        accounts.map((account) => ({ label: `@${account.username}`, account })),
        { placeHolder: 'Publish badges with which GitHub account?' },
      ))?.account,
    token: async (accountId, interactive) => {
      const api = await accountsApi();
      const account = api?.getAccounts().find((a) => a.id === accountId);
      return api && account ? api.getToken(account, ['gist'], { interactive }) : undefined;
    },
    http: fetchJson,
    state: {
      get: () => context.globalState.get<PublishedState>(STATE_KEY),
      set: (state) => void context.globalState.update(STATE_KEY, state),
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('null-activity.publishBadges', async () => {
      if (!context.globalState.get(STATE_KEY)) {
        const answer = await vscode.window.showWarningMessage(
          'Publish three badges to a secret GitHub Gist? It contains only your total coding time, daily average and top language. Anyone with the link can view it.',
          { modal: true },
          'Publish',
        );
        if (answer !== 'Publish') return;
      }
      const outcome = await publisher.publish({ interactive: true });
      if (!outcome.ok) {
        void vscode.window.showErrorMessage(`Null Activity: ${outcome.message}`);
        return;
      }
      await vscode.env.clipboard.writeText(outcome.markdown);
      void vscode.window.showInformationMessage('Null Activity: badges published. The Markdown for your README is on the clipboard.');
    }),

    vscode.commands.registerCommand('null-activity.saveBadges', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Save Badges Here',
      });
      if (!picked) return;
      try {
        for (const b of buildBadges(service)) fs.writeFileSync(path.join(picked[0].fsPath, b.file), renderBadge(b.label, b.value, b.color));
        void vscode.window.showInformationMessage(`Null Activity: saved 3 badges to ${picked[0].fsPath}.`);
      } catch (err) {
        void vscode.window.showErrorMessage(`Null Activity: could not save badges (${err instanceof Error ? err.message : String(err)}).`);
      }
    }),
  );

  const refresh = () => {
    if (!service.enabled || !vscode.workspace.getConfiguration('null-activity').get('badge.autoPublish')) return;
    void publisher.publish({ interactive: false }).then((outcome) =>
      log(outcome.ok ? (outcome.changed ? 'Badges refreshed.' : 'Badges unchanged.') : `Badge refresh skipped: ${outcome.message}`),
    );
  };
  const first = setTimeout(refresh, FIRST_REFRESH_MS);
  const timer = setInterval(refresh, REFRESH_MS);
  context.subscriptions.push({ dispose: () => { clearTimeout(first); clearInterval(timer); } });
}
