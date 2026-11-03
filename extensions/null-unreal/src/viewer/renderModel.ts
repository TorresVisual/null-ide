// Material export -> a UI-agnostic graph model. Pure: the SVG renderer and any later graph view read this, not the export.
import { nodeFamily } from './colors';

export interface RPin { name: string; type: number | null; x: number; y: number; side: 'in' | 'out' }

export interface RNode {
  id: number;
  label: string;
  family: string;
  shape: 'node' | 'reroute' | 'result';
  x: number;
  y: number;
  w: number;
  h: number;
  inputs: RPin[];
  outputs: RPin[];
  props: Record<string, unknown>;
}

// `from.node` is -2 for a link whose source is unreadable or out of range; `missing` is then true and the renderer draws a stub.
export interface RLink { from: { node: number; pin: string }; to: { node: number; pin: string }; missing: boolean }

export interface RenderModel {
  nodes: RNode[];
  links: RLink[];
  bounds: { x: number; y: number; w: number; h: number };
  notes: string[];
  expressionCount: number;
}

const NODE_W = 180;
const HEAD_H = 32;
const PIN_H = 20;
const REROUTE = 16;
export const RESULT_ID = -1;
export const MISSING_NODE = -2;

type Link = { from: unknown; pin?: unknown };
interface Expr {
  class?: unknown;
  x?: unknown;
  y?: unknown;
  inputs?: { name?: unknown; type?: unknown; link?: Link | null }[];
  outputs?: { name?: unknown; type?: unknown }[];
  props?: unknown;
}

const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const typeOf = (v: unknown): number | null => (typeof v === 'number' ? v : null);

export function buildRenderModel(data: Record<string, unknown>): RenderModel {
  const exprs = Array.isArray(data.expressions) ? (data.expressions as Expr[]) : [];
  const outputs = Array.isArray(data.outputs) ? (data.outputs as ({ name?: unknown; link?: Link | null } | null)[]) : [];
  const notes: string[] = [];
  const links: RLink[] = [];
  let missingCount = 0;

  const addLink = (from: unknown, pin: unknown, to: RLink['to']) => {
    const n = typeof from === 'number' && Number.isInteger(from) && from >= 0 && from < exprs.length ? from : undefined;
    if (n === undefined) {
      missingCount++;
      links.push({ from: { node: MISSING_NODE, pin: '' }, to, missing: true });
    } else {
      links.push({ from: { node: n, pin: str(pin) }, to, missing: false });
    }
  };

  const nodes: RNode[] = exprs.map((e, id) => {
    const cls = str(e.class, 'Unknown');
    const isReroute = cls.endsWith('Reroute');
    const inputs = Array.isArray(e.inputs) ? e.inputs : [];
    const outs = Array.isArray(e.outputs) ? e.outputs : [];
    const x = num(e.x);
    const y = num(e.y);
    const w = isReroute ? REROUTE : NODE_W;
    const h = isReroute ? REROUTE : HEAD_H + PIN_H * Math.max(inputs.length, outs.length);
    const pinY = (i: number) => y + HEAD_H / 2 + PIN_H * i + PIN_H / 2;
    const inPins: RPin[] = inputs.map((p, i) => ({ name: str(p.name), type: typeOf(p.type), x, y: pinY(i), side: 'in' }));
    const outPins: RPin[] = outs.map((p, i) => ({ name: str(p.name), type: typeOf(p.type), x: x + w, y: pinY(i), side: 'out' }));
    for (const p of inputs) if (p.link) addLink(p.link.from, p.link.pin, { node: id, pin: str(p.name) });
    return {
      id,
      label: cls.replace(/^MaterialExpression/, ''),
      family: isReroute ? 'utility' : nodeFamily(cls),
      shape: isReroute ? 'reroute' : 'node',
      x,
      y,
      w,
      h,
      inputs: inPins,
      outputs: outPins,
      props: (e.props && typeof e.props === 'object' ? e.props : {}) as Record<string, unknown>,
    };
  });

  // The result node sits right of the right-most expression and has one input per material output property.
  const right = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
  const resultX = nodes.length ? right + 80 : 0;
  const resultPins: RPin[] = outputs.map((o, i) => ({
    name: str(o?.name),
    type: null,
    x: resultX,
    y: HEAD_H / 2 + PIN_H * i + PIN_H / 2,
    side: 'in',
  }));
  const result: RNode = {
    id: RESULT_ID,
    label: 'Material',
    family: 'other',
    shape: 'result',
    x: resultX,
    y: 0,
    w: NODE_W,
    h: HEAD_H + PIN_H * Math.max(outputs.length, 1),
    inputs: resultPins,
    outputs: [],
    props: {},
  };
  outputs.forEach((o) => {
    if (o?.link) addLink(o.link.from, o.link.pin, { node: RESULT_ID, pin: str(o.name) });
  });

  if (missingCount > 0) notes.push(`${missingCount} link(s) to unreadable expressions`);

  const all = [...nodes, result];
  const minX = Math.min(...all.map((n) => n.x));
  const minY = Math.min(...all.map((n) => n.y));
  const maxX = Math.max(...all.map((n) => n.x + n.w));
  const maxY = Math.max(...all.map((n) => n.y + n.h));
  return {
    nodes: all,
    links,
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    notes,
    expressionCount: exprs.length,
  };
}
