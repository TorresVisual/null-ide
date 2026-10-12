'use strict';

function timelineBar(x1: number, x2: number, y: number, cls: string, title: string): SVGElement {
  return s('rect', { x: x1, y, width: Math.max(1.5, x2 - x1), height: 14, class: cls }, s('title', null, title));
}

/** Gantt strip: one row per measured phase, then packed lanes of extension activations, milestones as vertical lines. */
function renderTimeline(m: ReportViewModel): SVGElement {
  const W = 1000;
  const ROW = 17;
  const TOP = 18;
  const x = (ms: number) => (pct(ms, m.spanMs) / 100) * W;

  const phases = m.phases.filter((p) => p.startMs !== undefined && p.endMs !== undefined);
  const exts = m.extensions.filter((e) => e.startMs !== undefined && e.endMs !== undefined);
  const lanes = exts.reduce((n, e) => Math.max(n, e.lane + 1), 0);
  const H = TOP + (phases.length + lanes) * ROW + 6;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'timeline', role: 'img', 'aria-label': 'Startup timeline' });
  phases.forEach((p, i) => svg.appendChild(timelineBar(x(p.startMs!), x(p.endMs!), TOP + i * ROW, 'bar phase', `${p.label}: ${formatMs(p.durationMs)}`)));
  exts.forEach((e) => {
    const cls = 'bar ext' + (e.deferred ? ' deferred' : '') + (e.slow ? ' slow' : '');
    svg.appendChild(timelineBar(x(e.startMs!), x(e.endMs!), TOP + (phases.length + e.lane) * ROW, cls, `${e.id}: ${formatMs(e.totalMs)}${e.deferred ? ' (deferred)' : ''}`));
  });
  m.milestones.forEach((ms) => {
    if (ms.atMs === undefined) return;
    const mx = x(ms.atMs);
    svg.appendChild(s('line', { x1: mx, x2: mx, y1: 12, y2: H, class: 'milestone' }));
    svg.appendChild(s('text', { x: Math.min(mx + 3, W - 90), y: 10, class: 'milestone-label' }, ms.label));
  });
  return svg;
}
