const { invoke } = window.__TAURI__.core;
const { getCurrentWindow } = window.__TAURI__.window;
const $ = (id) => document.getElementById(id);

let rows = [];               // what the last search returned, in the order shown
let selected = 0;
let everFocused = false;
let searchSeq = 0;
const live = new Map();      // path -> { branch, projectType, missing } once project_meta answered

const isMissing = (row) => !!(live.get(row.path) || {}).missing;
const current = (row) => ({ ...row, missing: isMissing(row) });

function chip(text, cls) {
  const el = document.createElement('span');
  el.className = 'chip' + (cls ? ' ' + cls : '');
  el.textContent = text;
  return el;
}

/** Fills a row element from the row plus whatever live facts have arrived. */
function fillRow(el, row) {
  const m = live.get(row.path);
  const branch = m && m.branch ? m.branch : row.storedBranch;
  const type = m && m.projectType ? m.projectType : row.storedType;
  el.classList.toggle('missing', isMissing(row));
  el.replaceChildren();
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = row.label;
  el.append(name);
  if (branch) el.append(chip('⎇ ' + branch));
  if (type) el.append(chip(type));
  if (isMissing(row)) el.append(chip('missing', 'missing'));
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const meta = document.createElement('span');
  meta.className = 'meta';
  const age = document.createElement('span');
  age.textContent = formatAge(Number(row.timestamp), Date.now());
  const path = document.createElement('span');
  path.className = 'path';
  path.title = row.path;
  path.textContent = row.path.length > 40 ? '…' + row.path.slice(-39) : row.path; // the tail is what tells two same-named folders apart
  meta.append(age, path);
  el.append(spacer, meta);
}

function render() {
  const list = $('list');
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = $('query').value.trim() ? 'No matching projects' : 'No recent projects';
    list.append(empty);
    return;
  }
  // Sections only describe a blank search; a ranked result list is shown flat so the best match stays on top.
  const groups = $('query').value.trim() ? [{ title: null, start: 0, rows }] : groupRows(rows);
  for (const g of groups) {
    if (g.title) {
      const h = document.createElement('div');
      h.className = 'group';
      h.textContent = g.title;
      list.append(h);
    }
    g.rows.forEach((row, i) => {
      const index = g.start + i;
      const el = document.createElement('div');
      el.className = 'row';
      el.dataset.index = String(index);
      el.setAttribute('role', 'option');
      el.addEventListener('click', () => { selected = index; highlight(); act({ type: 'open' }); });
      fillRow(el, row);
      list.append(el);
    });
  }
  highlight();
}

function rowElement(index) { return document.querySelector('.row[data-index="' + index + '"]'); }

function highlight() {
  for (const el of document.querySelectorAll('.row.selected')) el.classList.remove('selected');
  const el = rowElement(selected);
  if (el) { el.classList.add('selected'); el.scrollIntoView({ block: 'nearest' }); }
}

function loadMeta() {
  for (const row of rows) {
    invoke('project_meta', { path: row.path }).then((m) => {
      live.set(row.path, m);
      const index = rows.indexOf(row);
      const el = index < 0 ? null : rowElement(index);
      if (el) fillRow(el, row);
    }, () => {});
  }
}

async function refresh(keepSelection) {
  const seq = ++searchSeq;
  const result = await invoke('search', { query: $('query').value });
  if (seq !== searchSeq) return; // a newer keystroke already asked
  rows = result;
  selected = keepSelection ? Math.min(selected, Math.max(rows.length - 1, 0)) : 0;
  render();
  loadMeta();
}

function setStatus(message) { $('status').textContent = message || ''; }

async function act(action) {
  const row = rows[selected];
  setStatus('');
  try {
    if (action.type === 'move') { selected = moveSelection(selected, action.delta, rows.length); highlight(); }
    else if (action.type === 'close') await invoke('close_launcher');
    else if (action.type === 'open' && row && !isMissing(row)) await invoke('open_project', { path: row.path });
    else if (action.type === 'pin' && row) { await invoke('toggle_pin', { path: row.path }); await refresh(true); }
    else if (action.type === 'remove' && row) { await invoke('remove_project', { path: row.path }); await refresh(true); }
  } catch (e) {
    setStatus(String(e));
  }
}

document.addEventListener('keydown', (e) => {
  const action = keyAction({ key: e.key, ctrlKey: e.ctrlKey }, rows[selected] && current(rows[selected]));
  if (!action) return;
  if (action.preventDefault) e.preventDefault();
  act(action);
});

$('query').addEventListener('input', () => refresh(false));

getCurrentWindow().onFocusChanged(({ payload: focused }) => {
  if (focused) everFocused = true;
  else if (shouldCloseOnBlur(everFocused)) invoke('close_launcher');
});

$('query').focus();
refresh(false).then(() => invoke('ready'), () => invoke('ready'));
