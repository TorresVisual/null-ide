'use strict';

declare function acquireVsCodeApi(): { postMessage(message: WebviewToHost): void };

const vscodeApi = acquireVsCodeApi();
const appRoot = document.getElementById('app') as HTMLElement;
let model: ReportViewModel | undefined;

const phaseSort: SortState = { key: 3, dir: -1 };
const extSort: SortState = { key: 4, dir: -1 };

function send(message: WebviewToHost): void {
  vscodeApi.postMessage(message);
}

function button(text: string, message: WebviewToHost): HTMLElement {
  const b = h('button', { type: 'button', class: 'action' }, text);
  b.addEventListener('click', () => send(message));
  return b;
}

function renderControls(m: ReportViewModel): HTMLElement {
  const launches = h('select', { 'aria-label': 'Launch' }, ...m.launches.map((l) => h('option', { value: l.id, selected: l.id === m.reportId }, l.label)));
  launches.addEventListener('change', () => send({ type: 'select', reportId: (launches as HTMLSelectElement).value }));
  const options: { id: BaselineKind; label: string }[] = [
    { id: 'previous', label: 'Compare with previous launch' },
    { id: 'median', label: 'Compare with median' },
    { id: 'none', label: 'No comparison' },
  ];
  const baseline = h('select', { 'aria-label': 'Comparison' }, ...options.map((o) => h('option', { value: o.id, selected: o.id === m.baseline }, o.label)));
  baseline.addEventListener('change', () => send({ type: 'setBaseline', baseline: (baseline as HTMLSelectElement).value as BaselineKind }));
  return h('div', { class: 'controls' }, launches, baseline, button('Copy report', { type: 'copy' }), button('Export JSON…', { type: 'export' }));
}

function renderSummary(m: ReportViewModel): HTMLElement {
  const list = (title: string, items: string[]) => h('div', { class: 'slowest' }, h('h3', null, title), h('ol', null, ...(items.length ? items.map((t) => h('li', null, t)) : [h('li', null, 'n/a')])));
  return h(
    'section',
    { class: 'summary' },
    h('div', { class: 'headline' }, h('span', { class: 'big' }, formatMs(m.headlineMs)), h('span', { class: 'sub' }, 'until the workspace was restored' + (m.partial ? ' (partial data)' : ''))),
    h('div', { class: 'milestones' }, ...m.milestones.map((ms) => h('span', { class: 'chip' }, `${ms.label} ${formatMs(ms.atMs)}`))),
    list('Slowest phases', m.slowestPhases.map((p) => `${p.label} — ${formatMs(p.impactMs)}`)),
    list('Slowest extensions', m.slowestExtensions.map((e) => `${e.id} — ${formatMs(e.totalMs)}${e.slow ? ' (slow)' : ''}`)),
  );
}

function renderComparison(c: ComparisonVM): HTMLElement {
  const columns: Column<DeltaVM>[] = [
    { title: 'Name', value: (r) => r.label, text: (r) => r.label },
    { title: 'Before', value: (r) => r.baseMs, text: (r) => formatMs(r.baseMs), numeric: true },
    { title: 'Now', value: (r) => r.currentMs, text: (r) => formatMs(r.currentMs), numeric: true },
    { title: 'Change', value: (r) => r.deltaMs, text: (r) => formatDelta(r.deltaMs) + (r.regression ? ' ⚠' : ''), numeric: true },
  ];
  const state: SortState = { key: 3, dir: -1 };
  const flag = (r: DeltaVM) => (r.regression ? 'regression' : '');
  const holder = h('div', { class: 'cmp-tables' });
  const draw = () => {
    holder.replaceChildren(
      h('h3', null, 'Phases'), renderTable(c.phases, columns, state, draw, flag),
      h('h3', null, 'Extensions'), renderTable(c.extensions.slice(0, 15), columns, state, draw, flag),
    );
  };
  draw();
  return h('section', null, h('h2', null, `Compared with ${c.baseLabel}`), h('p', { class: flag(c.headline) }, `Startup ${formatMs(c.headline.baseMs)} → ${formatMs(c.headline.currentMs)} (${formatDelta(c.headline.deltaMs)})${c.headline.regression ? ' ⚠ regression' : ''}`), holder);
}

function render(): void {
  if (!model) return;
  const m = model;
  if (!m.hasReport) {
    appRoot.replaceChildren(h('h1', null, 'Startup Performance'), h('p', { class: 'empty' }, 'No startup report yet. A report is recorded after each launch of a Null IDE build that includes startup instrumentation.'));
    return;
  }
  const phaseColumns: Column<PhaseVM>[] = [
    { title: 'Phase', value: (r) => r.label, text: (r) => r.label },
    { title: 'Process', value: (r) => r.process, text: (r) => r.process },
    { title: 'Start', value: (r) => r.startMs, text: (r) => formatMs(r.startMs), numeric: true },
    { title: 'Impact', value: (r) => r.impactMs, text: (r) => formatMs(r.impactMs), numeric: true },
    { title: 'Duration', value: (r) => r.durationMs, text: (r) => formatMs(r.durationMs), numeric: true },
  ];
  const extColumns: Column<ExtensionVM>[] = [
    { title: 'Extension', value: (r) => r.id, text: (r) => r.id },
    { title: 'When', value: (r) => (r.deferred ? 'deferred' : 'startup'), text: (r) => (r.deferred ? 'deferred' : 'startup') },
    { title: 'Event', value: (r) => r.activationEvent, text: (r) => r.activationEvent || 'n/a' },
    { title: 'Start', value: (r) => r.startMs, text: (r) => formatMs(r.startMs), numeric: true },
    { title: 'Total', value: (r) => r.totalMs, text: (r) => formatMs(r.totalMs) + (r.slow ? ' · slow' : ''), numeric: true },
    { title: 'Load', value: (r) => r.loadMs, text: (r) => formatMs(r.loadMs), numeric: true },
    { title: 'Activate', value: (r) => r.callMs, text: (r) => formatMs(r.callMs), numeric: true },
    { title: 'Resolve', value: (r) => r.resolveMs, text: (r) => formatMs(r.resolveMs), numeric: true },
  ];
  appRoot.replaceChildren(
    h('h1', null, 'Startup Performance'),
    renderControls(m),
    renderSummary(m),
    ...(m.comparison ? [renderComparison(m.comparison)] : []),
    h('section', null, h('h2', null, 'Timeline'), renderTimeline(m), h('p', { class: 'legend' }, 'Phases on top, then extension activations (lighter = deferred, outlined = slow). Overlapping bars ran concurrently.')),
    h('section', null, h('h2', null, 'Phases'), renderTable(m.phases, phaseColumns, phaseSort, render)),
    h('section', null, h('h2', null, `Extensions (slow ≥ ${m.slowMs} ms)`), renderTable(m.extensions, extColumns, extSort, render, (r) => (r.slow ? 'slow' : ''))),
  );
}

window.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as HostToWebview;
  if (message && message.type === 'model') {
    model = message.model;
    render();
  }
});

send({ type: 'ready' });
