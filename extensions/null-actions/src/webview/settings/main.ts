'use strict';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };
declare const NullColorPicker: { toggle(anchor: HTMLElement, hex: string, onChange: (hex: string) => void): void };

const vscodeApi = acquireVsCodeApi(); // may be called only once per webview
let buttons: ButtonDto[] = [];
let suggestions: SuggestionDto[] = [];
let collapsedIds: Set<string> | null = null;
// Validation messages from the last failed Save, by button id then field. Cleared per field on its next input.
const validation = new Map<string, Record<string, string>>();

// Curated subset of codicon names -- not the full ~500-icon set, just ones plausibly
// useful on an action button. The Icon field stays a free-text input (any codicon
// name works); this only powers the dropdown suggestions via <datalist>.
const ICON_OPTIONS = ['play', 'debug-start', 'stop-circle', 'refresh', 'sync', 'tools', 'gear', 'terminal', 'terminal-cmd', 'git-branch', 'git-commit', 'git-merge', 'cloud-upload', 'cloud-download', 'package', 'beaker', 'bug', 'rocket', 'database', 'server', 'server-process', 'globe', 'link', 'link-external', 'file-code', 'file-binary', 'folder', 'save', 'save-all', 'trash', 'search', 'filter', 'list-unordered', 'checklist', 'zap', 'flame', 'gift', 'star-full', 'heart', 'warning', 'error', 'info', 'question', 'arrow-up', 'arrow-down', 'arrow-right', 'arrow-left', 'chevron-right', 'debug-rerun', 'debug-restart', 'clear-all', 'export', 'desktop-download', 'key', 'lock', 'unlock', 'shield', 'pulse', 'graph-line', 'dashboard', 'tag', 'milestone', 'history', 'comment', 'mail', 'bell', 'wrench', 'combine', 'split-horizontal', 'notebook', 'code', 'symbol-method', 'circuit-board', 'layers', 'publish', 'repo-push', 'repo-pull', 'versions'];
const ICON_OPTIONS_HTML = ICON_OPTIONS.map(name => `<option value="${escapeAttr(name)}">`).join('');

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function colorSwatchValue(color: string | undefined): string {
  return HEX_COLOR.test(color || '') ? color as string : '#ffffff';
}

function fieldRow(label: string, inputHtml: string, id: string, error?: string): string {
  const msg = error ? `<div class="field-error" data-error-for="${id}">${escapeHtml(error)}</div>` : '';
  return `<div class="row"><label for="${id}">${label}</label>${inputHtml}${msg}</div>`;
}

function invalidAttrs(error: string | undefined): string {
  return error ? ' class="invalid" aria-invalid="true"' : '';
}

function textInput(field: string, index: number, value: string | undefined, extra = ''): string {
  return `<input type="text" id="field-${field}-${index}" data-field="${field}" data-index="${index}" value="${escapeAttr(value || '')}"${extra}>`;
}

