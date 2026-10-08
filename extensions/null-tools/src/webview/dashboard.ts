'use strict';

interface RecentProjectEntry { path: string; label: string; isWorkspaceFile: boolean; timestamp: number; pinned: boolean; }
interface GitStatus { branch: string; dirty: boolean; }
interface LauncherProject extends RecentProjectEntry { available: boolean; projectType?: string; account?: string; gitStatus: GitStatus | null; }
type OutboundMessage = { type: 'projects'; projects: LauncherProject[] } | { type: 'gitStatus'; path: string; status: GitStatus | null };
declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare function projectSections(projects: LauncherProject[], query: string, sort: 'lastOpened' | 'name' | 'location'): Array<{ title: string; projects: LauncherProject[] }>;
declare function relativeProjectTime(timestamp: number): string;

(function main(): void {
  const vscode = acquireVsCodeApi();
  const cards = document.getElementById('cards')!;
  const search = document.getElementById('search') as HTMLInputElement;
  const sort = document.getElementById('sort') as HTMLSelectElement;
  let projects: LauncherProject[] = [];

  function action(label: string, type: string, project: LauncherProject, extra: object = {}): HTMLButtonElement {
    const button = document.createElement('button'); button.className = 'secondary'; button.textContent = label;
    button.addEventListener('click', event => { event.stopPropagation(); vscode.postMessage({ type, path: project.path, ...extra }); }); return button;
  }
  function render(): void {
    cards.replaceChildren();
    const sections = projectSections(projects, search.value, sort.value as 'lastOpened' | 'name' | 'location');
    if (!sections.length) { const empty = document.createElement('div'); empty.id = 'empty'; empty.textContent = 'No matching recent projects.'; cards.appendChild(empty); return; }
    for (const section of sections) {
      const heading = document.createElement('div'); heading.className = 'section-title'; heading.textContent = section.title; cards.appendChild(heading);
      const grid = document.createElement('div'); grid.className = 'section-projects';
      for (const project of section.projects) {
        const card = document.createElement('div'); card.className = 'card'; card.tabIndex = 0;
        const label = document.createElement('div'); label.className = 'label'; label.textContent = project.label;
        const projectPath = document.createElement('div'); projectPath.className = 'path'; projectPath.textContent = project.path;
        const meta = document.createElement('div'); meta.className = 'meta'; meta.textContent = `${project.available ? '' : 'Missing · '}${relativeProjectTime(project.timestamp)}`;
        if (project.projectType) meta.textContent += ` · ${project.projectType}`;
        if (project.account) meta.textContent += ` · ${project.account}`;
        if (project.gitStatus) meta.textContent += ` · ${project.gitStatus.branch}${project.gitStatus.dirty ? ' ●' : ''}`;
        const actions = document.createElement('div'); actions.className = 'meta';
        if (project.available) { actions.append(action('Open New', 'openProject', project, { forceNewWindow: true }), action(project.pinned ? 'Unpin' : 'Pin', 'setPinned', project, { pinned: !project.pinned }), action('Reveal', 'revealProject', project), action('Copy', 'copyProjectPath', project)); }
        else actions.append(action('Locate', 'locateProject', project));
        actions.append(action('Remove', 'removeProject', project));
        const open = (): void => { if (project.available) vscode.postMessage({ type: 'openProject', path: project.path }); };
        card.append(label, projectPath, meta, actions); card.addEventListener('click', open);
        card.addEventListener('keydown', event => { if (event.key === 'Enter') open(); }); grid.appendChild(card);
      }
      cards.appendChild(grid);
    }
  }
  window.addEventListener('message', (event: MessageEvent<OutboundMessage>) => {
    const message = event.data;
    if (message.type === 'projects') { projects = message.projects.map(project => ({ ...project, gitStatus: null })); render(); }
    else { const project = projects.find(item => item.path === message.path); if (project) { project.gitStatus = message.status; render(); } }
  });
  search.addEventListener('input', render); sort.addEventListener('change', render);
  for (const id of ['refresh', 'open-folder', 'new-project', 'clone-repo']) document.getElementById(id)!.addEventListener('click', () => vscode.postMessage({ type: id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) }));
  vscode.postMessage({ type: 'ready' });
})();
