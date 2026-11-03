import { describe } from '../src/viewer/value';
import { resolveParams, ParamRow, ParamSource } from '../src/viewer/instance';
import { boneTree, BoneNode } from '../src/viewer/tree';
import type { ToWebview } from '../src/viewer/messages';
import { Frame, mountFrame } from './frame';
import { renderTree, row } from './rows';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Parameter values: a texture shows its thumbnail when cached, a placeholder otherwise.
function valueCell(p: ParamRow, thumbs: Record<string, string | null>): HTMLElement {
  const cell = el('td');
  if (p.type === 'texture' && typeof p.value === 'string') {
    const src = thumbs[p.value];
    if (src) {
      const img = el('img', 'thumb');
      img.src = src;
      img.alt = p.value;
      cell.append(img);
    } else {
      cell.append(el('span', 'placeholder', `${p.value} (not cached)`));
    }
    return cell;
  }
  cell.textContent = typeof p.value === 'object' && p.value !== null && !('unreadable' in p.value) ? JSON.stringify(p.value) : describe(p.value);
  return cell;
}

function renderInstance(m: Extract<ToWebview, { type: 'ready' }>, frame: Frame): void {
  const extra = (m.extra ?? { chain: [], thumbs: {} }) as {
    chain: (ParamSource & { package: string })[];
    thumbs: Record<string, string | null>;
  };
  const { rows, complete } = resolveParams({ kind: m.kind, data: m.data }, extra.chain);

  if (typeof m.data.parent === 'string') {
    const parent = el('button', undefined, `Parent: ${m.data.parent}`);
    parent.type = 'button';
    parent.addEventListener('click', () => frame.send({ type: 'openAsset', package: m.data.parent as string }));
    frame.body.append(parent);
  }
  if (!complete) {
    frame.body.append(el('p', 'note', 'Parent not cached: only the instance’s own overrides are shown. Open the parent to see inherited values.'));
  }

  const table = el('table', 'params');
  const head = el('tr');
  for (const h of ['Name', 'Type', 'Value', 'Source']) head.append(el('th', undefined, h));
  table.append(head);
  for (const p of rows) {
    const tr = el('tr');
    tr.append(el('td', undefined, p.name), el('td', undefined, p.type), valueCell(p, extra.thumbs), el('td', undefined, p.source));
    table.append(tr);
  }
  frame.body.append(table);
}

function boneList(nodes: BoneNode[]): HTMLElement {
  const ul = el('ul', 'bones');
  for (const n of nodes) {
    const li = el('li');
    li.append(el('span', undefined, n.name));
    if (n.children.length > 0) li.append(boneList(n.children));
    ul.append(li);
  }
  return ul;
}

function renderSkeleton(data: Record<string, unknown>, into: HTMLElement): void {
  const bones = Array.isArray(data.bones) ? (data.bones as { name: string; parent: unknown }[]) : [];
  into.append(el('p', 'note', `${bones.length} bones`));
  into.append(boneList(boneTree(bones)));
}

const frame = mountFrame((m: ToWebview) => {
  if (m.type !== 'ready') return;
  if (m.kind === 'material-instance') renderInstance(m, frame);
  else if (m.kind === 'skeleton') renderSkeleton(m.data, frame.body);
  else renderTree(m.data, frame.body);
});
