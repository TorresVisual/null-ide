import { familyColor, Family, pinColor } from '../src/viewer/colors';
import { fitView, hitNode, linkPath, View, zoomAbout } from '../src/viewer/geometry';
import { buildRenderModel, RenderModel, RLink, RNode, RESULT_ID } from '../src/viewer/renderModel';
import { describe } from '../src/viewer/value';
import type { Layout, ToWebview } from '../src/viewer/messages';
import { Frame, mountFrame } from './frame';

const SVG = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

interface Ui {
  model: RenderModel;
  thumbs: Record<string, string | null>;
  view: View;
  selected?: number;
  list: boolean;
  notes: string[];
  fitted: boolean;
  // Dragged positions as offsets from the exported layout, so a re-export that moves a node still keeps the rest.
  layout: Layout;
}

// Pins hold absolute coordinates, so they move with their node.
function moveNode(n: RNode, dx: number, dy: number): void {
  n.x += dx;
  n.y += dy;
  for (const p of [...n.inputs, ...n.outputs]) {
    p.x += dx;
    p.y += dy;
  }
}

// Graph page: one SVG with the nodes and links in a single transformed group. Pan and zoom only change the group.
function renderGraph(ui: Ui, frame: Frame): void {
  const body = frame.body;
  body.replaceChildren();
  const byId = new Map(ui.model.nodes.map((n) => [n.id, n]));

  const toolbar = html('div', undefined, 'toolbar');
  const fit = html('button', 'Fit');
  const listToggle = html('button', ui.list ? 'Graph view' : 'List view');
  listToggle.setAttribute('aria-pressed', String(ui.list));
  // Wired before the list early return below, or the list view has no way back.
  listToggle.addEventListener('click', () => {
    ui.list = !ui.list;
    renderGraph(ui, frame);
  });
  toolbar.append(...(ui.list ? [] : [fit]), listToggle);
  body.append(toolbar);

  for (const note of ui.notes) {
    const banner = html('div', undefined, 'note');
    const dismiss = html('button', '×');
    dismiss.setAttribute('aria-label', 'Dismiss note');
    dismiss.addEventListener('click', () => banner.remove());
    banner.append(html('span', note), dismiss);
    body.append(banner);
  }

  if (ui.list) {
    body.append(listView(ui));
    return;
  }

  const graph = svg('svg', { class: 'graph', width: '100%', height: '100%' });
  const world = svg('g');
  graph.append(world);
  body.append(graph);

  const pinAt = (node: RNode | undefined, name: string, side: 'in' | 'out') => {
    if (!node) return undefined;
    const pins = side === 'out' ? node.outputs : node.inputs;
    return pins.find((p) => p.name === name) ?? pins[0];
  };

  // Redraws only the world group, so a drag in progress keeps its pointer capture on `graph`.
  const drawWorld = () => {
    world.replaceChildren();
    for (const l of ui.model.links) drawLink(world, l, byId, pinAt);
    for (const n of ui.model.nodes) drawNode(world, n, ui, n.id === ui.selected);
  };
  drawWorld();

  const applyView = () => world.setAttribute('transform', `translate(${ui.view.x} ${ui.view.y}) scale(${ui.view.scale})`);
  const fitAll = () => {
    // Recomputed from the nodes, since dragging and the saved layout move them off the exported bounds.
    const xs = ui.model.nodes;
    const x0 = Math.min(...xs.map((n) => n.x));
    const y0 = Math.min(...xs.map((n) => n.y));
    const b = { x: x0, y: y0, w: Math.max(...xs.map((n) => n.x + n.w)) - x0, h: Math.max(...xs.map((n) => n.y + n.h)) - y0 };
    const v = fitView({ w: b.w, h: b.h }, { w: graph.clientWidth, h: graph.clientHeight }, 24);
    ui.view = { scale: v.scale, x: v.x - b.x * v.scale, y: v.y - b.y * v.scale };
    applyView();
  };
  fit.addEventListener('click', fitAll);
  applyView();
  if (!ui.fitted) {
    ui.fitted = true;
    requestAnimationFrame(fitAll);
  }

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = graph.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    return { x: (px - ui.view.x) / ui.view.scale, y: (py - ui.view.y) / ui.view.scale, px, py };
  };

  graph.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = toWorld(e);
      ui.view = zoomAbout(ui.view, { x: p.px, y: p.py }, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      applyView();
    },
    { passive: false },
  );

  // `node` set: the drag moves that node (pins hold absolute coordinates, so they move with it); unset: it pans.
  let drag: { x: number; y: number; moved: boolean; node?: RNode } | undefined;
  graph.addEventListener('pointerdown', (e) => {
    const id = hitNode(ui.model.nodes, toWorld(e));
    drag = { x: e.clientX, y: e.clientY, moved: false, node: id === undefined ? undefined : byId.get(id) };
    graph.setPointerCapture(e.pointerId);
  });
  graph.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.node) {
      // Hold still until the threshold is crossed, so a click never nudges a node.
      if (!drag.moved) return;
      const wx = dx / ui.view.scale;
      const wy = dy / ui.view.scale;
      moveNode(drag.node, wx, wy);
      const [ox, oy] = ui.layout[drag.node.id] ?? [0, 0];
      ui.layout[drag.node.id] = [ox + wx, oy + wy];
      drawWorld();
    } else {
      ui.view = { ...ui.view, x: ui.view.x + dx, y: ui.view.y + dy };
      applyView();
    }
    drag = { ...drag, x: e.clientX, y: e.clientY };
  });
  graph.addEventListener('pointerup', (e) => {
    const wasDrag = drag?.moved;
    if (wasDrag && drag?.node) frame.send({ type: 'layout', layout: ui.layout });
    drag = undefined;
    if (wasDrag) return;
    const p = toWorld(e);
    const id = hitNode(ui.model.nodes, p);
    if (id === undefined) {
      ui.selected = undefined;
      frame.hideInspector();
    } else {
      ui.selected = id;
      showNode(ui, id, frame);
    }
    renderGraph(ui, frame);
  });
  graph.addEventListener('dblclick', (e) => {
    const p = toWorld(e);
    const id = hitNode(ui.model.nodes, p);
    const node = id === undefined ? undefined : byId.get(id);
    if (node?.family === 'texture' && typeof node.props.texture === 'string') {
      frame.send({ type: 'openAsset', package: node.props.texture });
    }
  });
}

