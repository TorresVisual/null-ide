'use strict';

// Global-scope types shared by the settings webview bundle and the host
// (settingsPanel.ts pulls this file in with a triple-slash reference).
// Names are distinct from the host's module-scoped ones in buttonConfig.ts.

interface ButtonDto {
  id: string;
  label: string;
  icon?: string;
  type: 'terminal' | 'vscode-command';
  command: string;
  args?: unknown[];
  color?: string;
  background: 'none' | 'warning' | 'error';
  tooltip?: string;
  cwd?: string;
  saveAll: boolean;
  focus: boolean;
  onBusy?: 'ask' | 'restart' | 'show' | 'run';
  problemMatcher?: string;
  priority: number;
}

interface SuggestionDto {
  id: string;
  label: string;
  command: string;
  icon?: string;
  problemMatcher?: string;
}

type HostToWebview =
  | { type: 'init'; buttons: ButtonDto[]; suggestions: SuggestionDto[]; errors: string[] }
  | { type: 'saved' }
  | { type: 'error'; errors: string[] }
  | { type: 'fileSelected'; id: string; path: string }
  | { type: 'npmScriptsLoaded'; buttons: ButtonDto[]; errors: string[] };

type WebviewToHost =
  | { type: 'ready' }
  | { type: 'save'; buttons: ButtonDto[] }
  | { type: 'browseFile'; id: string }
  | { type: 'loadNpmScripts' };
