'use strict';

import * as vscode from 'vscode';
import { DEFAULT_FILTER, FilterRowId, RunFilter, filterRows } from './workflowsModel';

const APPLY = '$(check) Apply';
const RESET = '$(discard) Reset';

/** One menu: toggle a facet and it comes back; Apply returns the draft, Escape returns undefined (no change). */
export async function editFilter(
  current: RunFilter, workflowFiles: () => Array<{ file: string; name: string }>,
): Promise<RunFilter | undefined> {
  let draft = { ...current };
  for (;;) {
    const rows = filterRows(draft).map(r => ({ label: r.label, description: r.description, id: r.id as FilterRowId | 'apply' | 'reset' }));
    const picked = await vscode.window.showQuickPick(
      [...rows, { label: RESET, description: '', id: 'reset' as const }, { label: APPLY, description: '', id: 'apply' as const }],
      { title: 'Filter GitHub Actions runs', placeHolder: 'Pick a facet to change, then Apply' },
    );
    if (!picked) return undefined;
    switch (picked.id) {
      case 'apply': return draft;
      case 'reset': draft = { ...DEFAULT_FILTER }; break;
      case 'branch': draft = { ...draft, branch: !draft.branch }; break;
      case 'mine': draft = { ...draft, mine: !draft.mine }; break;
      case 'failed': draft = { ...draft, failed: !draft.failed }; break;
      case 'workflow': {
        const files = workflowFiles();
        const choice = await vscode.window.showQuickPick(
          [{ label: 'Any workflow', file: null as string | null, description: '' }, ...files.map(f => ({ label: f.name, file: f.file as string | null, description: f.file }))],
          { title: 'Show runs of one workflow' },
        );
        if (choice) draft = { ...draft, workflow: choice.file };
        break;
      }
    }
  }
}
