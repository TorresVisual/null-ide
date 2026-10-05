'use strict';

interface PickerItem {
  value: string;
  /** Plain name: matched by the filter box and, unless `html` is set, shown (escaped). */
  label: string;
  /** Trusted markup shown instead of `label`: a label chip, an avatar + login. The caller must have escaped it. */
  html?: string;
  description?: string;
  selected?: boolean;
}

interface PickerOptions {
  anchor: HTMLElement;
  title: string;
  items: PickerItem[];
  /** Multi-select pickers stay open and toggle the check; single-select ones close on pick. */
  multi?: boolean;
  /** Show the filter box. Default true. */
  filterable?: boolean;
  emptyText?: string;
  onSelect(value: string): void;
  /** Called once when the popover closes for any reason (pick in a single-select picker, Esc, click outside). */
  onClose?(): void;
}

function filterPickerItems(items: PickerItem[], text: string): PickerItem[] {
  const needle = text.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(i => i.label.toLowerCase().includes(needle) || (i.description ?? '').toLowerCase().includes(needle));
}

let closeActivePicker: (() => void) | null = null;
let activePickerAnchor: HTMLElement | null = null;

/**
 * Popover list under `anchor`: optional filter box, checkmarks, ↑/↓/Enter/Esc. One picker is open at a time,
 * and activating the anchor of the open picker closes it. Styled by `.picker*` in lib/issues.css.
 */
function openPicker(opts: PickerOptions): void {
  const wasOpenOnSameAnchor = activePickerAnchor === opts.anchor;
  closeActivePicker?.();
  if (wasOpenOnSameAnchor) return;

  const items = opts.items.map(i => ({ ...i })); // multi pickers toggle `selected` on their own copy
  const filterable = opts.filterable !== false;
  const pop = document.createElement('div');
  pop.className = 'picker';
  pop.tabIndex = -1;
  pop.innerHTML = `<div class="picker-title">${escapeHtml(opts.title)}</div>`
    + (filterable ? '<input class="picker-filter" placeholder="Filter" spellcheck="false">' : '')
    + '<div class="picker-list"></div>';
  document.body.appendChild(pop);
  const listEl = pop.querySelector('.picker-list') as HTMLElement;
  const input = pop.querySelector('.picker-filter') as HTMLInputElement | null;
  let shown: PickerItem[] = [];
  let active = 0;

  function render(): void {
    shown = filterPickerItems(items, input ? input.value : '');
    if (active >= shown.length) active = Math.max(0, shown.length - 1);
    listEl.innerHTML = shown.length === 0
      ? `<div class="picker-empty">${escapeHtml(opts.emptyText ?? 'Nothing to show')}</div>`
      : shown.map((item, i) => `
        <button type="button" class="picker-item${i === active ? ' active' : ''}" data-index="${i}">
          <span class="picker-check">${item.selected ? octicon('check') : ''}</span>
          <span class="picker-text">${item.html ?? escapeHtml(item.label)}${item.description ? `<span class="picker-desc">${escapeHtml(item.description)}</span>` : ''}</span>
        </button>`).join('');
    const activeEl = listEl.querySelector('.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function choose(index: number): void {
    const item = shown[index];
    if (!item) return;
    if (opts.multi) { item.selected = !item.selected; render(); } else close();
    opts.onSelect(item.value);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); opts.anchor.focus(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation();
      if (shown.length > 0) active = (active + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      choose(active);
    }
  }

  function onOutsideMouseDown(e: MouseEvent): void {
    const target = e.target as Node;
    if (!pop.contains(target) && !opts.anchor.contains(target)) close();
  }

  function close(): void {
    document.removeEventListener('keydown', onKeydown, true);
    document.removeEventListener('mousedown', onOutsideMouseDown, true);
    pop.remove();
    closeActivePicker = null;
    activePickerAnchor = null;
    opts.onClose?.();
  }

  listEl.addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('.picker-item');
    if (button) choose(Number(button.dataset.index));
  });
  if (input) input.addEventListener('input', () => { active = 0; render(); });
  document.addEventListener('keydown', onKeydown, true);
  document.addEventListener('mousedown', onOutsideMouseDown, true);
  closeActivePicker = close;
  activePickerAnchor = opts.anchor;

  render();
  const rect = opts.anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 4))}px`;
  pop.style.top = `${Math.max(4, Math.min(rect.bottom + 2, window.innerHeight - pop.offsetHeight - 4))}px`;
  (input ?? pop).focus();
}

/**
 * A multi-select picker that reports the final set once it closes (and only if it changed), like github.com, instead
 * of one request per tick. `items[].selected` is the starting set.
 */
function pickMany(anchor: HTMLElement, title: string, items: PickerItem[], apply: (chosen: Set<string>) => void): void {
  const initial = new Set(items.filter(i => i.selected).map(i => i.value));
  const chosen = new Set(initial);
  openPicker({
    anchor, title, items, multi: true,
    onSelect: v => { if (chosen.has(v)) chosen.delete(v); else chosen.add(v); },
    onClose: () => {
      if (chosen.size !== initial.size || [...initial].some(v => !chosen.has(v))) apply(chosen);
    },
  });
}
