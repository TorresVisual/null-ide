'use strict';

interface RecentProjectEntry {
  path: string;
  label: string;
  isWorkspaceFile: boolean;
  timestamp: number;
}

interface GitStatus {
  branch: string;
  dirty: boolean;
}

type OutboundMessage =
  | { type: 'projects'; projects: RecentProjectEntry[] }
  | { type: 'gitStatus'; path: string; status: GitStatus | null };

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function main(): void {
  const vscode = acquireVsCodeApi();
  const cardsEl = document.getElementById('cards')!;
  const cardByPath = new Map<string, HTMLElement>();

  function formatTimestamp(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function render(projects: RecentProjectEntry[]): void {
    cardsEl.innerHTML = '';
    cardByPath.clear();
    if (projects.length === 0) {
      const empty = document.createElement('div');
      empty.id = 'empty';
      empty.textContent = 'No recent projects yet.';
      cardsEl.appendChild(empty);
      return;
    }
    for (const project of projects) {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="label"></div>
        <div class="path"></div>
        <div class="meta"></div>
      `;
      card.querySelector('.label')!.textContent = project.label;
      card.querySelector('.path')!.textContent = project.path;
      const meta = card.querySelector('.meta')!;
      const timestamp = document.createElement('span');
      timestamp.className = 'timestamp';
      timestamp.textContent = formatTimestamp(project.timestamp);
      meta.appendChild(timestamp);
      card.addEventListener('click', () => vscode.postMessage({ type: 'openProject', path: project.path }));
      cardsEl.appendChild(card);
      cardByPath.set(project.path, card);
    }
  }

  function applyGitStatus(path: string, status: GitStatus | null): void {
    const card = cardByPath.get(path);
    if (!card || !status) return;
    const meta = card.querySelector('.meta')!;
    const branch = document.createElement('span');
    branch.className = 'branch';
    branch.textContent = status.branch;
    meta.appendChild(branch);
    if (status.dirty) {
      const dirty = document.createElement('span');
      dirty.className = 'dirty';
      dirty.textContent = '●';
      dirty.title = 'Uncommitted changes';
      meta.appendChild(dirty);
    }
  }

  window.addEventListener('message', (event: MessageEvent<OutboundMessage>) => {
    const msg = event.data;
    if (msg.type === 'projects') render(msg.projects);
    else if (msg.type === 'gitStatus') applyGitStatus(msg.path, msg.status);
  });

  document.getElementById('refresh')!.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  document.getElementById('open-folder')!.addEventListener('click', () => vscode.postMessage({ type: 'openFolder' }));
  document.getElementById('new-project')!.addEventListener('click', () => vscode.postMessage({ type: 'newProject' }));
  document.getElementById('clone-repo')!.addEventListener('click', () => vscode.postMessage({ type: 'cloneRepo' }));

  vscode.postMessage({ type: 'ready' });
})();
