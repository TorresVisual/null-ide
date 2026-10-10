'use strict';
const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * Sets attributes and appends children as text nodes or elements, so data (project names, paths)
 * is never parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and
 * children are skipped. Never pass `style`: the CSP forbids inline style attributes
 * (use el.style.setProperty).
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
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "6h 42m", "35m", "<1m" for under a minute, "0m" for nothing. */
function formatDuration(ms) {
    if (ms <= 0)
        return '0m';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1)
        return '<1m';
    return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
/** A row that rounds to 0% but has time reads "<1%", not a misleading "0%". */
function formatPercent(percent, ms) {
    return percent === 0 && ms > 0 ? '<1%' : `${percent}%`;
}
/** Size per value with the largest = maxPx; zero (or all-zero) values get stubPx so every bucket stays visible. */
function barScale(values, maxPx, stubPx) {
    let max = 0;
    for (const v of values)
        if (v > max)
            max = v;
    return values.map((v) => (v <= 0 || max <= 0 ? stubPx : Math.max(stubPx, Math.round((v / max) * maxPx))));
}
/** Indexes to label under a graph: at most `max`, evenly spaced, always starting at 0. */
function axisTicks(count, max) {
    const step = Math.max(1, Math.ceil(count / max));
    const out = [];
    for (let i = 0; i < count; i += step)
        out.push(i);
    return out;
}
/** Tooltip text and accessible name of a graph bar. */
function barLabel(bar) {
    return `${bar.label} · ${formatDuration(bar.ms)}`;
}
/** "Thu 8 Oct, 14:05" in the viewer's local time. */
function formatDateTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Hover text for a session row: one file per line, the first `max` only. */
function filesTitle(files, max) {
    if (files.length === 0)
        return 'No files';
    return files.length > max ? [...files.slice(0, max), `+${files.length - max} more`].join('\n') : files.join('\n');
}
/** Arrow-key navigation for a tab list; `undefined` for keys that do not move. */
function nextIndex(index, count, key) {
    switch (key) {
        case 'ArrowRight':
            return (index + 1) % count;
        case 'ArrowLeft':
            return (index - 1 + count) % count;
        case 'Home':
            return 0;
        case 'End':
            return count - 1;
        default:
            return undefined;
    }
}
const GRAPH_HEIGHT = 120; // viewBox height; the SVG is stretched to the container by CSS
const BAR_SLOT = 10;
/** Inline-SVG bars scaled to the largest bucket; every bar is focusable, with a hover/focus tooltip. */
function renderGraph(model) {
    const bars = model.bars;
    const heights = barScale(bars.map((b) => b.ms), GRAPH_HEIGHT, 2);
    const tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
    const centre = (i) => `${((i + 0.5) / bars.length) * 100}%`;
    const rects = bars.map((bar, i) => {
        const rect = s('rect', {
            class: 'bar',
            x: i * BAR_SLOT + 1,
            y: GRAPH_HEIGHT - heights[i],
            width: BAR_SLOT - 2,
            height: heights[i],
            tabindex: 0,
            role: 'img',
            'aria-label': barLabel(bar),
        });
        const show = () => {
            tip.textContent = barLabel(bar);
            tip.style.setProperty('left', centre(i));
            tip.hidden = false;
        };
        const hide = () => {
            tip.hidden = true;
        };
        rect.addEventListener('mouseenter', show);
        rect.addEventListener('focus', show);
        rect.addEventListener('mouseleave', hide);
        rect.addEventListener('blur', hide);
        return rect;
    });
    const svg = s('svg', {
        class: 'graph-svg',
        viewBox: `0 0 ${bars.length * BAR_SLOT} ${GRAPH_HEIGHT}`,
        preserveAspectRatio: 'none',
        role: 'group',
        'aria-label': 'Activity graph',
    }, ...rects);
    const ticks = axisTicks(bars.length, 6).map((i) => {
        const tick = h('span', { class: 'tick' }, bars[i].label);
        tick.style.setProperty('left', centre(i));
        return tick;
    });
    return h('section', { class: 'graph' }, h('div', { class: 'plot' }, svg, tip), h('div', { class: 'axis' }, ...ticks));
}
/** One card: a ranked list of name, proportional bar (relative to the largest row), duration and percent. */
function renderBreakdown(title, shares) {
    const widths = barScale(shares.map((share) => share.ms), 100, 0);
    const rows = shares.map((share, i) => {
        const fillBar = h('div', { class: 'fill' });
        fillBar.style.setProperty('width', `${widths[i]}%`);
        return h('li', { class: 'row' }, h('span', { class: 'name', title: share.name }, share.name), h('div', { class: 'track' }, fillBar), h('span', { class: 'dur' }, formatDuration(share.ms)), h('span', { class: 'pct' }, formatPercent(share.percent, share.ms)));
    });
    return h('section', { class: 'card' }, h('h2', null, title), h('ul', { class: 'rows' }, ...rows));
}
const SESSION_FILES_SHOWN = 20;
/** Table of start, duration, projects, languages and file count; hovering a row lists its files. */
function renderSessions(rows) {
    const head = ['Start', 'Duration', 'Projects', 'Languages', 'Files'].map((title) => h('th', { scope: 'col' }, title));
    const body = rows.map((row) => h('tr', { title: filesTitle(row.files, SESSION_FILES_SHOWN) }, h('td', null, formatDateTime(row.start)), h('td', null, formatDuration(row.ms)), h('td', null, row.projects.join(', ')), h('td', null, row.languages.join(', ')), h('td', { class: 'num' }, String(row.files.length))));
    return h('section', { class: 'card' }, h('h2', null, 'Sessions'), h('table', { class: 'sessions' }, h('thead', null, h('tr', null, ...head)), h('tbody', null, ...body)));
}
const vscodeApi = acquireVsCodeApi();
const RANGE_TABS = [
    { id: 'today', label: 'Today' },
    { id: 'yesterday', label: 'Yesterday' },
    { id: 'week', label: 'This week' },
    { id: 'month', label: 'This month' },
    { id: 'all', label: 'All time' },
];
const appRoot = document.getElementById('app');
function send(message) {
    vscodeApi.postMessage(message);
}
function linkButton(text, message) {
    const button = h('button', { type: 'button', class: 'link' }, text);
    button.addEventListener('click', () => send(message));
    return button;
}
function renderTabs(model) {
    const current = RANGE_TABS.findIndex((tab) => tab.id === model.range);
    const tabs = RANGE_TABS.map((tab, i) => {
        const selected = i === current;
        const button = h('button', { type: 'button', role: 'tab', class: selected ? 'tab active' : 'tab', 'aria-selected': String(selected), tabindex: selected ? 0 : -1 }, tab.label);
        button.addEventListener('click', () => send({ type: 'setRange', range: tab.id }));
        return button;
    });
    const list = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Range' }, ...tabs);
    list.addEventListener('keydown', (event) => {
        const next = nextIndex(current, RANGE_TABS.length, event.key);
        if (next === undefined)
            return;
        event.preventDefault();
        send({ type: 'setRange', range: RANGE_TABS[next].id });
    });
    return list;
}
function renderBody(model) {
    if (model.totalMs === 0)
        return [h('p', { class: 'empty' }, 'Nothing tracked in this range.')];
    return [
        renderGraph(model),
        h('div', { class: 'columns' }, renderBreakdown('Projects', model.projects), renderBreakdown('Languages', model.languages)),
        renderSessions(model.sessions),
    ];
}
function render(model) {
    var _a;
    // The host sends a fresh model after every range change; keep keyboard focus on the tab list across it.
    const tabsHadFocus = !!document.activeElement && !!document.activeElement.closest('.tabs');
    const parts = [h('header', { class: 'top' }, h('h1', null, 'Coding Activity'), renderTabs(model))];
    if (!model.enabled) {
        parts.push(h('div', { class: 'banner', role: 'status' }, h('span', null, 'Tracking is off. Existing data is still shown.'), linkButton('Enable', { type: 'enableTracking' })));
    }
    parts.push(h('section', { class: 'total' }, h('div', { class: 'total-value' }, formatDuration(model.totalMs)), h('div', { class: 'total-label' }, model.rangeLabel)), ...renderBody(model), h('footer', { class: 'foot' }, linkButton("What's tracked?", { type: 'showTrackedData' }), linkButton('Settings', { type: 'openSettings' })));
    appRoot.replaceChildren(...parts);
    if (tabsHadFocus)
        (_a = appRoot.querySelector('.tab.active')) === null || _a === void 0 ? void 0 : _a.focus();
}
window.addEventListener('message', (event) => {
    const message = event.data;
    if (message && message.type === 'model')
        render(message.model);
});
send({ type: 'ready' });
