'use strict';

import * as vscode from 'vscode';
import {
  DEFAULT_FILTER, DRAFT_OPTIONS, FacetId, PullFilter, SORT_OPTIONS, STATE_OPTIONS, facetRows,
} from './pullFilter';
import { describeFailure } from './pullModel';

export interface FilterChoices {
  labels(): Promise<string[]>;
  milestones(): Promise<string[]>;
}

type MenuItem = vscode.QuickPickItem & { id?: FacetId; action?: 'apply' | 'reset' };

async function pickOne<T extends string>(title: string, options: Array<{ value: T; label: string }>, current: T): Promise<T> {
  const picked = await vscode.window.showQuickPick(
    options.map(o => ({ label: o.label, description: o.value === current ? 'current' : '', value: o.value })), { title });
  return picked ? picked.value : current;
}

/** `null` clears the facet; the current value is kept when the list cannot be loaded or the pick is cancelled. */
async function pickName(title: string, load: () => Promise<string[]>, current: string | null): Promise<string | null> {
  let names: string[];
  try {
    names = await load();
  } catch (err) {
    void vscode.window.showErrorMessage(`Could not load the ${title.toLowerCase()} list: ${describeFailure(err)}`);
    return current;
  }
  const items = [{ label: 'Any', value: null as string | null }, ...names.map(n => ({ label: n, value: n as string | null }))];
  const picked = await vscode.window.showQuickPick(items, { title });
  return picked ? picked.value : current;
}

/** Walks the facets until Apply (resolves to the new filter) or Escape (resolves to undefined: nothing changes). */
export async function editFilter(start: PullFilter, choices: FilterChoices): Promise<PullFilter | undefined> {
  let f = start;
  for (;;) {
    const items: MenuItem[] = [
      { label: '$(check) Apply', action: 'apply' },
      ...facetRows(f).map(r => ({ label: r.label, description: r.description, id: r.id })),
      { label: '$(discard) Reset filters', action: 'reset' },
    ];
    const picked = await vscode.window.showQuickPick(items, { title: 'Filter pull requests' });
    if (!picked) return undefined;
    if (picked.action === 'apply') return f;
    if (picked.action === 'reset') { f = DEFAULT_FILTER; continue; }
    switch (picked.id) {
      case 'mine': f = { ...f, mine: !f.mine }; break;
      case 'reviewRequested': f = { ...f, reviewRequested: !f.reviewRequested }; break;
      case 'state': f = { ...f, state: await pickOne('State', STATE_OPTIONS, f.state) }; break;
      case 'draft': f = { ...f, draft: await pickOne('Drafts', DRAFT_OPTIONS, f.draft) }; break;
      case 'sort': f = { ...f, sort: await pickOne('Sort by', SORT_OPTIONS, f.sort) }; break;
      case 'label': f = { ...f, label: await pickName('Label', choices.labels, f.label) }; break;
      case 'milestone': f = { ...f, milestone: await pickName('Milestone', choices.milestones, f.milestone) }; break;
    }
  }
}
