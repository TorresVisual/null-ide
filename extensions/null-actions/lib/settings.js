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
/** Display order: priority descending (the status bar order), ties keep list order. */
function sortByPriority(buttons) {
    return buttons.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
}
/** Priority that places a new button after every existing one. Stays at or below 0: the gear item sits at 1. */
function nextPriority(buttons) {
    return buttons.length === 0 ? 0 : Math.min(0, ...buttons.map(b => b.priority || 0)) - 1;
}
/**
 * Moves the button at `index` of the sorted list one place by swapping priorities with its neighbour.
 * Any tie in the list is first broken by renumbering downward from 0, so the move always changes the order.
 */
function moveButton(buttons, index, direction) {
    let list = sortByPriority(buttons);
    const j = direction === 'up' ? index - 1 : index + 1;
    if (index < 0 || index >= list.length || j < 0 || j >= list.length) {
        return list;
    }
    if (new Set(list.map(b => b.priority || 0)).size < list.length) {
        list = list.map((b, i) => (Object.assign(Object.assign({}, b), { priority: -i })));
    }
    const a = list[index];
    const b = list[j];
    list[index] = Object.assign(Object.assign({}, b), { priority: a.priority || 0 });
    list[j] = Object.assign(Object.assign({}, a), { priority: b.priority || 0 });
    return list;
}
function visibleSuggestions(buttons, suggestions) {
    const ids = new Set(buttons.map(b => b.id));
    return suggestions.filter(s => !ids.has(s.id));
}
function addSuggestion(buttons, s) {
    if (buttons.some(b => b.id === s.id)) {
        return buttons;
    }
    return [...buttons, {
            id: s.id, label: s.label, command: s.command, icon: s.icon, problemMatcher: s.problemMatcher,
            type: 'terminal', background: 'none', priority: nextPriority(buttons), saveAll: false, focus: true,
        }];
}
/** A blank button whose id is unique in `buttons`. `now` is injectable for tests. */
function newButton(buttons, now = Date.now()) {
    const ids = new Set(buttons.map(b => b.id));
    while (ids.has('button-' + now)) {
        now++;
    }
    return {
        id: 'button-' + now, label: 'New Button', command: '',
        type: 'terminal', background: 'none', priority: nextPriority(buttons), saveAll: false, focus: true,
    };
}
/** Mirrors what the host's parseButtonConfigs rejects (it trims), so Save fails here first, next to the field. */
function validate(buttons) {
    const errors = [];
    const seen = new Set();
    buttons.forEach((b, index) => {
        if (seen.has(b.id)) {
            errors.push({ index, field: 'id', message: `Duplicate id "${b.id}"` });
        }
        seen.add(b.id);
        if (!(b.label || '').trim()) {
            errors.push({ index, field: 'label', message: 'Label is required' });
        }
        if (!(b.command || '').trim()) {
            errors.push({ index, field: 'command', message: 'Command is required' });
        }
    });
    return errors;
}
/** Canonical form: the defaults the host's parseButtonConfigs applies, so representation differences are not edits. */
function normalize(buttons) {
    const opt = (v) => (v ? v : undefined);
    return buttons.map(b => ({
        id: b.id,
        label: b.label,
        icon: opt(b.icon),
        type: b.type === 'vscode-command' ? b.type : 'terminal',
        command: b.command,
        args: Array.isArray(b.args) && b.args.length ? b.args : undefined,
        color: opt(b.color),
        background: b.background === 'warning' || b.background === 'error' ? b.background : 'none',
        tooltip: opt(b.tooltip),
        cwd: opt(b.cwd),
        saveAll: b.saveAll === true,
        focus: b.focus !== false,
        onBusy: b.onBusy === 'restart' || b.onBusy === 'show' || b.onBusy === 'run' ? b.onBusy : 'ask',
        problemMatcher: (b.problemMatcher || '').trim() || undefined,
        priority: typeof b.priority === 'number' ? b.priority : 0,
    }));
}
/** List order counts: callers pass both lists in display (priority) order. */
function isDirty(draft, saved) {
    return JSON.stringify(normalize(draft)) !== JSON.stringify(normalize(saved));
}
const vscodeApi = acquireVsCodeApi(); // may be called only once per webview
let buttons = [];
let suggestions = [];
let collapsedIds = null;
// Validation messages from the last failed Save, by button id then field. Cleared per field on its next input.
const validation = new Map();
let snapshot = []; // last loaded or saved state, in display order
let loaded = false;
let awaitingSave = null; // what the last Save sent, until the host confirms
let pendingExternal = null;
let lastDeleted = null;
let lastDirty = false;
function clone(x) {
    return JSON.parse(JSON.stringify(x));
}
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
function fieldRow(label, inputHtml, id, error) {
    const msg = error ? `<div class="field-error" data-error-for="${id}">${escapeHtml(error)}</div>` : '';
    return `<div class="row"><label for="${id}">${label}</label>${inputHtml}${msg}</div>`;
}
function invalidAttrs(error) {
    return error ? ' class="invalid" aria-invalid="true"' : '';
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
    const err = validation.get(btn.id) || {};
    if (Object.keys(err).length) {
        div.classList.add('has-error');
    }
    const body = (err.id ? `<div class="card-error">${escapeHtml(err.id)}</div>` : '') +
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
    renderSuggestions();
    updateDirty();
}
function renderSuggestions() {
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
/** Compares the draft with the saved snapshot; tells the host (panel title) and marks Save when it changes. */
function updateDirty() {
    const dirty = isDirty(buttons, snapshot);
    byId('save-btn').textContent = dirty ? 'Save All \u25CF' : 'Save All';
    if (dirty !== lastDirty) {
        lastDirty = dirty;
        vscodeApi.postMessage({ type: 'dirty', dirty });
    }
}
function showUndo(label) {
    const el = byId('undo');
    el.hidden = false;
    el.innerHTML = `Deleted ${escapeHtml(label || '(untitled)')} \u2014 <button data-action="undo">Undo</button>`;
}
function clearUndo() {
    lastDeleted = null;
    byId('undo').hidden = true;
}
/** Replaces the draft and snapshot with a state from the host. */
function applyIncoming(msg) {
    buttons = sortByPriority(msg.buttons);
    snapshot = clone(buttons);
    suggestions = msg.suggestions;
    loaded = true;
    awaitingSave = null;
    pendingExternal = null;
    byId('external-banner').hidden = true;
    validation.clear();
    clearUndo();
    showIgnored(msg.errors);
    render();
}
function fieldToButtons(index, field, value) {
    const btn = buttons[index];
    if (field === 'args') {
        btn.args = value ? String(value).split(',').map(s => s.trim()).filter(Boolean) : undefined;
        return;
    }
    btn[field] = value;
}
function showIgnored(errors) {
    const el = byId('ignored-banner');
    el.hidden = errors.length === 0;
    el.innerHTML = errors.length
        ? `<strong>${errors.length === 1 ? '1 entry in settings was' : errors.length + ' entries in settings were'} ignored and will be removed when you save:</strong><ul>${errors.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`
        : '';
}
function showStatus(text, kind, autoHideMs) {
    const el = byId('status');
    el.textContent = text;
    el.className = 'visible ' + kind;
    if (autoHideMs) {
        setTimeout(() => { el.className = ''; }, autoHideMs);
    }
}
function clearFieldError(id, field, input) {
    var _a;
    const err = validation.get(id);
    if (!err || !err[field]) {
        return;
    }
    delete err[field];
    input.classList.remove('invalid');
    input.removeAttribute('aria-invalid');
    (_a = document.querySelector(`[data-error-for="${input.id}"]`)) === null || _a === void 0 ? void 0 : _a.remove();
}
// Re-sort on change (blur / Enter), not on every keystroke, so a card does not jump while typing "10".
document.addEventListener('change', e => {
    const t = e.target;
    if (t.getAttribute('data-field') !== 'priority') {
        return;
    }
    const sorted = sortByPriority(buttons);
    if (sorted.some((b, i) => b !== buttons[i])) {
        buttons = sorted;
        render();
    }
});
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
    clearFieldError(buttons[index].id, field, t);
    updateDirty();
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
            updateDirty();
            t.style.background = hex;
            const textInputEl = document.querySelector(`input[data-field=color][data-index="${index}"]`);
            if (textInputEl) {
                textInputEl.value = hex;
            }
        });
    }
    if (action === 'delete') {
        const [removed] = buttons.splice(index, 1);
        lastDeleted = { button: removed, index };
        validation.delete(removed.id);
        showUndo(removed.label);
        render();
    }
    if (action === 'undo' && lastDeleted) {
        const { button, index: at } = lastDeleted;
        if (!buttons.some(b => b.id === button.id)) {
            buttons.splice(at, 0, button);
        }
        clearUndo();
        render();
    }
    if (action === 'reload' && pendingExternal) {
        applyIncoming(pendingExternal);
    }
    if (action === 'keep' && pendingExternal) {
        // Keep the draft; what is on disk now is the new baseline, so the dirty marker shows the difference.
        snapshot = clone(sortByPriority(pendingExternal.buttons));
        suggestions = pendingExternal.suggestions;
        showIgnored(pendingExternal.errors);
        pendingExternal = null;
        byId('external-banner').hidden = true;
        render();
    }
    if ((action === 'up' && index > 0) || (action === 'down' && index < buttons.length - 1)) {
        buttons = moveButton(buttons, index, action);
        render();
        // The card moved; keep the focus on its same control.
        const moved = document.querySelector(`[data-action="${action}"][data-index="${action === 'up' ? index - 1 : index + 1}"]`);
        moved === null || moved === void 0 ? void 0 : moved.focus();
        moved === null || moved === void 0 ? void 0 : moved.scrollIntoView({ block: 'nearest' });
    }
    if (action === 'add-suggestion') {
        const id = t.getAttribute('data-id');
        const s = suggestions.find(x => x.id === id);
        if (s) {
            buttons = addSuggestion(buttons, s);
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
    buttons = [...buttons, newButton(buttons)];
    render();
});
byId('load-npm-btn').addEventListener('click', () => {
    vscodeApi.postMessage({ type: 'loadNpmScripts' });
});
byId('save-btn').addEventListener('click', () => {
    var _a;
    const errors = validate(buttons);
    validation.clear();
    if (errors.length === 0) {
        render();
        awaitingSave = clone(sortByPriority(buttons));
        vscodeApi.postMessage({ type: 'save', buttons });
        return;
    }
    errors.forEach(e => {
        const id = buttons[e.index].id;
        validation.set(id, Object.assign(Object.assign({}, validation.get(id)), { [e.field]: e.message }));
    });
    // Open the failing cards (the first one is scrolled to) so every message is visible.
    validation.forEach((_, id) => collapsedIds.delete(id));
    render();
    (_a = document.querySelector('.card.has-error')) === null || _a === void 0 ? void 0 : _a.scrollIntoView({ block: 'center' });
    showStatus(validation.size === 1 ? '1 button needs fixing' : validation.size + ' buttons need fixing', 'err');
});
window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'init') {
        const incoming = sortByPriority(msg.buttons);
        if (!loaded) {
            applyIncoming(msg);
        }
        else if (awaitingSave && !isDirty(incoming, awaitingSave)) {
            // The echo of our own save, which can arrive before the 'saved' reply.
            snapshot = clone(incoming);
            updateDirty();
        }
        else if (!isDirty(incoming, snapshot)) {
            // Nothing about the buttons changed (an unrelated null-actions setting, or our own save).
            suggestions = msg.suggestions;
            showIgnored(msg.errors);
            renderSuggestions();
        }
        else if (!isDirty(buttons, snapshot)) {
            applyIncoming(msg);
        }
        else {
            pendingExternal = msg;
            byId('external-banner').hidden = false;
        }
    }
    else if (msg.type === 'saved') {
        snapshot = clone(sortByPriority(msg.buttons));
        awaitingSave = null;
        pendingExternal = null;
        byId('external-banner').hidden = true;
        clearUndo();
        updateDirty();
        showStatus('✓ Saved', 'ok', 1600);
    }
    else if (msg.type === 'error') {
        awaitingSave = null;
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
                    buttons.push(Object.assign(Object.assign({}, b), { priority: nextPriority(buttons) }));
                    existingIds.add(b.id);
                }
            });
            render();
        }
    }
});
vscodeApi.postMessage({ type: 'ready' });