function selectInput(field: string, index: number, options: string[], current: string): string {
  const opts = options.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`).join('');
  return `<select id="field-${field}-${index}" data-field="${field}" data-index="${index}">${opts}</select>`;
}

function checkboxInput(field: string, index: number, checked: boolean): string {
  return `<input type="checkbox" id="field-${field}-${index}" data-field="${field}" data-index="${index}"${checked ? ' checked' : ''}>`;
}

function renderCard(btn: ButtonDto, index: number): HTMLElement {
  const collapsed = (collapsedIds as Set<string>).has(btn.id);
  const header =
    `<div class="card-header" data-action="toggle" data-index="${index}" tabindex="0" role="button" aria-expanded="${!collapsed}">` +
    '<span class="chevron">▼</span>' +
    `<span class="card-title">${escapeHtml(btn.label || '(untitled)')}</span>` +
    `<span class="card-summary">${escapeHtml(btn.command || '')}</span>` +
    '</div>';

  const div = document.createElement('div');
  div.className = collapsed ? 'card collapsed' : 'card';
  div.style.animationDelay = (index * 25) + 'ms';

  const isVscodeCommand = btn.type === 'vscode-command';
  const err = validation.get(btn.id) || {};
  if (Object.keys(err).length) { div.classList.add('has-error'); }
  const body =
    (err.id ? `<div class="card-error">${escapeHtml(err.id)}</div>` : '') +
    fieldRow('Label', textInput('label', index, btn.label, invalidAttrs(err.label)), `field-label-${index}`, err.label) +
    '<div class="field-section">Behavior</div>' +
    fieldRow('Command', textInput('command', index, btn.command, invalidAttrs(err.command)) + `<button data-action="browse" data-index="${index}">Browse a file...</button>`, `field-command-${index}`, err.command) +
    fieldRow('Type', selectInput('type', index, ['terminal', 'vscode-command'], btn.type), `field-type-${index}`) +
    `<div class="row args-row" data-index="${index}"${isVscodeCommand ? '' : ' hidden'}><label for="field-args-${index}">Args</label>${textInput('args', index, (btn.args || []).join(','), ' placeholder="arg1,arg2"')}</div>` +
    fieldRow('Cwd', textInput('cwd', index, btn.cwd, ' placeholder="${workspaceFolder}"'), `field-cwd-${index}`) +
    fieldRow('Problem matcher', textInput('problemMatcher', index, btn.problemMatcher, ' placeholder="$tsc"'), `field-problemMatcher-${index}`) +
    fieldRow('Save all', checkboxInput('saveAll', index, !!btn.saveAll), `field-saveAll-${index}`) +
    fieldRow('Focus', checkboxInput('focus', index, btn.focus !== false), `field-focus-${index}`) +
    fieldRow('If running', selectInput('onBusy', index, ['ask', 'restart', 'show', 'run'], btn.onBusy || 'ask'), `field-onBusy-${index}`) +
    '<div class="field-section">Appearance</div>' +
    fieldRow('Icon', textInput('icon', index, btn.icon, ` list="icon-list-${index}" placeholder="tools"`) + `<datalist id="icon-list-${index}">${ICON_OPTIONS_HTML}</datalist>`, `field-icon-${index}`) +
    fieldRow('Color', `<button type="button" class="color-swatch" data-action="swatch" data-index="${index}" title="Open color picker"></button>` + textInput('color', index, btn.color, ' placeholder="#ffcc00"'), `field-color-${index}`) +
    fieldRow('Background', selectInput('background', index, ['none', 'warning', 'error'], btn.background), `field-background-${index}`) +
    fieldRow('Tooltip', textInput('tooltip', index, btn.tooltip), `field-tooltip-${index}`) +
    fieldRow('Priority', `<input type="number" id="field-priority-${index}" data-field="priority" data-index="${index}" value="${btn.priority || 0}">`, `field-priority-${index}`) +
    '<div class="card-footer">' +
    `<button data-action="up" data-index="${index}">Up</button>` +
    `<button data-action="down" data-index="${index}">Down</button>` +
    `<button data-action="delete" data-index="${index}">Delete</button>` +
    '</div>';
  div.innerHTML = header + `<div class="card-body"><div class="card-body-clip"><div class="card-body-pad">${body}</div></div></div>`;
  // The CSP forbids style attributes in markup; CSSOM is allowed.
  (div.querySelector('.color-swatch') as HTMLElement).style.background = colorSwatchValue(btn.color);
  return div;
}

function render(): void {
  if (collapsedIds === null) { collapsedIds = new Set(buttons.map(b => b.id)); }
  const list = byId('buttons-list');
  list.innerHTML = '';
  buttons.forEach((btn, i) => list.appendChild(renderCard(btn, i)));
  byId('empty-state').classList.toggle('visible', buttons.length === 0);

  const sList = byId('suggestions-list');
  sList.innerHTML = '';
  visibleSuggestions(buttons, suggestions).forEach(s => {
    const row = document.createElement('div');
    row.className = 'suggestion';
    row.innerHTML = `<span class="suggestion-label">${escapeHtml(s.label)}</span><button data-action="add-suggestion" data-id="${escapeAttr(s.id)}">+ Add</button>`;
    sList.appendChild(row);
  });
  byId('suggestions-section').style.display = sList.childElementCount ? '' : 'none';
}

function fieldToButtons(index: number, field: string, value: string | boolean | number): void {
  const btn = buttons[index];
  if (field === 'args') {
    btn.args = value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : undefined;
    return;
  }
  (btn as unknown as Record<string, unknown>)[field] = value;
}

function showIgnored(errors: string[]): void {
  const el = byId('ignored-banner');
  el.hidden = errors.length === 0;
  el.innerHTML = errors.length
    ? `<strong>${errors.length === 1 ? '1 entry in settings was' : errors.length + ' entries in settings were'} ignored and will be removed when you save:</strong><ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
    : '';
}

function showStatus(text: string, kind: 'ok' | 'err', autoHideMs?: number): void {
  const el = byId('status');
  el.textContent = text;
  el.className = 'visible ' + kind;
  if (autoHideMs) { setTimeout(() => { el.className = ''; }, autoHideMs); }
}

function clearFieldError(id: string, field: string, input: HTMLElement): void {
  const err = validation.get(id);
  if (!err || !err[field]) { return; }
  delete err[field];
  input.classList.remove('invalid');
  input.removeAttribute('aria-invalid');
  document.querySelector(`[data-error-for="${input.id}"]`)?.remove();
}

// Re-sort on change (blur / Enter), not on every keystroke, so a card does not jump while typing "10".
document.addEventListener('change', e => {
  const t = e.target as HTMLElement;
  if (t.getAttribute('data-field') !== 'priority') { return; }
  const sorted = sortByPriority(buttons);
  if (sorted.some((b, i) => b !== buttons[i])) { buttons = sorted; render(); }
});

