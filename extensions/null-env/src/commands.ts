import * as vscode from 'vscode';
import { applyFix } from './fix';
import type { EnvState } from './envState';
import type { Finding } from './types';

type Item = vscode.QuickPickItem & { finding?: Finding; action?: 'installAll' | 'snooze' };

async function runCheck(state: EnvState): Promise<void> {
  state.refresh(); // PATH-independent dirs (cargo bin, LLVM) may have changed since the last check
  const findings = state.get();
  if (findings.length === 0) {
    void vscode.window.showInformationMessage('Null: nothing is missing for this workspace.');
    return;
  }

  const installable = findings.filter(f => f.fix.kind === 'install');
  const items: Item[] = [];
  if (installable.length > 1) {
    items.push({ label: '$(cloud-download) Install all missing extensions', action: 'installAll' });
  }
  for (const finding of findings) {
    const install = finding.fix.kind === 'install';
    items.push({
      label: `$(${install ? 'extensions' : 'link-external'}) ${finding.label}`,
      description: finding.severity,
      detail: finding.fix.kind === 'install' ? `Install ${finding.fix.extensionId}` : `Open ${finding.fix.url}`,
      finding,
    });
  }
  if (state.warnings().length > 0) {
    items.push({ label: '$(bell-slash) Hide this warning for this workspace', action: 'snooze' });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: 'Null: Check Environment',
    placeHolder: 'Pick an item to fix it',
  });
  if (!picked) {
    return;
  }
  if (picked.action === 'installAll') {
    for (const finding of installable) {
      await applyFix(finding);
    }
  } else if (picked.action === 'snooze') {
    await state.snooze();
  } else if (picked.finding) {
    await applyFix(picked.finding);
  }
}

export function registerCommands(context: vscode.ExtensionContext, state: EnvState): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('null.env.check', () => runCheck(state)),
    // Internal: lets the UI-side null-tools read findings across extension hosts (exports do not cross them).
    vscode.commands.registerCommand('null.env.getFindings', () => state.get()),
  );
}
