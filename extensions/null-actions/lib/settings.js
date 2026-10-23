'use strict';
/** Escapes text for element content. Null/undefined become "". */
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Escapes a value for a double-quoted attribute. Same set as escapeHtml; the name documents the call site. */
function escapeAttr(s) {
    return escapeHtml(s);
}
const vscodeApi = acquireVsCodeApi(); // may be called only once per webview
let buttons = [];
let suggestions = [];
let collapsedIds = null;
// Curated subset of codicon names -- not the full ~500-icon set, just ones plausibly
// useful on an action button. The Icon field stays a free-text input (any codicon
// name works); this only powers the dropdown suggestions via <datalist>.
const ICON_OPTIONS = ['play', 'debug-start', 'stop-circle', 'refresh', 'sync', 'tools', 'gear', 'terminal', 'terminal-cmd', 'git-branch', 'git-commit', 'git-merge', 'cloud-upload', 'cloud-download', 'package', 'beaker', 'bug', 'rocket', 'database', 'server', 'server-process', 'globe', 'link', 'link-external', 'file-code', 'file-binary', 'folder', 'save', 'save-all', 'trash', 'search', 'filter', 'list-unordered', 'checklist', 'zap', 'flame', 'gift', 'star-full', 'heart', 'warning', 'error', 'info', 'question', 'arrow-up', 'arrow-down', 'arrow-right', 'arrow-left', 'chevron-right', 'debug-rerun', 'debug-restart', 'clear-all', 'export', 'desktop-download', 'key', 'lock', 'unlock', 'shield', 'pulse', 'graph-line', 'dashboard', 'tag', 'milestone', 'history', 'comment', 'mail', 'bell', 'wrench', 'combine', 'split-horizontal', 'notebook', 'code', 'symbol-method', 'circuit-board', 'layers', 'publish', 'repo-push', 'repo-pull', 'versions'];
const ICON_OPTIONS_HTML = ICON_OPTIONS.map(name => `<option value="${escapeAttr(name)}">`).join('');
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
function byId(id) {
    return document.getElementById(id);
}
function colorSwatchValue(color) {
    return HEX_COLOR.test(color || '') ? color : '#ffffff';
}
function fieldRow(label, inputHtml, id) {
    return `<div class="row"><label for="${id}">${label}</label>${inputHtml}</div>`;
}
function textInput(field, index, value, extra = '') {
    return `<input type="text" id="field-${field}-${index}" data-field="${field}" data-index="${index}" value="${escapeAttr(value || '')}"${extra}>`;
}
function selectInput(field, index, options, current) {
    const opts = options.map(o => `<option value="${o}"${o === current ? ' selected' : ''}>${o}</option>`).join('');
    return `<select id="field-${field}-${index}" data-field="${field}" data-index="${index}">${opts}</select>`;
}
function checkboxInput(field, index, checked) {
    return `<input type="checkbox" id="field-${field}-${index}" data-field="${field}" data-index="${index}"${checked ? ' checked' : ''}>`;
}
function renderCard(btn, index) {
    const collapsed = collapsedIds.has(btn.id);
    const header = `<div class="card-header" data-action="toggle" data-index="${index}" tabindex="0" role="button" aria-expanded="${!collapsed}">` +
        '<span class="chevron">▼</span>' +
        `<span class="card-title">${escapeHtml(btn.label || '(untitled)')}</span>` +
        `<span class="card-summary">${escapeHtml(btn.command || '')}</span>` +
        '</div>';
    const div = document.createElement('div');
    div.className = collapsed ? 'card collapsed' : 'card';
    div.style.animationDelay = (index * 25) + 'ms';
    const isVscodeCommand = btn.type === 'vscode-command';
    const body = fieldRow('Label', textInput('label', index, btn.label), `field-label-${index}`) +
        '<div class="field-section">Behavior</div>' +
        fieldRow('Command', textInput('command', index, btn.command) + `<button data-action="browse" data-index="${index}">Browse a file...</button>`, `field-command-${index}`) +
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
    div.querySelector('.color-swatch').style.background = colorSwatchValue(btn.color);
    return div;
}
function render() {
    if (collapsedIds === null) {
        collapsedIds = new Set(buttons.map(b => b.id));
    }
    const list = byId('buttons-list');
    list.innerHTML = '';
    buttons.forEach((btn, i) => list.appendChild(renderCard(btn, i)));
    byId('empty-state').classList.toggle('visible', buttons.length === 0);
    const sList = byId('suggestions-list');
    sList.innerHTML = '';
    suggestions.forEach(s => {
        const row = document.createElement('div');
        row.className = 'suggestion';
        row.innerHTML = `<span class="suggestion-label">${escapeHtml(s.label)}</span><button data-action="add-suggestion" data-id="${escapeAttr(s.id)}">+ Add</button>`;
        sList.appendChild(row);
    });
    byId('suggestions-section').style.display = suggestions.length ? '' : 'none';
}
function fieldToButtons(index, field, value) {
    const btn = buttons[index];
    if (field === 'args') {
        btn.args = value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : undefined;
        return;
    }
    btn[field] = value;
}
function showStatus(text, kind, autoHideMs) {
    const el = byId('status');
    el.textContent = text;
    el.className = 'visible ' + kind;
    if (autoHideMs) {
        setTimeout(() => { el.className = ''; }, autoHideMs);
    }
}
document.addEventListener('input', e => {
    const t = e.target;
    const field = t.getAttribute('data-field');
    if (!field) {
        return;
    }
    const index = parseInt(t.getAttribute('data-index'), 10);
    let value = t.type === 'checkbox' ? t.checked : t.value;
    if (t.type === 'number') {
        value = parseFloat(t.value) || 0;
    }
    fieldToButtons(index, field, value);
    if (field === 'color' && HEX_COLOR.test(String(value))) {
        const swatch = document.querySelector(`[data-action=swatch][data-index="${index}"]`);
        if (swatch) {
            swatch.style.background = String(value);
        }
    }
    if (field === 'type') {
        const argsRow = document.querySelector(`.args-row[data-index="${index}"]`);
        if (argsRow) {
            argsRow.hidden = value !== 'vscode-command';
        }
    }
});
document.addEventListener('click', e => {
    const t = e.target.closest('[data-action]');
    if (!t) {
        return;
    }
    const action = t.getAttribute('data-action');
    const index = parseInt(t.getAttribute('data-index'), 10);
    if (action === 'toggle') {
        const btn = buttons[index];
        const ids = collapsedIds;
        if (ids.has(btn.id)) {
            ids.delete(btn.id);
        }
        else {
            ids.add(btn.id);
        }
        render();
    }
    if (action === 'browse') {
        vscodeApi.postMessage({ type: 'browseFile', id: buttons[index].id });
    }
    if (action === 'swatch') {
        const btn = buttons[index];
        NullColorPicker.toggle(t, btn.color || '#3fa9f5', hex => {
            btn.color = hex;
            t.style.background = hex;
            const textInputEl = document.querySelector(`input[data-field=color][data-index="${index}"]`);
            if (textInputEl) {
                textInputEl.value = hex;
            }
        });
    }
    if (action === 'delete') {
        buttons.splice(index, 1);
        render();
    }
    if (action === 'up' && index > 0) {
        [buttons[index - 1], buttons[index]] = [buttons[index], buttons[index - 1]];
        render();
    }
    if (action === 'down' && index < buttons.length - 1) {
        [buttons[index + 1], buttons[index]] = [buttons[index], buttons[index + 1]];
        render();
    }
    if (action === 'add-suggestion') {
        const id = t.getAttribute('data-id');
        const s = suggestions.find(x => x.id === id);
        if (s) {
            buttons.push({ id: s.id, label: s.label, command: s.command, icon: s.icon, problemMatcher: s.problemMatcher, type: 'terminal', background: 'none', priority: 0, saveAll: false, focus: true });
            render();
        }
    }
});
document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') {
        return;
    }
    const t = e.target.closest('[data-action=toggle]');
    if (!t) {
        return;
    }
    e.preventDefault();
    t.click();
});
byId('add-btn').addEventListener('click', () => {
    buttons.push({ id: 'button-' + Date.now(), label: 'New Button', command: '', type: 'terminal', background: 'none', priority: 0, saveAll: false, focus: true });
    render();
});
byId('load-npm-btn').addEventListener('click', () => {
    vscodeApi.postMessage({ type: 'loadNpmScripts' });
});
byId('save-btn').addEventListener('click', () => {
    vscodeApi.postMessage({ type: 'save', buttons });
});
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'init') {
        buttons = msg.buttons;
        suggestions = msg.suggestions;
        render();
    }
    else if (msg.type === 'saved') {
        showStatus('✓ Saved', 'ok', 1600);
    }
    else if (msg.type === 'error') {
        showStatus('Error: ' + msg.errors.join('; '), 'err');
    }
    else if (msg.type === 'fileSelected') {
        const btn = buttons.find(b => b.id === msg.id);
        if (!btn) {
            return;
        }
        btn.command = msg.path.indexOf(' ') >= 0 ? '"' + msg.path + '"' : msg.path;
        render();
    }
    else if (msg.type === 'npmScriptsLoaded') {
        if (msg.errors && msg.errors.length) {
            showStatus(msg.errors.join('; '), 'err');
        }
        else {
            const existingIds = new Set(buttons.map(b => b.id));
            msg.buttons.forEach(b => {
                if (!existingIds.has(b.id)) {
                    buttons.push(b);
                    existingIds.add(b.id);
                }
            });
            render();
        }
    }
});
vscodeApi.postMessage({ type: 'ready' });