document.addEventListener('input', e => {
  const t = e.target as HTMLInputElement;
  const field = t.getAttribute('data-field');
  if (!field) { return; }
  const index = parseInt(t.getAttribute('data-index') as string, 10);
  let value: string | boolean | number = t.type === 'checkbox' ? t.checked : t.value;
  if (t.type === 'number') { value = parseFloat(t.value) || 0; }
  fieldToButtons(index, field, value);
  clearFieldError(buttons[index].id, field, t);
  if (field === 'color' && HEX_COLOR.test(String(value))) {
    const swatch = document.querySelector<HTMLElement>(`[data-action=swatch][data-index="${index}"]`);
    if (swatch) { swatch.style.background = String(value); }
  }
  if (field === 'type') {
    const argsRow = document.querySelector<HTMLElement>(`.args-row[data-index="${index}"]`);
    if (argsRow) { argsRow.hidden = value !== 'vscode-command'; }
  }
});

document.addEventListener('click', e => {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!t) { return; }
  const action = t.getAttribute('data-action');
  const index = parseInt(t.getAttribute('data-index') as string, 10);
  if (action === 'toggle') {
    const btn = buttons[index];
    const ids = collapsedIds as Set<string>;
    if (ids.has(btn.id)) { ids.delete(btn.id); } else { ids.add(btn.id); }
    render();
  }
  if (action === 'browse') { vscodeApi.postMessage({ type: 'browseFile', id: buttons[index].id }); }
  if (action === 'swatch') {
    const btn = buttons[index];
    NullColorPicker.toggle(t, btn.color || '#3fa9f5', hex => {
      btn.color = hex;
      t.style.background = hex;
      const textInputEl = document.querySelector<HTMLInputElement>(`input[data-field=color][data-index="${index}"]`);
      if (textInputEl) { textInputEl.value = hex; }
    });
  }
  if (action === 'delete') { buttons.splice(index, 1); render(); }
  if ((action === 'up' && index > 0) || (action === 'down' && index < buttons.length - 1)) {
    buttons = moveButton(buttons, index, action as 'up' | 'down');
    render();
    // The card moved; keep the focus on its same control.
    const moved = document.querySelector<HTMLElement>(`[data-action="${action}"][data-index="${action === 'up' ? index - 1 : index + 1}"]`);
    moved?.focus();
    moved?.scrollIntoView({ block: 'nearest' });
  }
  if (action === 'add-suggestion') {
    const id = t.getAttribute('data-id');
    const s = suggestions.find(x => x.id === id);
    if (s) { buttons = addSuggestion(buttons, s); render(); }
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') { return; }
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action=toggle]');
  if (!t) { return; }
  e.preventDefault();
  t.click();
});

byId('add-btn').addEventListener('click', () => {
  buttons = [...buttons, newButton(buttons)];
  render();
});

byId('load-npm-btn').addEventListener('click', () => {
  vscodeApi.postMessage({ type: 'loadNpmScripts' });
});

byId('save-btn').addEventListener('click', () => {
  const errors = validate(buttons);
  validation.clear();
  if (errors.length === 0) {
    render();
    vscodeApi.postMessage({ type: 'save', buttons });
    return;
  }
  errors.forEach(e => {
    const id = buttons[e.index].id;
    validation.set(id, { ...validation.get(id), [e.field]: e.message });
  });
  // Open the failing cards (the first one is scrolled to) so every message is visible.
  validation.forEach((_, id) => (collapsedIds as Set<string>).delete(id));
  render();
  document.querySelector('.card.has-error')?.scrollIntoView({ block: 'center' });
  showStatus(validation.size === 1 ? '1 button needs fixing' : validation.size + ' buttons need fixing', 'err');
});

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    buttons = sortByPriority(msg.buttons);
    suggestions = msg.suggestions;
    validation.clear();
    showIgnored(msg.errors);
    render();
  } else if (msg.type === 'saved') {
    showStatus('✓ Saved', 'ok', 1600);
  } else if (msg.type === 'error') {
    showStatus('Error: ' + msg.errors.join('; '), 'err');
  } else if (msg.type === 'fileSelected') {
    const btn = buttons.find(b => b.id === msg.id);
    if (!btn) { return; }
    btn.command = msg.path.indexOf(' ') >= 0 ? '"' + msg.path + '"' : msg.path;
    render();
  } else if (msg.type === 'npmScriptsLoaded') {
    if (msg.errors && msg.errors.length) {
      showStatus(msg.errors.join('; '), 'err');
    } else {
      const existingIds = new Set(buttons.map(b => b.id));
      msg.buttons.forEach(b => {
        if (!existingIds.has(b.id)) { buttons.push({ ...b, priority: nextPriority(buttons) }); existingIds.add(b.id); }
      });
      render();
    }
  }
});

vscodeApi.postMessage({ type: 'ready' });
