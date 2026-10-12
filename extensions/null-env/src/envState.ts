import * as vscode from 'vscode';
import { check, requiredSignature, visibleRequired } from './check';
import { detectLanguages } from './detect';
import type { Finding, Language, Probes } from './types';

const SNOOZE_KEY = 'null-env.snoozedSignature';

/** The current findings for the open workspace folders, plus the per-workspace snooze of the status bar warning. */
export class EnvState {
  private findings: Finding[] = [];
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  constructor(private readonly probes: Probes, private readonly memento: vscode.Memento) {}

  get(): Finding[] {
    return this.findings;
  }

  /** Required findings to warn about right now (none while snoozed). */
  warnings(): Finding[] {
    return visibleRequired(this.findings, this.memento.get<string>(SNOOZE_KEY));
  }

  snooze(): Thenable<void> {
    return this.memento.update(SNOOZE_KEY, requiredSignature(this.findings)).then(() => this.emitter.fire());
  }

  refresh(): void {
    const languages = new Set<Language>();
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      for (const language of detectLanguages(folder.uri.fsPath)) {
        languages.add(language);
      }
    }
    const next = check([...languages], this.probes);
    if (JSON.stringify(next) !== JSON.stringify(this.findings)) {
      this.findings = next;
      this.emitter.fire();
    }
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
