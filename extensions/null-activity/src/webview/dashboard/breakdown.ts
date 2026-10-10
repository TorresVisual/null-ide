'use strict';

/** One card: a ranked list of name, proportional bar (relative to the largest row), duration and percent. */
function renderBreakdown(title: string, shares: Share[]): HTMLElement {
  const widths = barScale(shares.map((share) => share.ms), 100, 0);
  const rows = shares.map((share, i) => {
    const fillBar = h('div', { class: 'fill' });
    fillBar.style.setProperty('width', `${widths[i]}%`);
    return h(
      'li',
      { class: 'row' },
      h('span', { class: 'name', title: share.name }, share.name),
      h('div', { class: 'track' }, fillBar),
      h('span', { class: 'dur' }, formatDuration(share.ms)),
      h('span', { class: 'pct' }, formatPercent(share.percent, share.ms)),
    );
  });
  return h('section', { class: 'card' }, h('h2', null, title), h('ul', { class: 'rows' }, ...rows));
}
