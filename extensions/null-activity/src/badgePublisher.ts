'use strict';

import * as crypto from 'crypto';
import { Badge, BadgeSource, buildBadges } from './badgeModel';
import { renderBadge } from './badgeSvg';
import { HttpJson, gistRawUrl, publishGist } from './gistClient';

export interface BadgeAccount {
  id: string;
  username: string;
}

/** What is remembered between runs (globalState). `hash` is of the rendered SVGs, to skip no-op refreshes. */
export interface PublishedState {
  gistId: string;
  accountId: string;
  owner: string;
  hash: string;
}

export interface BadgePublisherDeps {
  source: BadgeSource;
  /** GitHub accounts on github.com that can have a token. */
  accounts(): Promise<BadgeAccount[]>;
  /** Only called when no remembered account applies and there is more than one. */
  chooseAccount(accounts: BadgeAccount[]): Promise<BadgeAccount | undefined>;
  /** `interactive: false` must never show UI. */
  token(accountId: string, interactive: boolean): Promise<string | undefined>;
  http: HttpJson;
  state: { get(): PublishedState | undefined; set(state: PublishedState): void };
}

export type PublishOutcome = { ok: true; changed: boolean; markdown: string } | { ok: false; message: string };

const fail = (message: string): PublishOutcome => ({ ok: false, message });

const markdownFor = (badges: Badge[], owner: string, id: string): string =>
  badges.map((b) => `![${b.label}](${gistRawUrl(owner, id, b.file)})`).join('\n');

export class BadgePublisher {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BadgePublisherDeps) {}

  /**
   * Interactive (a user command) may pick an account, sign in and always pushes. Non-interactive (the hourly
   * refresh) only updates an existing gist, silently, and skips when nothing changed. Calls run one at a time;
   * never rejects.
   */
  publish(opts: { interactive: boolean }): Promise<PublishOutcome> {
    const run = this.tail.then(() => this.run(opts.interactive));
    this.tail = run;
    return run;
  }

  private async run(interactive: boolean): Promise<PublishOutcome> {
    try {
      const { deps } = this;
      const badges = buildBadges(deps.source);
      const files = badges.map((b) => ({ name: b.file, content: renderBadge(b.label, b.value, b.color) }));
      const hash = crypto.createHash('sha1').update(files.map((f) => f.content).join('\n')).digest('hex');
      const accounts = await deps.accounts();
      const prior = deps.state.get();

      let account = accounts.find((a) => a.id === prior?.accountId);
      if (!account) {
        if (!interactive) return fail('Badges have not been published yet.');
        if (accounts.length === 0) return fail('Add a GitHub account (github.com) in Null Accounts first.');
        account = accounts.length === 1 ? accounts[0] : await deps.chooseAccount(accounts);
        if (!account) return fail('Cancelled.');
      }

      const existing = prior?.accountId === account.id ? prior : undefined;
      if (!interactive && existing?.hash === hash) {
        return { ok: true, changed: false, markdown: markdownFor(badges, existing.owner, existing.gistId) };
      }

      const token = await deps.token(account.id, interactive);
      if (!token) {
        return fail(interactive ? 'GitHub did not provide a token with the gist scope.' : 'No GitHub token is available without signing in.');
      }
      const result = await publishGist(deps.http, token, existing?.gistId, files);
      if (!result.ok) return result;
      deps.state.set({ gistId: result.id, accountId: account.id, owner: result.owner, hash });
      return { ok: true, changed: true, markdown: markdownFor(badges, result.owner, result.id) };
    } catch (err) {
      return fail(`Could not publish badges (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
}
