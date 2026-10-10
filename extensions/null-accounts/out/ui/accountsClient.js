'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLIENT_SCRIPT = void 0;
/** Runs inside the webview. Renders the `rows` the host sends; every string is set via textContent. */
exports.CLIENT_SCRIPT = `
const vscode = acquireVsCodeApi();
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const SVG = 'http://www.w3.org/2000/svg';

// One 16px stroke family (1.4px, round caps), authored here: the webview has no codicon font.
const ICONS = {
  plus: 'M8 3v10M3 8h10',
  edit: 'M2.5 13.5l.8-3.2L10.6 3l2.4 2.4-7.3 7.3zM9.2 4.4l2.4 2.4',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.5M9.2 7v3.5',
  folder: 'M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z',
  x: 'M4 4l8 8M12 4l-8 8',
  alert: 'M8 2.5l6 10.5H2zM8 6.5v3M8 11.2v.1',
  key: 'M10.5 3.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM8.4 8.1L2.5 14M4.5 12l1.5 1.5M6 10.5L7.2 11.7',
};

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', 'icon-svg');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) { node.className = cls; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

/** o: { label?, icon?, cls?, title?, fk?, onClick }. Icon-only buttons need a title (it becomes the accessible name). */
function button(o) {
  const b = el('button', o.cls);
  b.type = 'button';
  if (o.icon) { b.append(icon(o.icon)); }
  if (o.label) { b.append(el('span', '', o.label)); }
  if (o.title) { b.title = o.title; b.setAttribute('aria-label', o.title); }
  if (o.fk) { b.dataset.fk = o.fk; }
  b.addEventListener('click', o.onClick);
  return b;
}

const PROVIDERS = { github: 'GitHub', gitlab: 'GitLab' };
const AUTH = { oauth: 'OAuth', https: 'Access token', ssh: 'SSH key' };

function keySection(row) {
  const box = el('section', 'block key');
  const head = el('div', 'block-head');
  head.append(icon('key'), el('h3', '', 'SSH key'));
  box.append(head);
  const send = type => () => vscode.postMessage({ type, id: row.id });
  const fk = type => row.id + '|' + type;
  const k = row.key;
  const main = el('div', 'actions');
  const manage = el('div', 'actions');
  if (!k) {
    box.append(el('p', 'muted lead', 'No SSH key. Generate one to push and sign commits over SSH with this account.'));
  } else {
    const kv = el('div', 'kv');
    const path = el('div', 'mono', k.path);
    path.title = k.path;
    kv.append(path);
    if (!k.exists) {
      kv.append(el('div', 'tag warn', 'Key file not found'));
    }
    if (k.fingerprint) { kv.append(el('div', 'mono fp', k.fingerprint)); }
    box.append(kv);
    if (k.exists) {
      main.append(
        button({ label: 'Copy public key', fk: fk('copyPublicKey'), onClick: send('copyPublicKey') }),
        button({ label: row.authMethod === 'ssh' ? 'Copy & open ' + row.host : 'Upload to ' + row.host, fk: fk('uploadKey'), onClick: send('uploadKey') }),
        button({ label: 'Test', fk: fk('testKey'), onClick: send('testKey') }),
      );
      const sw = el('button', 'switch');
      sw.type = 'button';
      sw.setAttribute('role', 'switch');
      sw.setAttribute('aria-checked', String(k.signCommits));
      sw.dataset.fk = fk('setSigning');
      sw.title = 'Sign commits in projects that use this account';
      sw.append(el('span', 'track'), el('span', '', 'Sign commits'));
      sw.addEventListener('click', () => vscode.postMessage({ type: 'setSigning', id: row.id, on: !k.signCommits }));
      main.append(el('span', 'spacer'), sw);
    }
  }
  manage.append(
    button({ label: k ? 'Replace with a new key' : 'Generate key', cls: k ? 'ghost' : '', fk: fk('generateKey'), onClick: send('generateKey') }),
    button({ label: 'Use existing key…', cls: 'ghost', fk: fk('attachKey'), onClick: send('attachKey') }),
  );
  if (k && k.removable) {
    manage.append(button({ label: k.managed ? 'Delete key' : 'Stop using key', cls: 'ghost danger', fk: fk('removeKey'), onClick: send('removeKey') }));
  }
  if (main.childNodes.length) { box.append(main); }
  box.append(manage);
  return box;
}

function field(label, value, editTitle, type, row) {
  const wrap = el('div', 'field');
  const dd = el('dd');
  const v = el('span', 'value', value);
  v.title = value;
  dd.append(v, button({ icon: 'edit', cls: 'icon', title: editTitle, fk: row.id + '|' + type, onClick: () => vscode.postMessage({ type, id: row.id }) }));
  wrap.append(el('dt', '', label), dd);
  return wrap;
}

function projectsSection(row) {
  const box = el('section', 'block projects');
  const head = el('div', 'block-head');
  const h3 = el('h3', '', 'Projects');
  if (row.projects.length) { h3.append(' ', el('span', 'count', String(row.projects.length))); }
  head.append(h3);
  box.append(head);
  if (!row.projects.length) {
    box.append(el('p', 'muted', 'No projects use this account yet. Choose it from the status bar while a project is open.'));
  }
  for (const p of row.projects) {
    const line = el('div', p.exists ? 'project' : 'project missing');
    line.title = p.path;
    line.append(
      icon('folder'),
      el('span', 'pname', p.name),
      el('span', 'ppath', p.path),
    );
    if (!p.exists) { line.append(el('span', 'tag warn', 'Not found')); }
    line.append(button({ icon: 'x', cls: 'icon', title: 'Unbind ' + p.name, fk: 'unbind|' + p.key, onClick: () => vscode.postMessage({ type: 'unbind', key: p.key }) }));
    box.append(line);
  }
  return box;
}

/** The profile picture, or the username's initial when there is none (or it fails to load). */
function avatar(row) {
  const box = el('div', 'avatar', Array.from(row.username)[0] || '?');
  if (row.avatar) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = row.avatar;
    img.addEventListener('load', () => box.replaceChildren(img));
  }
  return box;
}

function accountCard(row) {
  const card = el('section', 'account');
  const label = 'name-' + row.id;
  card.setAttribute('aria-labelledby', label);

  const top = el('div', 'who-row');
  const who = el('div', 'who');
  const h2 = el('h2', '', row.username);
  h2.id = label;
  const where = el('div', 'where');
  where.append((PROVIDERS[row.provider] || row.provider) + ' · ' + row.host, el('span', 'tag', AUTH[row.authMethod] || row.authMethod));
  who.append(h2, where);
  top.append(
    avatar(row),
    who,
    button({ icon: 'trash', cls: 'icon danger', title: 'Remove ' + row.username, fk: row.id + '|remove', onClick: () => vscode.postMessage({ type: 'remove', id: row.id }) }),
  );
  card.append(top);

  if (row.needsReauth) {
    const notice = el('div', 'notice');
    notice.append(
      icon('alert'),
      el('p', '', 'Sign-in expired. Re-authenticate to use this account again.'),
      button({ label: 'Re-authenticate', cls: 'primary', fk: row.id + '|reauth', onClick: () => vscode.postMessage({ type: 'reauth', id: row.id }) }),
    );
    card.append(notice);
  }

  const identity = el('dl', 'identity');
  identity.append(
    field('Git name', row.gitName, 'Edit git name', 'editName', row),
    field('Email', row.email, 'Edit email', 'editEmail', row),
  );
  const foot = el('div', 'identity-foot');
  foot.append(button({ label: 'Set as global git identity', cls: 'ghost', title: 'Set as global git identity', fk: row.id + '|setGlobalIdentity', onClick: () => vscode.postMessage({ type: 'setGlobalIdentity', id: row.id }) }));
  const idBox = el('div', 'identity-box');
  idBox.append(identity, foot);
  card.append(idBox, keySection(row), projectsSection(row));
  return card;
}

function render(rows) {
  // The list is rebuilt on every state push; keep keyboard focus on the same control.
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fk : undefined;
  list.replaceChildren(...rows.map(accountCard));
  empty.hidden = rows.length !== 0;
  if (focused) {
    const again = Array.from(document.querySelectorAll('[data-fk]')).find(n => n.dataset.fk === focused);
    if (again) { again.focus(); }
  }
}

const add = document.getElementById('add-btn');
add.append(icon('plus'), el('span', '', 'Add account'));
add.addEventListener('click', () => vscode.postMessage({ type: 'add' }));
window.addEventListener('message', event => {
  if (event.data && event.data.type === 'state') { render(event.data.rows); }
});
vscode.postMessage({ type: 'ready' });
`;
//# sourceMappingURL=accountsClient.js.map