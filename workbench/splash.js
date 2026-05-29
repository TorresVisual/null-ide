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

    /* ── SVG draw-in animations ── */
    '@keyframes ns-circle-draw{from{stroke-dashoffset:170}to{stroke-dashoffset:0}}',
    '@keyframes ns-path-draw{from{stroke-dashoffset:71}to{stroke-dashoffset:0}}',
    '#null-splash circle{stroke-dasharray:170;stroke-dashoffset:170}',
    '#null-splash .ns-slash{stroke-dasharray:71;stroke-dashoffset:71}',
    '#null-splash.ns-in circle{',
      'animation:ns-circle-draw 0.7s ease-out forwards;',
    '}',
    '#null-splash.ns-in .ns-slash{',
      'animation:ns-path-draw 0.4s ease-out 0.35s forwards;',
    '}',

    /* ── "null" letter stagger ── */
    '@keyframes ns-char-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}',
    '#null-splash .ns-word{',
      'color:rgba(255,255,255,0.55);',
      'font-family:"Geist Mono","JetBrains Mono","Cascadia Code",ui-monospace,monospace;',
      'font-size:11px;letter-spacing:0.3em;text-transform:lowercase;',
    '}',
    '#null-splash .ns-char{opacity:0;display:inline-block;transform:translateY(4px)}',
    '#null-splash.ns-in .ns-char:nth-child(1){animation:ns-char-in 0.3s ease-out 0.60s forwards}',
    '#null-splash.ns-in .ns-char:nth-child(2){animation:ns-char-in 0.3s ease-out 0.65s forwards}',
    '#null-splash.ns-in .ns-char:nth-child(3){animation:ns-char-in 0.3s ease-out 0.70s forwards}',
    '#null-splash.ns-in .ns-char:nth-child(4){animation:ns-char-in 0.3s ease-out 0.75s forwards}',
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

    var slash = svgAttr(document.createElementNS(SVG_NS, 'path'),
      { d: 'M75,25L25,75', fill: 'none', stroke: 'white', 'stroke-width': '7', 'stroke-linecap': 'round' });
    slash.setAttribute('class', 'ns-slash');
    svg.appendChild(slash);

    var word = document.createElement('div');
    word.className = 'ns-word';
    'null'.split('').forEach(function (ch) {
      var span = document.createElement('span');
      span.className = 'ns-char';
      span.textContent = ch;
      word.appendChild(span);
    });

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
