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

  term.onResize(function (size) {
    vscode.postMessage({ type: 'resize', cols: size.cols, rows: size.rows });
  });

  // Ctrl+V: the keydown handler fires first and posts the paste message.
  // Electron also fires a DOM paste event for Ctrl+V even after preventDefault(),
  // so we deduplicate with a flag to avoid writing to the PTY twice.
  var keyHandledPaste = false;

  term.attachCustomKeyEventHandler(function (e) {
    if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
      keyHandledPaste = true;
      vscode.postMessage({ type: 'paste' });
      return false;
    }
    if (e.type === 'keydown' && e.shiftKey && e.key === 'Insert') {
      keyHandledPaste = true;
      vscode.postMessage({ type: 'paste' });
      return false;
    }
    if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key === 'C') {
      var sel = term.getSelection();
      if (sel) {
        navigator.clipboard.writeText(sel).catch(function () {
          vscode.postMessage({ type: 'copy', text: sel });
        });
      }
      return false;
    }
    return true;
  });

  // Catches right-click paste; for Ctrl+V, skips if the key handler already fired.
  document.addEventListener('paste', function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (keyHandledPaste) { keyHandledPaste = false; return; }
    var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) {
      vscode.postMessage({ type: 'input', data: text.replace(/[\r\n]+$/, '') });
    } else {
      vscode.postMessage({ type: 'paste' });
    }
  }, true);

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
    vscode.postMessage({ type: 'restart', cols: term.cols, rows: term.rows });
  });

  // ── Messages from extension host ─────────────────────────────────────────

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (msg.type === 'started') {
      banner.style.display = 'none';
      if (msg.restore) {
        term.write(msg.restore);
        var now = new Date();
        var hh  = String(now.getHours()).padStart(2, '0');
        var mm  = String(now.getMinutes()).padStart(2, '0');
        term.write('\r\n\x1b[38;5;240m── restored ' + hh + ':' + mm + ' ──\x1b[0m\r\n\r\n');
      }
      term.focus();
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