function drawLink(
  world: SVGGElement,
  l: RLink,
  byId: Map<number, RNode>,
  pinAt: (n: RNode | undefined, name: string, side: 'in' | 'out') => { x: number; y: number } | undefined,
): void {
  const to = pinAt(byId.get(l.to.node), l.to.pin, 'in');
  if (!to) return;
  if (l.missing) {
    // An unreadable or out-of-range source is a dashed stub into the input, never a dropped link.
    world.append(svg('path', { class: 'link missing', d: linkPath({ x: to.x - 40, y: to.y }, to) }));
    return;
  }
  const from = pinAt(byId.get(l.from.node), l.from.pin, 'out');
  if (!from) return;
  world.append(svg('path', { class: 'link', d: linkPath(from, to) }));
}

function drawNode(world: SVGGElement, n: RNode, ui: Ui, selected: boolean): void {
  const g = svg('g', { class: `node ${n.shape} ${n.family}${selected ? ' selected' : ''}`, 'data-id': n.id });
  const color = familyColor(n.shape === 'result' ? 'other' : (n.family as Family));
  if (n.shape === 'reroute') {
    g.append(svg('circle', { cx: n.x + n.w / 2, cy: n.y + n.h / 2, r: 6, fill: color }));
  } else {
    g.append(svg('rect', { x: n.x, y: n.y, width: n.w, height: n.h, rx: 6, class: 'card', stroke: color }));
    g.append(svg('text', { x: n.x + 8, y: n.y + 20, class: 'label' }, n.label));
  }
  for (const p of n.inputs) {
    g.append(svg('circle', { cx: p.x, cy: p.y, r: 4, fill: pinColor(p.type) }));
    if (n.shape === 'node') g.append(svg('text', { x: p.x + 8, y: p.y + 4, class: 'pin' }, p.name));
  }
  for (const p of n.outputs) {
    g.append(svg('circle', { cx: p.x, cy: p.y, r: 4, fill: pinColor(p.type) }));
    if (n.shape === 'node') g.append(svg('text', { x: p.x - 8, y: p.y + 4, class: 'pin end' }, p.name));
  }
  const tex = n.props.texture;
  if (n.family === 'texture' && typeof tex === 'string') {
    const src = ui.thumbs[tex];
    if (src) g.append(svg('image', { href: src, x: n.x + n.w - 28, y: n.y + 4, width: 24, height: 24 }));
    else g.append(svg('text', { x: n.x + n.w - 8, y: n.y + 20, class: 'pin end' }, 'not cached'));
  }
  world.append(g);
}

