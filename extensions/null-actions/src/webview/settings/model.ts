'use strict';

interface ValidationError {
  index: number;
  field: 'label' | 'command' | 'id';
  message: string;
}

/** Display order: priority descending (the status bar order), ties keep list order. */
function sortByPriority(buttons: ButtonDto[]): ButtonDto[] {
  return buttons.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/** Priority that places a new button after every existing one. Stays at or below 0: the gear item sits at 1. */
function nextPriority(buttons: ButtonDto[]): number {
  return buttons.length === 0 ? 0 : Math.min(0, ...buttons.map(b => b.priority || 0)) - 1;
}

/**
 * Moves the button at `index` of the sorted list one place by swapping priorities with its neighbour.
 * Any tie in the list is first broken by renumbering downward from 0, so the move always changes the order.
 */
function moveButton(buttons: ButtonDto[], index: number, direction: 'up' | 'down'): ButtonDto[] {
  let list = sortByPriority(buttons);
  const j = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= list.length || j < 0 || j >= list.length) { return list; }
  if (new Set(list.map(b => b.priority || 0)).size < list.length) {
    list = list.map((b, i) => ({ ...b, priority: -i }));
  }
  const a = list[index];
  const b = list[j];
  list[index] = { ...b, priority: a.priority || 0 };
  list[j] = { ...a, priority: b.priority || 0 };
  return list;
}

function visibleSuggestions(buttons: ButtonDto[], suggestions: SuggestionDto[]): SuggestionDto[] {
  const ids = new Set(buttons.map(b => b.id));
  return suggestions.filter(s => !ids.has(s.id));
}

function addSuggestion(buttons: ButtonDto[], s: SuggestionDto): ButtonDto[] {
  if (buttons.some(b => b.id === s.id)) { return buttons; }
  return [...buttons, {
    id: s.id, label: s.label, command: s.command, icon: s.icon, problemMatcher: s.problemMatcher,
    type: 'terminal', background: 'none', priority: nextPriority(buttons), saveAll: false, focus: true,
  }];
}

/** A blank button whose id is unique in `buttons`. `now` is injectable for tests. */
function newButton(buttons: ButtonDto[], now: number = Date.now()): ButtonDto {
  const ids = new Set(buttons.map(b => b.id));
  while (ids.has('button-' + now)) { now++; }
  return {
    id: 'button-' + now, label: 'New Button', command: '',
    type: 'terminal', background: 'none', priority: nextPriority(buttons), saveAll: false, focus: true,
  };
}

/** Mirrors what the host's parseButtonConfigs rejects (it trims), so Save fails here first, next to the field. */
function validate(buttons: ButtonDto[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  buttons.forEach((b, index) => {
    if (seen.has(b.id)) { errors.push({ index, field: 'id', message: `Duplicate id "${b.id}"` }); }
    seen.add(b.id);
    if (!(b.label || '').trim()) { errors.push({ index, field: 'label', message: 'Label is required' }); }
    if (!(b.command || '').trim()) { errors.push({ index, field: 'command', message: 'Command is required' }); }
  });
  return errors;
}
