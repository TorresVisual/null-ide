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
