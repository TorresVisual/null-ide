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
