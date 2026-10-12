'use strict';
const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * Sets attributes and appends children as text nodes or elements, so data (extension ids, events)
 * is never parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and
 * children are skipped. Never pass `style`: the CSP forbids inline style attributes.
 */
function fill(el, attrs, children) {
    if (attrs) {
        for (const name of Object.keys(attrs)) {
            const v = attrs[name];
            if (v === null || v === undefined || v === false)
                continue;
            el.setAttribute(name, v === true ? '' : String(v));
        }
    }
    for (const c of children) {
        if (c === null || c === undefined || c === false)
            continue;
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
}
function h(tag, attrs, ...children) {
    return fill(document.createElement(tag), attrs, children);
}
function s(tag, attrs, ...children) {
    return fill(document.createElementNS(SVG_NS, tag), attrs, children);
}
function formatMs(ms) {
    if (ms === undefined)
        return 'n/a';
    return ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';
}
function formatDelta(ms) {
    if (ms === undefined)
        return 'n/a';
    if (ms === 0)
        return '0 ms';
    return (ms > 0 ? '+' : '−') + formatMs(Math.abs(ms));
}
/** Position of `ms` on a `spanMs` wide axis, clamped to 0..100. */
function pct(ms, spanMs) {
    return spanMs > 0 ? Math.min(100, Math.max(0, (ms / spanMs) * 100)) : 0;
}
/** Stable copy sorted by `key`; rows without a value go last in either direction. */
function sortBy(rows, key, dir) {
    return rows.slice().sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x === undefined && y === undefined)
            return 0;
        if (x === undefined)
            return 1;
        if (y === undefined)
            return -1;
        return x < y ? -dir : x > y ? dir : 0;
    });
}
function renderTable(rows, columns, sort, onSort, flag) {
    const sorted = sortBy(rows, columns[sort.key].value, sort.dir);
    const head = columns.map((c, i) => {
        const arrow = i === sort.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '';
        const button = h('button', { type: 'button', class: 'sort' }, c.title + arrow);
        button.addEventListener('click', () => {
            if (sort.key === i)
                sort.dir = sort.dir === 1 ? -1 : 1;
            else {
                sort.key = i;
                sort.dir = c.numeric ? -1 : 1;
            }
            onSort();
        });
        return h('th', { class: c.numeric ? 'num' : null, 'aria-sort': i === sort.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none' }, button);
    });
    const body = sorted.map((r) => h('tr', { class: flag ? flag(r) : null }, ...columns.map((c) => h('td', { class: c.numeric ? 'num' : null }, c.text(r)))));
    return h('table', null, h('thead', null, h('tr', null, ...head)), h('tbody', null, ...body));
}
function timelineBar(x1, x2, y, cls, title) {
    return s('rect', { x: x1, y, width: Math.max(1.5, x2 - x1), height: 14, class: cls }, s('title', null, title));
}
/** Gantt strip: one row per measured phase, then packed lanes of extension activations, milestones as vertical lines. */
function renderTimeline(m) {
    const W = 1000;
    const ROW = 17;
    const TOP = 18;
    const x = (ms) => (pct(ms, m.spanMs) / 100) * W;
    const phases = m.phases.filter((p) => p.startMs !== undefined && p.endMs !== undefined);
    const exts = m.extensions.filter((e) => e.startMs !== undefined && e.endMs !== undefined);
    const lanes = exts.reduce((n, e) => Math.max(n, e.lane + 1), 0);
    const H = TOP + (phases.length + lanes) * ROW + 6;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img', 'aria-label': 'Startup timeline' });
    phases.forEach((p, i) => svg.appendChild(timelineBar(x(p.startMs), x(p.endMs), TOP + i * ROW, 'bar phase', `${p.label}: ${formatMs(p.durationMs)}`)));
    exts.forEach((e) => {
        const cls = 'bar ext' + (e.deferred ? ' deferred' : '') + (e.slow ? ' slow' : '');
        svg.appendChild(timelineBar(x(e.startMs), x(e.endMs), TOP + (phases.length + e.lane) * ROW, cls, `${e.id}: ${formatMs(e.totalMs)}${e.deferred ? ' (deferred)' : ''}`));
    });
    m.milestones.forEach((ms) => {
        if (ms.atMs === undefined)
            return;
        const mx = x(ms.atMs);
        svg.appendChild(s('line', { x1: mx, x2: mx, y1: 12, y2: H, class: 'milestone' }));
        svg.appendChild(s('text', { x: Math.min(mx + 3, W - 90), y: 10, class: 'milestone-label' }, ms.label));
    });
    return svg;
}
const vscodeApi = acquireVsCodeApi();
const appRoot = document.getElementById('app');
let model;
const phaseSort = { key: 3, dir: -1 };
const extSort = { key: 4, dir: -1 };
function send(message) {
    vscodeApi.postMessage(message);
}
function button(text, message) {
    const b = h('button', { type: 'button', class: 'action' }, text);
    b.addEventListener('click', () => send(message));
    return b;
}
function renderControls(m) {
    const launches = h('select', { 'aria-label': 'Launch' }, ...m.launches.map((l) => h('option', { value: l.id, selected: l.id === m.reportId }, l.label)));
    launches.addEventListener('change', () => send({ type: 'select', reportId: launches.value }));
    const options = [
        { id: 'previous', label: 'Compare with previous launch' },
        { id: 'median', label: 'Compare with median' },
        { id: 'none', label: 'No comparison' },
    ];
    const baseline = h('select', { 'aria-label': 'Comparison' }, ...options.map((o) => h('option', { value: o.id, selected: o.id === m.baseline }, o.label)));
    baseline.addEventListener('change', () => send({ type: 'setBaseline', baseline: baseline.value }));
    return h('div', { class: 'controls' }, launches, baseline, button('Copy report', { type: 'copy' }), button('Export JSON…', { type: 'export' }));
}
function renderSummary(m) {
    const list = (title, items) => h('div', { class: 'slowest' }, h('h3', null, title), h('ol', null, ...(items.length ? items.map((t) => h('li', null, t)) : [h('li', null, 'n/a')])));
    return h('section', { class: 'summary' }, h('div', { class: 'headline' }, h('span', { class: 'big' }, formatMs(m.headlineMs)), h('span', { class: 'sub' }, 'until the workspace was restored' + (m.partial ? ' (partial data)' : ''))), h('div', { class: 'milestones' }, ...m.milestones.map((ms) => h('span', { class: 'chip' }, `${ms.label} ${formatMs(ms.atMs)}`))), list('Slowest phases', m.slowestPhases.map((p) => `${p.label} — ${formatMs(p.impactMs)}`)), list('Slowest extensions', m.slowestExtensions.map((e) => `${e.id} — ${formatMs(e.totalMs)}${e.slow ? ' (slow)' : ''}`)));
}
function renderComparison(c) {
    const columns = [
        { title: 'Name', value: (r) => r.label, text: (r) => r.label },
        { title: 'Before', value: (r) => r.baseMs, text: (r) => formatMs(r.baseMs), numeric: true },
        { title: 'Now', value: (r) => r.currentMs, text: (r) => formatMs(r.currentMs), numeric: true },
        { title: 'Change', value: (r) => r.deltaMs, text: (r) => formatDelta(r.deltaMs) + (r.regression ? ' ⚠' : ''), numeric: true },
    ];
    const state = { key: 3, dir: -1 };
    const flag = (r) => (r.regression ? 'regression' : '');
    const holder = h('div', { class: 'cmp-tables' });
    const draw = () => {
        holder.replaceChildren(h('h3', null, 'Phases'), renderTable(c.phases, columns, state, draw, flag), h('h3', null, 'Extensions'), renderTable(c.extensions.slice(0, 15), columns, state, draw, flag));
    };
    draw();
    return h('section', null, h('h2', null, `Compared with ${c.baseLabel}`), h('p', { class: flag(c.headline) }, `Startup ${formatMs(c.headline.baseMs)} → ${formatMs(c.headline.currentMs)} (${formatDelta(c.headline.deltaMs)})${c.headline.regression ? ' ⚠ regression' : ''}`), holder);
}
function render() {
    if (!model)
        return;
    const m = model;
    if (!m.hasReport) {
        appRoot.replaceChildren(h('h1', null, 'Startup Performance'), h('p', { class: 'empty' }, 'No startup report yet. A report is recorded after each launch of a Null IDE build that includes startup instrumentation.'));
        return;
    }
    const phaseColumns = [
        { title: 'Phase', value: (r) => r.label, text: (r) => r.label },
        { title: 'Process', value: (r) => r.process, text: (r) => r.process },
        { title: 'Start', value: (r) => r.startMs, text: (r) => formatMs(r.startMs), numeric: true },
        { title: 'Impact', value: (r) => r.impactMs, text: (r) => formatMs(r.impactMs), numeric: true },
        { title: 'Duration', value: (r) => r.durationMs, text: (r) => formatMs(r.durationMs), numeric: true },
    ];
    const extColumns = [
        { title: 'Extension', value: (r) => r.id, text: (r) => r.id },
        { title: 'When', value: (r) => (r.deferred ? 'deferred' : 'startup'), text: (r) => (r.deferred ? 'deferred' : 'startup') },
        { title: 'Event', value: (r) => r.activationEvent, text: (r) => r.activationEvent || 'n/a' },
        { title: 'Start', value: (r) => r.startMs, text: (r) => formatMs(r.startMs), numeric: true },
        { title: 'Total', value: (r) => r.totalMs, text: (r) => formatMs(r.totalMs) + (r.slow ? ' · slow' : ''), numeric: true },
        { title: 'Load', value: (r) => r.loadMs, text: (r) => formatMs(r.loadMs), numeric: true },
        { title: 'Activate', value: (r) => r.callMs, text: (r) => formatMs(r.callMs), numeric: true },
        { title: 'Resolve', value: (r) => r.resolveMs, text: (r) => formatMs(r.resolveMs), numeric: true },
    ];
    appRoot.replaceChildren(h('h1', null, 'Startup Performance'), renderControls(m), renderSummary(m), ...(m.comparison ? [renderComparison(m.comparison)] : []), h('section', null, h('h2', null, 'Timeline'), renderTimeline(m), h('p', { class: 'legend' }, 'Phases on top, then extension activations (lighter = deferred, outlined = slow). Overlapping bars ran concurrently.')), h('section', null, h('h2', null, 'Phases'), renderTable(m.phases, phaseColumns, phaseSort, render)), h('section', null, h('h2', null, `Extensions (slow ≥ ${m.slowMs} ms)`), renderTable(m.extensions, extColumns, extSort, render, (r) => (r.slow ? 'slow' : ''))));
}
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'model') {
        model = message.model;
        render();
    }
});
send({ type: 'ready' });
