'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_SCRIPT = void 0;
/** Runs inside the webview. Renders the `rows` the host sends; every string is set via textContent. */
exports.CLIENT_SCRIPT = `
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

function keySection(row) {
  const box = el('div', 'key');
  box.append(el('h3', '', 'SSH key'));
  const send = type => () => vscode.postMessage({ type, id: row.id });
  const actions = el('div', 'actions');
  const k = row.key;
  if (!k) {
    box.append(el('div', 'kfp', 'No SSH key. Generate one to push and sign commits over SSH with this account.'));
  } else {
    box.append(el('div', 'kpath', k.exists ? k.path : k.path + ' (not found)'));
    if (k.fingerprint) { box.append(el('div', 'kfp', k.fingerprint)); }
    if (k.signCommits) { box.append(el('div', 'kfp', 'Commits are signed with this key.')); }
    if (k.exists) {
      actions.append(
        button('Copy public key', send('copyPublicKey')),
        button(row.authMethod === 'ssh' ? 'Copy & open ' + row.host : 'Upload to ' + row.host, send('uploadKey')),
        button('Test', send('testKey')),
        button(k.signCommits ? 'Stop signing commits' : 'Sign commits', () => vscode.postMessage({ type: 'setSigning', id: row.id, on: !k.signCommits })),
      );
    }
  }
  actions.append(button(k ? 'Replace with a new key' : 'Generate key', send('generateKey')), button('Use existing key…', send('attachKey')));
  if (k && k.removable) { actions.append(button(k.managed ? 'Delete key' : 'Stop using key', send('removeKey'), 'danger')); }
  box.append(actions);
  return box;
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
      button('Set as global git identity', () => vscode.postMessage({ type: 'setGlobalIdentity', id: row.id })),
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
    card.append(...lines, actions, keySection(row), projects);
    list.append(card);
  }
}

window.addEventListener('message', event => {
  if (event.data && event.data.type === 'state') { render(event.data.rows); }
});
document.getElementById('add-btn').addEventListener('click', () => vscode.postMessage({ type: 'add' }));
vscode.postMessage({ type: 'ready' });
`;
//# sourceMappingURL=accountsClient.js.map