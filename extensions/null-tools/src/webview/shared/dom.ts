'use strict';

function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, c => map[c]);
}

const reconcileKeys = new WeakMap<Element, string>();
const reconcileSignatures = new WeakMap<Element, string>();

/**
 * Makes `container`'s children match `items`, matched by `key`. A row whose item is unchanged (compared as JSON)
 * keeps its DOM node, so hover, focus and scroll survive a refresh; changed rows are re-rendered in place, new
 * ones inserted, missing ones removed, and rows are only moved when out of order. Children it didn't create
 * (a skeleton, an old message) are removed. A repeated key is skipped.
 */
function reconcile<T>(container: Element, items: T[], key: (item: T) => string, render: (item: T) => Element): void {
  const wanted = new Set(items.map(key));
  const existing = new Map<string, Element>();
  for (const child of Array.from(container.children)) {
    const k = reconcileKeys.get(child);
    if (k !== undefined && wanted.has(k) && !existing.has(k)) existing.set(k, child);
    else container.removeChild(child);
  }
  const placed = new Set<string>();
  let previous: Element | null = null;
  for (const item of items) {
    const k = key(item);
    if (placed.has(k)) continue;
    placed.add(k);
    const signature = JSON.stringify(item);
    let el = existing.get(k);
    if (el && reconcileSignatures.get(el) !== signature) {
      const fresh = render(item);
      container.replaceChild(fresh, el);
      el = fresh;
    } else if (!el) {
      el = render(item);
    }
    reconcileKeys.set(el, k);
    reconcileSignatures.set(el, signature);
    const expected: Element | null = previous ? previous.nextElementSibling : container.firstElementChild;
    if (el !== expected) container.insertBefore(el, expected);
    previous = el;
  }
}
