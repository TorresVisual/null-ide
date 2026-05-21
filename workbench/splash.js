// ── Splash screen ──────────────────────────────────────────────────────────
(function () {
  var CSS = [
    '#null-splash{',
      'position:fixed;inset:0;z-index:99999;',
      'background:#181818;',
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;',
      'opacity:0;transition:opacity 0.25s ease;',
    '}',
    '#null-splash.ns-in{opacity:1}',
    '#null-splash.ns-out{opacity:0}',
    '#null-splash .ns-word{',
      'color:rgba(255,255,255,0.55);',
      'font-family:"Geist Mono","JetBrains Mono","Cascadia Code",ui-monospace,monospace;',
      'font-size:11px;letter-spacing:0.3em;text-transform:lowercase;',
    '}',
  ].join('');

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgAttr(el, attrs) {
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  }

  var styleEl, splashEl;

  function mount() {
    styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    var svg = svgAttr(document.createElementNS(SVG_NS, 'svg'),
      { viewBox: '0 0 100 100', width: '64', height: '64' });
    svg.appendChild(svgAttr(document.createElementNS(SVG_NS, 'circle'),
      { cx: '50', cy: '50', r: '27', fill: 'none', stroke: 'white', 'stroke-width': '7', 'stroke-linecap': 'round' }));
    svg.appendChild(svgAttr(document.createElementNS(SVG_NS, 'line'),
      { x1: '75', y1: '25', x2: '25', y2: '75', stroke: 'white', 'stroke-width': '7', 'stroke-linecap': 'round' }));

    var word = document.createElement('div');
    word.className = 'ns-word';
    word.textContent = 'null';

    splashEl = document.createElement('div');
    splashEl.id = 'null-splash';
    splashEl.appendChild(svg);
    splashEl.appendChild(word);
    document.body.appendChild(splashEl);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () { splashEl.classList.add('ns-in'); });
    });
  }

  function dismiss() {
    if (!splashEl || !splashEl.parentNode) return;
    splashEl.classList.remove('ns-in');
    splashEl.classList.add('ns-out');
    splashEl.addEventListener('transitionend', function () {
      splashEl.remove();
      styleEl.remove();
    }, { once: true });
  }

  function watchReady() {
    var obs = new MutationObserver(function () {
      if (document.querySelector('.part.statusbar')) {
        obs.disconnect();
        setTimeout(dismiss, 120);
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(dismiss, 8000);
  }

  if (document.body) { mount(); watchReady(); }
  else { document.addEventListener('DOMContentLoaded', function () { mount(); watchReady(); }); }
}());
