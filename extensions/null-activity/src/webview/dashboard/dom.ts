'use strict';

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined> | null;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Sets attributes and appends children as text nodes or elements, so data (project names, paths)
 * is never parsed as HTML. `true` sets a boolean attribute; null/undefined/false attributes and
 * children are skipped. Never pass `style`: the CSP forbids inline style attributes
 * (use el.style.setProperty).
 */
function fill<T extends Element>(el: T, attrs: Attrs | undefined, children: Child[]): T {
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

function h(tag: string, attrs?: Attrs, ...children: Child[]): HTMLElement {
  return fill(document.createElement(tag), attrs, children);
}

function s(tag: string, attrs?: Attrs, ...children: Child[]): SVGElement {
  return fill(document.createElementNS(SVG_NS, tag) as SVGElement, attrs, children);
}
