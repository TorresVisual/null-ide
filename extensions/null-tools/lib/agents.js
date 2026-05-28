(function () {
  var vscode      = acquireVsCodeApi();
  var tabListEl   = document.getElementById('tab-list');
  var historyBtn  = document.getElementById('history-btn');
  var addBtn      = document.getElementById('add-btn');
  var picker      = document.getElementById('agent-picker');
  var wrap        = document.getElementById('wrap');
  var historyView = document.getElementById('history-view');
  var historyList = document.getElementById('history-list');
  var historyBack = document.getElementById('history-back');
  var banner      = document.getElementById('banner');
  var bannerMsg   = document.getElementById('banner-msg');
  var saveBtn     = document.getElementById('save-btn');
  var restartBtn  = document.getElementById('restart-btn');

  var currentTermId = null;
  var tabOrder      = [];
  var terminals     = {};
  var fitAddons     = {};
  var terminated    = {};
  var sessions      = {};    // termId → [{ id, savedAt, preview }]
  var exitMessages  = {};

  var termOpts = {
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
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  var keyHandledPaste = false;

  function fmtSession(savedAt) {
    var d   = new Date(savedAt);
    var now = new Date();
    var hh  = String(d.getHours()).padStart(2, '0');
    var mm  = String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) return 'today ' + hh + ':' + mm;
    var yest = new Date(+now - 86400000);
    if (d.toDateString() === yest.toDateString()) return 'yesterday ' + hh + ':' + mm;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh + ':' + mm;
  }

  function updateBanner(id) {
    if (terminated[id]) {
      bannerMsg.textContent    = exitMessages[id] || 'session ended';
      bannerMsg.style.display  = '';
      saveBtn.style.display    = 'none';
      restartBtn.style.display = '';
    } else {
      bannerMsg.style.display  = 'none';
      restartBtn.style.display = 'none';
      saveBtn.style.display    = '';
    }
  }

  function makeKeyHandler(termId) {
    return function (e) {
      if (e.type === 'keydown' && e.ctrlKey && e.key === 'v') {
        keyHandledPaste = true;
        vscode.postMessage({ type: 'paste', termId: termId });
        return false;
      }
      if (e.type === 'keydown' && e.shiftKey && e.key === 'Insert') {
        keyHandledPaste = true;
        vscode.postMessage({ type: 'paste', termId: termId });
        return false;
      }
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key === 'C') {
        var sel = terminals[termId] && terminals[termId].getSelection();
        if (sel) {
          navigator.clipboard.writeText(sel).catch(function () {
            vscode.postMessage({ type: 'copy', text: sel });
          });
        }
        return false;
      }
      return true;
    };
  }

  // ── History overlay ────────────────────────────────────────────────────────

  function showHistory(termId) {
    var list = (sessions[termId] || []).slice().reverse();
    historyList.innerHTML = '';

    if (list.length === 0) {
      var empty = document.createElement('div');
      empty.id = 'history-empty';
      empty.textContent = 'no sessions saved yet — sessions are saved automatically when a terminal exits';
      historyList.appendChild(empty);
    } else {
      list.forEach(function (s) {
        var item = document.createElement('div');
        item.className = 'hist-item';

        var nameEl = document.createElement('div');
        nameEl.className   = 'hist-name';
        nameEl.textContent = s.name || fmtSession(s.savedAt);
        item.appendChild(nameEl);

        var timeEl = document.createElement('div');
        timeEl.className   = 'hist-time';
        timeEl.textContent = fmtSession(s.savedAt);
        item.appendChild(timeEl);

        if (s.preview) {
          var pre = document.createElement('div');
          pre.className   = 'hist-preview';
          pre.textContent = s.preview;
          item.appendChild(pre);
        }

        item.addEventListener('click', function () {
          vscode.postMessage({ type: 'loadSession', termId: termId, sessionId: s.id });
        });
        historyList.appendChild(item);
      });
    }

    wrap.style.display        = 'none';
    historyView.style.display = 'flex';
  }

  function hideHistory() {
    historyView.style.display = 'none';
    wrap.style.display        = '';
    if (currentTermId && terminals[currentTermId]) terminals[currentTermId].focus();
  }

  historyBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (historyView.style.display === 'flex') { hideHistory(); return; }
    if (currentTermId) showHistory(currentTermId);
  });

  historyBack.addEventListener('click', hideHistory);

  // ── Tab / terminal lifecycle ───────────────────────────────────────────────

  function createTab(id, agentType, label, tabSessions) {
    terminated[id]   = false;
    exitMessages[id] = null;
    sessions[id]     = tabSessions || [];

    var t  = new Terminal(termOpts);
    var fa = new FitAddon.FitAddon();
    t.loadAddon(fa);

    var pane = document.createElement('div');
    pane.id        = 'term-' + id;
    pane.className = 'term-pane';
    wrap.appendChild(pane);
    t.open(pane);

    t.onData(function (d) { vscode.postMessage({ type: 'input', termId: id, data: d }); });
    t.onResize(function (sz) { vscode.postMessage({ type: 'resize', termId: id, cols: sz.cols, rows: sz.rows }); });
    t.attachCustomKeyEventHandler(makeKeyHandler(id));

    terminals[id] = t;
    fitAddons[id] = fa;
    tabOrder.push(id);

    var btn = document.createElement('button');
    btn.className    = 'tab';
    btn.id           = 'tab-btn-' + id;
    btn.dataset.id   = id;
    btn.dataset.type = agentType;

    var labelSpan = document.createElement('span');
    labelSpan.className   = 'tab-label';
    labelSpan.textContent = label;

    var closeSpan = document.createElement('span');
    closeSpan.className   = 'tab-close';
    closeSpan.textContent = '×';
    closeSpan.title       = 'Close';
    closeSpan.addEventListener('click', function (e) {
      e.stopPropagation();
      closeTab(id);
    });

    btn.appendChild(labelSpan);
    btn.appendChild(closeSpan);
    tabListEl.appendChild(btn);
  }

  function closeTab(id) {
    var idx    = tabOrder.indexOf(id);
    var nextId = tabOrder[idx + 1] || tabOrder[idx - 1] || null;

    if (terminals[id]) { terminals[id].dispose(); delete terminals[id]; }
    delete fitAddons[id];
    delete terminated[id];
    delete sessions[id];
    delete exitMessages[id];
    tabOrder.splice(idx, 1);

    var btn = document.getElementById('tab-btn-' + id);
    if (btn) btn.remove();
    var pane = document.getElementById('term-' + id);
    if (pane) pane.remove();

    vscode.postMessage({ type: 'close', termId: id });

    if (id === currentTermId) {
      currentTermId = null;
      hideHistory();
      if (nextId) switchTo(nextId);
    }
  }

  function switchTo(id) {
    document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
    var btn = document.getElementById('tab-btn-' + id);
    if (btn) btn.classList.add('active');

    document.querySelectorAll('.term-pane').forEach(function (p) { p.classList.remove('active'); });
    var pane = document.getElementById('term-' + id);
    if (pane) pane.classList.add('active');

    currentTermId = id;
    hideHistory();

    if (fitAddons[id]) fitAddons[id].fit();

    updateBanner(id);

    vscode.postMessage({
      type:      'launch',
      termId:    id,
      agentType: btn ? btn.dataset.type : 'claude',
      cols:      terminals[id] ? terminals[id].cols : 80,
      rows:      terminals[id] ? terminals[id].rows : 24,
    });
  }

  // ── Tab bar ────────────────────────────────────────────────────────────────

  tabListEl.addEventListener('click', function (e) {
    if (e.target.closest('.tab-close')) return;
    var btn = e.target.closest('.tab');
    if (!btn || btn.dataset.id === currentTermId) return;
    switchTo(btn.dataset.id);
  });

  addBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (picker.style.display === 'block') { picker.style.display = 'none'; return; }
    var rect = addBtn.getBoundingClientRect();
    picker.style.top   = rect.bottom + 'px';
    picker.style.left  = 'auto';
    picker.style.right = (window.innerWidth - rect.right) + 'px';
    picker.style.display = 'block';
  });

  picker.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-type]');
    if (!btn) return;
    picker.style.display = 'none';
    vscode.postMessage({ type: 'spawn', agentType: btn.dataset.type });
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#add-btn') && !e.target.closest('#agent-picker'))
      picker.style.display = 'none';
  });

  // ── Banner ─────────────────────────────────────────────────────────────────

  saveBtn.addEventListener('click', function () {
    if (currentTermId) vscode.postMessage({ type: 'saveSession', termId: currentTermId });
  });

  restartBtn.addEventListener('click', function () {
    if (!currentTermId || !terminals[currentTermId]) return;
    terminals[currentTermId].reset();
    terminated[currentTermId]   = false;
    exitMessages[currentTermId] = null;
    updateBanner(currentTermId);
    var tabBtn = document.getElementById('tab-btn-' + currentTermId);
    vscode.postMessage({
      type:      'restart',
      termId:    currentTermId,
      agentType: tabBtn ? tabBtn.dataset.type : 'claude',
      cols:      terminals[currentTermId].cols,
      rows:      terminals[currentTermId].rows,
    });
  });

  // ── Paste ──────────────────────────────────────────────────────────────────

  document.addEventListener('paste', function (e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (keyHandledPaste) { keyHandledPaste = false; return; }
    if (!currentTermId) return;
    var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (text) {
      vscode.postMessage({ type: 'input', termId: currentTermId, data: text.replace(/[\r\n]+$/, '') });
    } else {
      vscode.postMessage({ type: 'paste', termId: currentTermId });
    }
  }, true);

  // ── Resize ─────────────────────────────────────────────────────────────────

  new ResizeObserver(function () {
    if (currentTermId && fitAddons[currentTermId]) fitAddons[currentTermId].fit();
  }).observe(wrap);

  // ── Messages from extension host ───────────────────────────────────────────

  window.addEventListener('message', function (ev) {
    var msg = ev.data;

    if (msg.type === 'initTabs') {
      msg.tabs.forEach(function (t) { createTab(t.id, t.type, t.label, t.sessions); });
      var activeId = msg.activeId || (msg.tabs.length > 0 ? msg.tabs[0].id : null);
      if (activeId) switchTo(activeId);

    } else if (msg.type === 'tabCreated') {
      createTab(msg.id, msg.agentType, msg.label, []);
      switchTo(msg.id);

    } else if (msg.type === 'started') {
      if (msg.sessions) sessions[msg.termId] = msg.sessions;
      terminated[msg.termId]   = false;
      exitMessages[msg.termId] = null;
      if (msg.restore && terminals[msg.termId]) {
        terminals[msg.termId].write('\x1b[?1049l\x1b[0m');
        terminals[msg.termId].write(msg.restore);
        var now = new Date();
        var hh  = String(now.getHours()).padStart(2, '0');
        var mm  = String(now.getMinutes()).padStart(2, '0');
        terminals[msg.termId].write('\r\n\x1b[38;5;240m── restored ' + hh + ':' + mm + ' ──\x1b[0m\r\n\r\n');
      }
      if (msg.termId === currentTermId) {
        updateBanner(msg.termId);
        terminals[msg.termId].focus();
      }

    } else if (msg.type === 'resumed') {
      // no-op

    } else if (msg.type === 'data') {
      if (terminals[msg.termId]) terminals[msg.termId].write(msg.text);

    } else if (msg.type === 'exit') {
      terminated[msg.termId]   = true;
      exitMessages[msg.termId] = msg.code === 0 ? 'session ended' : 'exited (' + msg.code + ')';
      if (msg.termId === currentTermId) updateBanner(msg.termId);

    } else if (msg.type === 'error') {
      terminated[msg.termId]   = true;
      exitMessages[msg.termId] = 'error: ' + msg.message;
      if (msg.termId === currentTermId) updateBanner(msg.termId);

    } else if (msg.type === 'sessionSaved') {
      sessions[msg.termId] = msg.sessions;

    } else if (msg.type === 'sessionContent') {
      if (terminals[msg.termId]) {
        terminals[msg.termId].reset();
        if (msg.content) {
          terminals[msg.termId].write('\x1b[?1049l\x1b[0m');
          terminals[msg.termId].write(msg.content);
        }
      }
      hideHistory();
    }
  });

  vscode.postMessage({ type: 'ready' });
}());
