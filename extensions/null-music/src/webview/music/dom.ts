'use strict';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined> | null;

/**
 * Builds an element from text nodes and setAttribute only, so data (track names, paths) is never
 * parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and children are skipped.
 * Never pass `style`: the CSP forbids inline style attributes (use el.style.setProperty).
 */
function h(tag: string, attrs?: Attrs, ...children: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const name of Object.keys(attrs)) {
      const v = attrs[name];
      if (v === null || v === undefined || v === false) continue;
      el.setAttribute(name, v === true ? '' : String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** `text` as strings and <mark> elements around every case-insensitive occurrence of `query`. */
function markText(text: string, query: string): Child[] {
  const out: Child[] = [];
  let at = 0;
  for (const range of highlightRanges(text, query)) {
    if (range[0] > at) out.push(text.slice(at, range[0]));
    out.push(h('mark', null, text.slice(range[0], range[1])));
    at = range[1];
  }
  if (at < text.length || out.length === 0) out.push(text.slice(at));
  return out;
}

/** Value for `data-vscode-context`: makes the `webview/context` menu contribution fire for this track. */
function trackContext(trackId: string): string {
  return JSON.stringify({ webviewSection: 'track', trackId, preventDefaultContextMenuItems: true });
}
