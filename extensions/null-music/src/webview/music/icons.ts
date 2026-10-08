'use strict';

// Hand-drawn 16px stroke icons (codicon style). Check them at 100% zoom in Step 12 and nudge a path if one looks off.
const ICON_PATHS: Record<string, string> = {
  play: '<path d="M4 2.5v11l9-5.5z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" stroke="none"/>',
  next: '<path d="M3 2.5v11l8-5.5zM12 2.5h1.5v11H12z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M13 2.5v11L5 8zM2.5 2.5H4v11H2.5z" fill="currentColor" stroke="none"/>',
  shuffle: '<path d="M1.5 4.5h2.5c3 0 4 7 7 7h3M1.5 11.5h2.5c1 0 1.8-.8 2.5-1.8M8.5 6c.7-.9 1.5-1.5 2.5-1.5h3M12.5 2.5l2 2-2 2M12.5 9.5l2 2-2 2"/>',
  repeat: '<path d="M3 7V6a2 2 0 0 1 2-2h8M11 1.5l2 2.5-2 2.5M13 9v1a2 2 0 0 1-2 2H3M5 14.5 3 12l2-2.5"/>',
  heart: '<path d="M8 13.5 2.7 8.2a3.1 3.1 0 0 1 4.4-4.4L8 4.7l.9-.9a3.1 3.1 0 0 1 4.4 4.4z"/>',
  volume: '<path d="M2 6v4h2.5L8 13V3L4.5 6zM10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.5a6.5 6.5 0 0 1 0 9"/>',
  mute: '<path d="M2 6v4h2.5L8 13V3L4.5 6zM10.5 6l4 4M14.5 6l-4 4"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 4 4"/>',
  more: '<circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="8" cy="8" r="1" fill="currentColor"/><circle cx="13" cy="8" r="1" fill="currentColor"/>',
  back: '<path d="M10 2.5 4.5 8 10 13.5"/>',
  close: '<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>',
  warning: '<path d="M8 2 14.5 13.5h-13zM8 6.5v3.5M8 11.8v.4"/>',
  folder: '<path d="M1.5 3.5h4l1.5 1.5h7.5v7.5h-13z"/>',
  list: '<path d="M2 4h12M2 8h12M2 12h8"/>',
  note: '<path d="M6 12.5V3l7-1.5V11M8 12.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM15 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>',
  plus: '<path d="M8 3v10M3 8h10"/>',
  disc: '<circle cx="8" cy="8" r="6"/><circle cx="8" cy="8" r="1.5"/>',
  user: '<circle cx="8" cy="5.5" r="2.5"/><path d="M3 13.5c.5-3 2.5-4 5-4s4.5 1 5 4"/>',
};

function icon(name: string): HTMLElement {
  const span = h('span', { class: 'np-icon', 'aria-hidden': 'true' });
  // The one place markup is parsed: a static constant from the table above, never data.
  span.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" ' +
    'stroke-linecap="round" stroke-linejoin="round" focusable="false">' + (ICON_PATHS[name] || '') + '</svg>';
  return span;
}

function iconButton(name: string, label: string, onClick: () => void, extraClass?: string): HTMLButtonElement {
  const b = h('button', { class: 'np-btn' + (extraClass ? ' ' + extraClass : ''), type: 'button', 'aria-label': label, title: label }, icon(name)) as HTMLButtonElement;
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return b;
}
