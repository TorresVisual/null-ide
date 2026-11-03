"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MISSING_NODE = exports.RESULT_ID = void 0;
exports.buildRenderModel = buildRenderModel;
// Material export -> a UI-agnostic graph model. Pure: the SVG renderer and any later graph view read this, not the export.
const colors_1 = require("./colors");
const NODE_W = 180;
const HEAD_H = 32;
const PIN_H = 20;
const REROUTE = 16;
exports.RESULT_ID = -1;
exports.MISSING_NODE = -2;
const num = (v, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
const typeOf = (v) => (typeof v === 'number' ? v : null);
function buildRenderModel(data) {
    const exprs = Array.isArray(data.expressions) ? data.expressions : [];
    const outputs = Array.isArray(data.outputs) ? data.outputs : [];
    const notes = [];
    const links = [];
    let missingCount = 0;
    const addLink = (from, pin, to) => {
        const n = typeof from === 'number' && Number.isInteger(from) && from >= 0 && from < exprs.length ? from : undefined;
        if (n === undefined) {
            missingCount++;
            links.push({ from: { node: exports.MISSING_NODE, pin: '' }, to, missing: true });
        }
        else {
            links.push({ from: { node: n, pin: str(pin) }, to, missing: false });
        }
    };
    const nodes = exprs.map((e, id) => {
        const cls = str(e.class, 'Unknown');
        const isReroute = cls.endsWith('Reroute');
        const inputs = Array.isArray(e.inputs) ? e.inputs : [];
        const outs = Array.isArray(e.outputs) ? e.outputs : [];
        const x = num(e.x);
        const y = num(e.y);
        const w = isReroute ? REROUTE : NODE_W;
        const h = isReroute ? REROUTE : HEAD_H + PIN_H * Math.max(inputs.length, outs.length);
        const pinY = (i) => y + HEAD_H / 2 + PIN_H * i + PIN_H / 2;
        const inPins = inputs.map((p, i) => ({ name: str(p.name), type: typeOf(p.type), x, y: pinY(i), side: 'in' }));
        const outPins = outs.map((p, i) => ({ name: str(p.name), type: typeOf(p.type), x: x + w, y: pinY(i), side: 'out' }));
        for (const p of inputs)
            if (p.link)
                addLink(p.link.from, p.link.pin, { node: id, pin: str(p.name) });
        return {
            id,
            label: cls.replace(/^MaterialExpression/, ''),
            family: isReroute ? 'utility' : (0, colors_1.nodeFamily)(cls),
            shape: isReroute ? 'reroute' : 'node',
            x,
            y,
            w,
            h,
            inputs: inPins,
            outputs: outPins,
            props: (e.props && typeof e.props === 'object' ? e.props : {}),
        };
    });
    // The result node sits right of the right-most expression and has one input per material output property.
    const right = nodes.reduce((m, n) => Math.max(m, n.x + n.w), 0);
    const resultX = nodes.length ? right + 80 : 0;
    const resultPins = outputs.map((o, i) => ({
        name: str(o?.name),
        type: null,
        x: resultX,
        y: HEAD_H / 2 + PIN_H * i + PIN_H / 2,
        side: 'in',
    }));
    const result = {
        id: exports.RESULT_ID,
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
        if (o?.link)
            addLink(o.link.from, o.link.pin, { node: exports.RESULT_ID, pin: str(o.name) });
    });
    if (missingCount > 0)
        notes.push(`${missingCount} link(s) to unreadable expressions`);
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
//# sourceMappingURL=renderModel.js.map