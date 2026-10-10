'use strict';

const GRAPH_HEIGHT = 120; // viewBox height; the SVG is stretched to the container by CSS
const BAR_SLOT = 10;

/** Inline-SVG bars scaled to the largest bucket; every bar is focusable, with a hover/focus tooltip. */
function renderGraph(model: DashboardModel): HTMLElement {
  const bars = model.bars;
  const heights = barScale(bars.map((b) => b.ms), GRAPH_HEIGHT, 2);
  const tip = h('div', { class: 'tip', role: 'tooltip', hidden: true });
  const centre = (i: number) => `${((i + 0.5) / bars.length) * 100}%`;

  const rects = bars.map((bar, i) => {
    const rect = s('rect', {
      class: 'bar',
      x: i * BAR_SLOT + 1,
      y: GRAPH_HEIGHT - heights[i],
      width: BAR_SLOT - 2,
      height: heights[i],
      tabindex: 0,
      role: 'img',
      'aria-label': barLabel(bar),
    });
    const show = () => {
      tip.textContent = barLabel(bar);
      tip.style.setProperty('left', centre(i));
      tip.hidden = false;
    };
    const hide = () => {
      tip.hidden = true;
    };
    rect.addEventListener('mouseenter', show);
    rect.addEventListener('focus', show);
    rect.addEventListener('mouseleave', hide);
    rect.addEventListener('blur', hide);
    return rect;
  });

  const svg = s(
    'svg',
    {
      class: 'graph-svg',
      viewBox: `0 0 ${bars.length * BAR_SLOT} ${GRAPH_HEIGHT}`,
      preserveAspectRatio: 'none',
      role: 'group',
      'aria-label': 'Activity graph',
    },
    ...rects,
  );

  const ticks = axisTicks(bars.length, 6).map((i) => {
    const tick = h('span', { class: 'tick' }, bars[i].label);
    tick.style.setProperty('left', centre(i));
    return tick;
  });

  return h('section', { class: 'graph' }, h('div', { class: 'plot' }, svg, tip), h('div', { class: 'axis' }, ...ticks));
}
