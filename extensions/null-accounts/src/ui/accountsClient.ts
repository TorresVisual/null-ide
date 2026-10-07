'use strict';

/** Runs inside the webview. Renders the `rows` the host sends; every string is set via textContent. */
export const CLIENT_SCRIPT = `
const vscode = acquireVsCodeApi();
const list = document.getElementById('list');
const empty = document.getElementById('empty');

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) { node.className = cls; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

function button(label, onClick, cls) {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
}

function render(rows) {
  list.replaceChildren();
  empty.classList.toggle('visible', rows.length === 0);
  for (const row of rows) {
    const card = el('div', 'card');
    const head = el('div', 'head');
    head.append(el('span', 'name', row.username), el('span', 'meta', row.provider + ' · ' + row.host + ' · ' + row.authMethod));
    const actions = el('div', 'actions');
    if (row.needsReauth) {
      actions.append(button('Re-authenticate', () => vscode.postMessage({ type: 'reauth', id: row.id }), 'primary'));
    }
    actions.append(
      button('Edit email', () => vscode.postMessage({ type: 'editEmail', id: row.id })),
      button('Remove', () => vscode.postMessage({ type: 'remove', id: row.id }), 'danger'),
    );
    const projects = el('div', 'projects');
    projects.append(el('h3', '', row.projects.length ? 'Projects using this account' : 'No projects use this account yet'));
    for (const p of row.projects) {
      const line = el('div', p.exists ? 'project' : 'project missing');
      line.title = p.path;
      line.append(
        el('span', 'pname', p.name),
        el('span', 'ppath', p.exists ? p.path : p.path + ' (not found)'),
        button('Unbind', () => vscode.postMessage({ type: 'unbind', key: p.key })),
      );
      projects.append(line);
    }
    const lines = [head, el('div', 'email', row.email)];
    if (row.needsReauth) { lines.push(el('div', 'warn', 'Sign-in expired. Re-authenticate to use this account again.')); }
    card.append(...lines, actions, projects);
    list.append(card);
  }
}

window.addEventListener('message', event => {
  if (event.data && event.data.type === 'state') { render(event.data.rows); }
});
document.getElementById('add-btn').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
vscode.postMessage({ type: 'ready' });
`;
