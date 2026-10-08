'use strict';

let queueDragKey: number | null = null;
let focusQueueKeyAfterRender: number | null = null;

function clearDropMarks(): void {
  document.querySelectorAll('.drop-before, .drop-end-active').forEach((n) => n.classList.remove('drop-before', 'drop-end-active'));
}

/** Put the dragged entry before `beforeKey` (`null` = last). */
function dropQueueEntry(beforeKey: number | null): void {
  const key = queueDragKey;
  queueDragKey = null;
  clearDropMarks();
  if (key !== null && key !== beforeKey) send({ type: 'queueMove', key, beforeKey });
}

function queueRow(item: WireQueueItem, kind: 'current' | 'upcoming' | 'history'): HTMLElement {
  const row = trackRow(item.track, {
    key: item.key,
    query: app.query,
    onPlay: () => send(kind === 'current' ? { type: 'playPause' } : { type: 'queueJump', key: item.key }),
    extra: [iconButton('close', 'Remove from queue', () => send({ type: 'queueRemove', key: item.key }), 'np-remove')],
  });
  if (kind === 'upcoming' && app.queue.reorderable) {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e: DragEvent) => {
      queueDragKey = item.key;
      row.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(item.key));
      }
    });
    row.addEventListener('dragend', () => {
      queueDragKey = null;
      row.classList.remove('dragging');
      clearDropMarks();
    });
    row.addEventListener('dragover', (e: DragEvent) => {
      if (queueDragKey === null) return;
      e.preventDefault();
      clearDropMarks();
      row.classList.add('drop-before');
    });
    row.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      dropQueueEntry(item.key);
    });
  }
  return row;
}

function renderQueueView(el: HTMLElement): void {
  const q = app.queue;
  if (!q.current) {
    el.replaceChildren(
      hasNoSources()
        ? noLibraryState()
        : emptyState('list', 'The queue is empty', app.tracks.length ? 'Pick a track in Library, or play everything.' : '', app.tracks.length ? [textButton('Play library', () => send({ type: 'playPause' }), true)] : [])
    );
    return;
  }

  const keep = (i: WireQueueItem) => matchesTrack(i.track, app.query);
  const upcoming = q.upcoming.filter(keep);
  const history = q.history.filter(keep).reverse(); // newest first
  if (app.query.trim() && !keep(q.current) && upcoming.length === 0 && history.length === 0) {
    el.replaceChildren(noResultsState());
    return;
  }

  const list = h('div', { class: 'np-list', role: 'listbox', 'aria-label': 'Queue' });
  list.append(sectionHeading('Now playing'), queueRow(q.current, 'current'));

  if (upcoming.length > 0) {
    list.appendChild(sectionHeading('Next up (' + q.upcoming.length + ')'));
    for (const item of upcoming) list.appendChild(queueRow(item, 'upcoming'));
    if (q.reorderable && !app.query.trim()) {
      const end = h('div', { class: 'np-drop-end', 'aria-hidden': 'true' });
      end.addEventListener('dragover', (e: DragEvent) => {
        if (queueDragKey === null) return;
        e.preventDefault();
        clearDropMarks();
        end.classList.add('drop-end-active');
      });
      end.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault();
        dropQueueEntry(null);
      });
      list.appendChild(end);
    }
  }

  if (history.length > 0) {
    const toggle = h('button', { class: 'np-section-btn', type: 'button', 'aria-expanded': String(app.historyOpen) }, icon('back'), 'History (' + q.history.length + ')');
    toggle.addEventListener('click', () => {
      app.historyOpen = !app.historyOpen;
      invalidate('content');
    });
    list.appendChild(h('div', { class: 'np-section' }, toggle));
    if (app.historyOpen) for (const item of history) list.appendChild(queueRow(item, 'history'));
  }

  list.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || !app.queue.reorderable) return;
    const raw = (e.target as HTMLElement).getAttribute('data-key');
    if (raw === null) return;
    const key = Number(raw);
    const before = reorderTarget(app.queue.upcoming.map((i) => i.key), key, e.key === 'ArrowUp' ? -1 : 1);
    if (before === undefined) return;
    e.preventDefault();
    focusQueueKeyAfterRender = key;
    send({ type: 'queueMove', key, beforeKey: before });
  });
  makeRoving(list);

  const toolbar = h(
    'div',
    { class: 'np-toolbar' },
    h('span', { class: 'np-toolbar-title' }, q.upcoming.length + 1 + (q.upcoming.length === 0 ? ' track' : ' tracks')),
    textButton('Clear queue', () => send({ type: 'queueClear' }))
  );
  el.replaceChildren(toolbar, list);

  if (focusQueueKeyAfterRender !== null) {
    const row = list.querySelector('[data-key="' + focusQueueKeyAfterRender + '"]') as HTMLElement | null;
    focusQueueKeyAfterRender = null;
    if (row) row.focus();
  }
}

tabRenderers.queue = renderQueueView;
