'use strict';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };

const vscodeApi = acquireVsCodeApi();
const RANGE_TABS: { id: DashboardRange; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'all', label: 'All time' },
];
const appRoot = document.getElementById('app') as HTMLElement;

function send(message: WebviewToHost): void {
  vscodeApi.postMessage(message);
}

function linkButton(text: string, message: WebviewToHost): HTMLElement {
  const button = h('button', { type: 'button', class: 'link' }, text);
  button.addEventListener('click', () => send(message));
  return button;
}

function renderTabs(model: DashboardModel): HTMLElement {
  const current = RANGE_TABS.findIndex((tab) => tab.id === model.range);
  const tabs = RANGE_TABS.map((tab, i) => {
    const selected = i === current;
    const button = h(
      'button',
      { type: 'button', role: 'tab', class: selected ? 'tab active' : 'tab', 'aria-selected': String(selected), tabindex: selected ? 0 : -1 },
      tab.label,
    );
    button.addEventListener('click', () => send({ type: 'setRange', range: tab.id }));
    return button;
  });
  const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Range' }, ...tabs);
  list.addEventListener('keydown', (event) => {
    const next = nextIndex(current, RANGE_TABS.length, (event as KeyboardEvent).key);
    if (next === undefined) return;
    event.preventDefault();
    send({ type: 'setRange', range: RANGE_TABS[next].id });
  });
  return list;
}

function renderBody(model: DashboardModel): Node[] {
  if (model.totalMs === 0) return [h('p', { class: 'empty' }, 'Nothing tracked in this range.')];
  return [
    renderGraph(model),
    h('div', { class: 'columns' }, renderBreakdown('Projects', model.projects, model.git), renderBreakdown('Languages', model.languages)),
    ...(model.machines ? [h('div', { class: 'columns' }, renderBreakdown('Machines', model.machines))] : []),
    renderSessions(model.sessions),
  ];
}

function render(model: DashboardModel): void {
  // The host sends a fresh model after every range change; keep keyboard focus on the tab list across it.
  const tabsHadFocus = !!document.activeElement && !!document.activeElement.closest('.tabs');
  const parts: Node[] = [h('header', { class: 'top' }, h('h1', null, 'Coding Activity'), renderTabs(model))];
  if (!model.enabled) {
    parts.push(
      h(
        'div',
        { class: 'banner', role: 'status' },
        h('span', null, 'Tracking is off. Existing data is still shown.'),
        linkButton('Enable', { type: 'enableTracking' }),
      ),
    );
  }
  parts.push(
    h(
      'section',
      { class: 'total' },
      h('div', { class: 'total-value' }, formatDuration(model.totalMs)),
      h('div', { class: 'total-label' }, model.rangeLabel),
      model.git && model.git.totals.commits > 0 ? h('div', { class: 'total-git' }, renderGitLine(model.git.totals)) : null,
    ),
    ...renderBody(model),
    h('footer', { class: 'foot' }, linkButton("What's tracked?", { type: 'showTrackedData' }), linkButton('Settings', { type: 'openSettings' })),
  );
  appRoot.replaceChildren(...parts);
  if (tabsHadFocus) appRoot.querySelector<HTMLElement>('.tab.active')?.focus();
}

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (message && message.type === 'model') render(message.model);
});

send({ type: 'ready' });
