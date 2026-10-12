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
