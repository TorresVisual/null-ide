(function () {
  var vscode     = acquireVsCodeApi();
  var banner     = document.getElementById('banner');
  var bannerMsg  = document.getElementById('banner-msg');
  var restartBtn = document.getElementById('restart-btn');

  var currentAgent = 'claude';

  var term = new Terminal({
    cursorBlink: true,
    fontFamily:  '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
    fontSize:    13,
    lineHeight:  1.4,
    scrollback:  5000,
    theme: {
      background:    '#181818', foreground:    '#CCCCCC',
      cursor:        '#0078D4', cursorAccent:  '#181818',
      black:         '#1E1E1E', brightBlack:   '#808080',
      red:           '#F44747', brightRed:     '#F44747',
      green:         '#4EC9B0', brightGreen:   '#4EC9B0',
      yellow:        '#DCDCAA', brightYellow:  '#DCDCAA',
      blue:          '#569CD6', brightBlue:    '#569CD6',
      magenta:       '#C586C0', brightMagenta: '#C586C0',
      cyan:          '#9CDCFE', brightCyan:    '#9CDCFE',
      white:         '#D4D4D4', brightWhite:   '#FFFFFF',
    },
  });

  var fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('term'));
  fitAddon.fit();

  new ResizeObserver(function () { fitAddon.fit(); })
    .observe(document.getElementById('wrap'));

  term.onData(function (data) {
    vscode.postMessage({ type: 'input', data: data });
  });

  // VS Code intercepts Ctrl+V before it reaches xterm.js in webviews.
  // Catch the DOM paste event instead and forward the text directly to the pty.
  document.addEventListener('paste', function (e) {
    var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) {
      e.preventDefault();
      e.stopPropagation();
      vscode.postMessage({ type: 'input', data: text });
    }
  });

  term.onResize(function (size) {
    vscode.postMessage({ type: 'resize', cols: size.cols, rows: size.rows });
  });

  // ── Agent tabs ───────────────────────────────────────────────────────────

  document.getElementById('tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    var agent = tab.dataset.agent;
    if (agent === currentAgent) return;

    document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    currentAgent = agent;

    banner.style.display = 'none';
    term.reset();
    vscode.postMessage({ type: 'launch', agent: agent, cols: term.cols, rows: term.rows });
  });

  // ── Restart button ───────────────────────────────────────────────────────

  restartBtn.addEventListener('click', function () {
    banner.style.display = 'none';
    term.reset();
    vscode.postMessage({ type: 'launch', agent: currentAgent, cols: term.cols, rows: term.rows });
  });

  // ── Messages from extension host ─────────────────────────────────────────

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (msg.type === 'started') {
      banner.style.display = 'none';
    } else if (msg.type === 'data') {
      banner.style.display = 'none';
      term.write(msg.text);
    } else if (msg.type === 'exit') {
      bannerMsg.textContent = msg.code === 0 ? 'session ended' : 'exited (code ' + msg.code + ')';
      restartBtn.style.display = '';
      banner.style.display = 'flex';
    } else if (msg.type === 'error') {
      bannerMsg.textContent = 'error: ' + msg.message;
      restartBtn.style.display = '';
      banner.style.display = 'flex';
    }
  });

  // Send initial dimensions so the PTY spawns at the right size.
  vscode.postMessage({ type: 'ready', agent: currentAgent, cols: term.cols, rows: term.rows });
}());