function showNode(ui: Ui, id: number, frame: Frame): void {
  const n = ui.model.nodes.find((x) => x.id === id);
  if (!n) return;
  const inspector = frame.inspector;
  inspector.replaceChildren();
  inspector.append(html('h2', n.label));
  const rows: [string, string][] = [
    ['Class', n.label],
    ['Position', `${Math.round(n.x)}, ${Math.round(n.y)}`],
  ];
  for (const [k, v] of Object.entries(n.props)) {
    rows.push([k, typeof v === 'object' && v !== null && !('unreadable' in v) ? JSON.stringify(v) : describe(v)]);
  }
  for (const [k, v] of rows) {
    const r = html('div', undefined, 'row');
    r.append(html('span', k, 'key'), html('span', v, 'value'));
    inspector.append(r);
  }
  inspector.append(html('h3', 'Inputs'));
  for (const p of n.inputs) {
    const link = ui.model.links.find((l) => l.to.node === id && l.to.pin === p.name);
    const source = !link
      ? 'not connected'
      : link.missing
        ? 'not available: source is unreadable'
        : `${ui.model.nodes.find((x) => x.id === link.from.node)?.label ?? '?'}${link.from.pin ? `.${link.from.pin}` : ''}`;
    const r = html('div', undefined, 'row');
    r.append(html('span', p.name, 'key'), html('span', source, 'value'));
    inspector.append(r);
  }
  const uncached = Object.values(ui.thumbs).filter((v) => v === null).length;
  const exportBtn = html('button', `Export referenced textures (${uncached} not cached)`);
  exportBtn.addEventListener('click', () => frame.send({ type: 'exportReferenced' }));
  inspector.append(exportBtn);
  frame.showInspector();
}

// Text alternative to the graph: each node with its inputs and where they come from.
function listView(ui: Ui): HTMLElement {
  const table = html('table', undefined, 'params');
  const head = html('tr');
  for (const h of ['Node', 'Family', 'Inputs']) head.append(html('th', h));
  table.append(head);
  for (const n of ui.model.nodes) {
    if (n.id === RESULT_ID) continue;
    const tr = html('tr');
    const inputs = n.inputs
      .map((p) => {
        const l = ui.model.links.find((x) => x.to.node === n.id && x.to.pin === p.name);
        return `${p.name}: ${!l ? '—' : l.missing ? 'unreadable' : ui.model.nodes.find((x) => x.id === l.from.node)?.label ?? '?'}`;
      })
      .join('; ');
    tr.append(html('td', n.label), html('td', n.family), html('td', inputs));
    table.append(tr);
  }
  return table;
}

const frame = mountFrame((m: ToWebview) => {
  if (m.type === 'ready') {
    const model = buildRenderModel(m.data);
    // Offsets for nodes that no longer exist are dropped, so a re-export that removes one does not leave a stale entry.
    const layout: Layout = {};
    for (const n of model.nodes) {
      const o = m.layout?.[n.id];
      if (o && Number.isFinite(o[0]) && Number.isFinite(o[1])) {
        moveNode(n, o[0], o[1]);
        layout[n.id] = o;
      }
    }
    ui = { model, thumbs: {}, view: { scale: 1, x: 0, y: 0 }, list: false, notes: model.notes, fitted: false, layout };
    renderGraph(ui, frame);
  } else if (m.type === 'thumbs' && ui) {
    ui.thumbs = m.byPackage;
    renderGraph(ui, frame);
  }
});
let ui: Ui | undefined;
