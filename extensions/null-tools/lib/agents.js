"use strict";
(function () {
    var vscode = acquireVsCodeApi();
    // ── DOM refs ───────────────────────────────────────────────────────────────
    var tabListEl = document.getElementById('tab-list');
    var addBtn = document.getElementById('add-btn');
    var historyBtn = document.getElementById('history-btn');
    var historyView = document.getElementById('history-view');
    var sessionsList = document.getElementById('sessions-list');
    var sessTitle = document.getElementById('sess-title');
    var wrap = document.getElementById('wrap');
    var banner = document.getElementById('banner');
    var bannerMsg = document.getElementById('banner-msg');
    var newSessionBtn = document.getElementById('new-session-btn');
    var sessSearchEl = document.getElementById('sess-search');
    // ── State ──────────────────────────────────────────────────────────────────
    var currentTermId = null;
    var currentAgentType = 'claude';
    var historyVisible = false;
    var tabOrder = [];
    var terminals = {};
    var fitAddons = {};
    var running = {};
    var exitMsgs = {};
    var sessionsByType = {};
    var claudeCodeSessions = [];
    var pendingTabTitle = null;
    var pendingSessionLoad = null;
    var tabTitles = {};
    var searchQuery = '';
    var termOpts = {
        cursorBlink: true,
        fontFamily: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.4,
        scrollback: 5000,
        theme: {
            background: '#181818', foreground: '#CCCCCC',
            cursor: '#0078D4', cursorAccent: '#181818',
            black: '#1E1E1E', brightBlack: '#808080',
            red: '#F44747', brightRed: '#F44747',
            green: '#4EC9B0', brightGreen: '#4EC9B0',
            yellow: '#DCDCAA', brightYellow: '#DCDCAA',
            blue: '#569CD6', brightBlue: '#569CD6',
            magenta: '#C586C0', brightMagenta: '#C586C0',
            cyan: '#9CDCFE', brightCyan: '#9CDCFE',
            white: '#D4D4D4', brightWhite: '#FFFFFF',
        },
    };
    var keyHandledPaste = false;
    // ── Helpers ────────────────────────────────────────────────────────────────
    function fmtTime(iso) {
        var d = new Date(iso);
        var now = new Date();
        var hh = String(d.getHours()).padStart(2, '0');
        var mm = String(d.getMinutes()).padStart(2, '0');
        if (d.toDateString() === now.toDateString())
            return hh + ':' + mm;
        var yest = new Date(+now - 86400000);
        if (d.toDateString() === yest.toDateString())
            return 'yesterday';
        return (d.getMonth() + 1) + '/' + d.getDate();
    }
    function getDateBucket(iso) {
        var d = new Date(iso);
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var yest = new Date(+today - 86400000);
        var week = new Date(+today - 6 * 86400000);
        var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        if (+day >= +today)
            return 'today';
        if (+day >= +yest)
            return 'yesterday';
        if (+day >= +week)
            return 'this week';
        return 'earlier';
    }
    function getAgentType(tabId) {
        var btn = document.getElementById('tab-btn-' + tabId);
        return (btn && btn.dataset['type']) || 'claude';
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
    // ── Agent type bar ─────────────────────────────────────────────────────────
    function setAgentType(type) {
        currentAgentType = type;
        document.querySelectorAll('.type-btn').forEach(function (b) {
            b.classList.toggle('active', b.dataset['type'] === type);
        });
        renderTabList();
        var matching = tabOrder.filter(function (id) { return getAgentType(id) === type; });
        if (matching.length > 0) {
            var target = (currentTermId && getAgentType(currentTermId) === type)
                ? currentTermId
                : matching[matching.length - 1];
            if (historyVisible) {
                renderSessionsList(type, target);
            }
            else {
                switchTo(target);
            }
        }
        else {
            currentTermId = null;
            setSessTitle('');
            banner.style.display = 'none';
            showHistoryView(true);
        }
    }
    function renderTabList() {
        tabOrder.forEach(function (id) {
            var btn = document.getElementById('tab-btn-' + id);
            if (btn)
                btn.style.display = getAgentType(id) === currentAgentType ? '' : 'none';
        });
    }
    // ── Title bar ──────────────────────────────────────────────────────────────
    function setSessTitle(title) {
        sessTitle.textContent = title || '';
        if (currentTermId && title)
            tabTitles[currentTermId] = title;
    }
    // ── History view ───────────────────────────────────────────────────────────
    function showHistoryView(show) {
        historyVisible = show;
        historyView.style.display = show ? 'flex' : 'none';
        wrap.style.display = show ? 'none' : '';
        banner.style.display = 'none';
        historyBtn.classList.toggle('active', show);
        if (show) {
            searchQuery = '';
            sessSearchEl.value = '';
            renderSessionsList(currentAgentType, currentTermId);
        }
        else if (currentTermId && fitAddons[currentTermId]) {
            requestAnimationFrame(function () {
                if (currentTermId && fitAddons[currentTermId])
                    fitAddons[currentTermId].fit();
            });
        }
    }
    // ── Sessions list ──────────────────────────────────────────────────────────
    function makeSessItem(name, time, preview, onClick, extraClass) {
        var item = document.createElement('div');
        item.className = 'sess-item' + (extraClass ? ' ' + extraClass : '');
        var row1 = document.createElement('div');
        row1.className = 'sess-row1';
        var nameEl = document.createElement('span');
        nameEl.className = 'sess-name';
        nameEl.textContent = name;
        var timeEl = document.createElement('span');
        timeEl.className = 'sess-time';
        timeEl.textContent = time;
        row1.appendChild(nameEl);
        row1.appendChild(timeEl);
        item.appendChild(row1);
        if (preview) {
            var pre = document.createElement('div');
            pre.className = 'sess-preview';
            pre.textContent = preview;
            item.appendChild(pre);
        }
        item.addEventListener('click', onClick);
        return item;
    }
    function makeSectionHeader(label) {
        var h = document.createElement('div');
        h.className = 'cc-section-header';
        h.textContent = label;
        return h;
    }
    function makeClaudeSessItem(title, time, branch, msgCount, model, onClick) {
        var item = makeSessItem(title, time, '', onClick);
        var hasMeta = branch || msgCount > 0 || model;
        if (!hasMeta)
            return item;
        var meta = document.createElement('div');
        meta.className = 'sess-meta';
        if (branch) {
            var bs = document.createElement('span');
            bs.className = 'sess-branch';
            bs.textContent = branch;
            meta.appendChild(bs);
        }
        var parts = [];
        if (msgCount > 0)
            parts.push(msgCount + ' msg' + (msgCount !== 1 ? 's' : ''));
        if (model)
            parts.push(model.replace(/^claude-/, '').replace(/-\d{8,}$/, ''));
        if (parts.length) {
            if (branch)
                meta.appendChild(document.createTextNode(' · '));
            meta.appendChild(document.createTextNode(parts.join(' · ')));
        }
        item.appendChild(meta);
        return item;
    }
    function renderWithGroups(container, entries) {
        if (searchQuery || entries.length === 0) {
            entries.forEach(function (e) { container.appendChild(e.el); });
            return;
        }
        var bucketOrder = ['today', 'yesterday', 'this week', 'earlier'];
        var groups = {};
        entries.forEach(function (e) {
            var b = getDateBucket(e.iso);
            if (!groups[b])
                groups[b] = [];
            groups[b].push(e.el);
        });
        bucketOrder.forEach(function (b) {
            if (!groups[b] || groups[b].length === 0)
                return;
            var gh = document.createElement('div');
            gh.className = 'date-group-header';
            gh.textContent = b;
            container.appendChild(gh);
            groups[b].forEach(function (el) { container.appendChild(el); });
        });
    }
    function matchesSearch(name, preview, branch) {
        if (!searchQuery)
            return true;
        var q = searchQuery;
        return (!!name && name.toLowerCase().indexOf(q) !== -1) ||
            (!!preview && preview.toLowerCase().indexOf(q) !== -1) ||
            (!!branch && branch.toLowerCase().indexOf(q) !== -1) ||
            false;
    }
    function renderSessionsList(agentType, tabId) {
        sessionsList.innerHTML = '';
        if (agentType === 'claude') {
            // ── Claude Code sessions ───────────────────────────────────────────────
            var ccFiltered = claudeCodeSessions.filter(function (s) {
                return matchesSearch(s.title, undefined, s.branch);
            });
            sessionsList.appendChild(makeSectionHeader('claude code sessions'));
            if (ccFiltered.length === 0) {
                var ccEmpty = document.createElement('div');
                ccEmpty.className = 'sess-item';
                ccEmpty.style.color = '#3a3a3a';
                ccEmpty.style.fontSize = '10px';
                ccEmpty.style.cursor = 'default';
                ccEmpty.textContent = searchQuery ? 'no matching sessions' : 'no sessions yet';
                sessionsList.appendChild(ccEmpty);
            }
            else {
                var ccEntries = [];
                ccFiltered.forEach(function (s) {
                    (function (sid, stitle, sbranch, scount, smodel, siso) {
                        var el = makeClaudeSessItem(stitle, fmtTime(siso), sbranch, scount, smodel, function () {
                            pendingTabTitle = stitle;
                            setSessTitle(stitle);
                            showHistoryView(false);
                            banner.style.display = 'none';
                            if (tabId) {
                                vscode.postMessage({
                                    type: 'resumeClaudeSession', sessionId: sid,
                                    cols: terminals[tabId] ? terminals[tabId].cols : 80,
                                    rows: terminals[tabId] ? terminals[tabId].rows : 24,
                                });
                            }
                            else {
                                // resumeClaudeSession creates its own tab — no spawn needed
                                pendingTabTitle = stitle;
                                vscode.postMessage({ type: 'resumeClaudeSession', sessionId: sid, cols: 80, rows: 24 });
                            }
                        });
                        ccEntries.push({ el: el, iso: siso });
                    })(s.sessionId, s.title, s.branch, s.messageCount, s.model, s.lastActive);
                });
                renderWithGroups(sessionsList, ccEntries);
            }
            // ── Terminal history ───────────────────────────────────────────────────
            var ptyList = (sessionsByType[agentType] || []).slice().reverse();
            var ptyFiltered = ptyList.filter(function (s) {
                return matchesSearch(s.name || agentType, s.preview);
            });
            if (ptyFiltered.length > 0) {
                sessionsList.appendChild(makeSectionHeader('terminal history'));
                var ptyEntries = [];
                ptyFiltered.forEach(function (s) {
                    (function (sid, sname, siso) {
                        var el = makeSessItem(sname || agentType, fmtTime(siso), s.preview || '', function () {
                            setSessTitle(sname || agentType);
                            showHistoryView(false);
                            banner.style.display = 'none';
                            if (tabId) {
                                vscode.postMessage({ type: 'loadSession', termId: tabId, agentType: agentType, sessionId: sid });
                            }
                            else {
                                pendingSessionLoad = { agentType: agentType, sessionId: sid };
                                vscode.postMessage({ type: 'spawn', agentType: agentType });
                            }
                        });
                        ptyEntries.push({ el: el, iso: siso });
                    })(s.id, s.name, s.savedAt);
                });
                renderWithGroups(sessionsList, ptyEntries);
            }
            return;
        }
        // ── Non-claude agent types ─────────────────────────────────────────────
        var list = (sessionsByType[agentType] || []).slice().reverse();
        var listFiltered = list.filter(function (s) {
            return matchesSearch(s.name || agentType, s.preview);
        });
        if (listFiltered.length === 0) {
            var empty = document.createElement('div');
            empty.id = 'sessions-empty';
            empty.textContent = searchQuery ? 'no matching sessions' : 'no sessions yet';
            sessionsList.appendChild(empty);
            return;
        }
        var listEntries = [];
        listFiltered.forEach(function (s) {
            (function (sid, sname, siso) {
                var el = makeSessItem(sname || agentType, fmtTime(siso), s.preview || '', function () {
                    setSessTitle(sname || agentType);
                    showHistoryView(false);
                    banner.style.display = 'none';
                    if (tabId) {
                        vscode.postMessage({ type: 'loadSession', termId: tabId, agentType: agentType, sessionId: sid });
                    }
                    else {
                        pendingSessionLoad = { agentType: agentType, sessionId: sid };
                        vscode.postMessage({ type: 'spawn', agentType: agentType });
                    }
                });
                listEntries.push({ el: el, iso: siso });
            })(s.id, s.name, s.savedAt);
        });
        renderWithGroups(sessionsList, listEntries);
    }
    // ── Tab lifecycle ──────────────────────────────────────────────────────────
    function createTab(id, agentType, label) {
        running[id] = false;
        exitMsgs[id] = '';
        tabTitles[id] = label;
        var t = new Terminal(termOpts);
        var fa = new FitAddon.FitAddon();
        t.loadAddon(fa);
        var pane = document.createElement('div');
        pane.id = 'term-' + id;
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
        btn.className = 'tab';
        btn.id = 'tab-btn-' + id;
        btn.dataset['id'] = id;
        btn.dataset['type'] = agentType;
        btn.style.display = agentType === currentAgentType ? '' : 'none';
        var labelSpan = document.createElement('span');
        labelSpan.className = 'tab-label';
        labelSpan.textContent = label;
        var closeSpan = document.createElement('span');
        closeSpan.className = 'tab-close';
        closeSpan.textContent = '×';
        closeSpan.title = 'Close';
        closeSpan.addEventListener('click', function (e) {
            e.stopPropagation();
            closeTab(id);
        });
        btn.appendChild(labelSpan);
        btn.appendChild(closeSpan);
        tabListEl.appendChild(btn);
    }
    function closeTab(id) {
        var tabType = getAgentType(id);
        var nextId = tabOrder.filter(function (tid) {
            return tid !== id && getAgentType(tid) === tabType;
        })[0] || null;
        if (terminals[id]) {
            terminals[id].dispose();
            delete terminals[id];
        }
        delete fitAddons[id];
        delete running[id];
        delete exitMsgs[id];
        delete tabTitles[id];
        tabOrder.splice(tabOrder.indexOf(id), 1);
        var btn = document.getElementById('tab-btn-' + id);
        if (btn)
            btn.remove();
        var pane = document.getElementById('term-' + id);
        if (pane)
            pane.remove();
        vscode.postMessage({ type: 'close', termId: id });
        if (id === currentTermId) {
            currentTermId = null;
            if (nextId) {
                switchTo(nextId);
            }
            else {
                setSessTitle('');
                banner.style.display = 'none';
                showHistoryView(true);
            }
        }
    }
    function switchTo(id) {
        searchQuery = '';
        sessSearchEl.value = '';
        document.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('active'); });
        var btn = document.getElementById('tab-btn-' + id);
        if (btn)
            btn.classList.add('active');
        document.querySelectorAll('.term-pane').forEach(function (p) { p.classList.remove('active'); });
        var pane = document.getElementById('term-' + id);
        if (pane)
            pane.classList.add('active');
        currentTermId = id;
        // Sync type-bar to tab's agent type
        var type = getAgentType(id);
        if (type !== currentAgentType) {
            currentAgentType = type;
            document.querySelectorAll('.type-btn').forEach(function (b) {
                b.classList.toggle('active', b.dataset['type'] === type);
            });
            renderTabList();
        }
        // Close history, show terminal
        historyVisible = false;
        historyView.style.display = 'none';
        wrap.style.display = '';
        historyBtn.classList.remove('active');
        banner.style.display = 'none';
        if (exitMsgs[id]) {
            setSessTitle(exitMsgs[id]);
            bannerMsg.textContent = exitMsgs[id];
            banner.style.display = 'flex';
        }
        else {
            setSessTitle(pendingTabTitle || tabTitles[id] || getAgentType(id));
            vscode.postMessage({
                type: 'launch', termId: id, agentType: type,
                cols: terminals[id] ? terminals[id].cols : 80,
                rows: terminals[id] ? terminals[id].rows : 24,
            });
        }
        requestAnimationFrame(function () {
            if (currentTermId && fitAddons[currentTermId])
                fitAddons[currentTermId].fit();
        });
    }
    function startNewSession(tabId) {
        var agentType = getAgentType(tabId);
        showHistoryView(false);
        setSessTitle(agentType);
        banner.style.display = 'none';
        if (terminals[tabId])
            terminals[tabId].reset();
        vscode.postMessage({
            type: 'restart', termId: tabId, agentType: agentType,
            cols: terminals[tabId] ? terminals[tabId].cols : 80,
            rows: terminals[tabId] ? terminals[tabId].rows : 24,
        });
    }
    // ── Button handlers ────────────────────────────────────────────────────────
    document.getElementById('type-bar').addEventListener('click', function (e) {
        var btn = e.target.closest('.type-btn');
        if (!btn)
            return;
        setAgentType(btn.dataset['type']);
    });
    tabListEl.addEventListener('click', function (e) {
        if (e.target.closest('.tab-close'))
            return;
        var btn = e.target.closest('.tab');
        if (!btn || btn.dataset['id'] === currentTermId)
            return;
        switchTo(btn.dataset['id']);
    });
    historyBtn.addEventListener('click', function () {
        showHistoryView(!historyVisible);
    });
    addBtn.addEventListener('click', function () {
        vscode.postMessage({ type: 'spawn', agentType: currentAgentType });
    });
    newSessionBtn.addEventListener('click', function () {
        if (currentTermId)
            startNewSession(currentTermId);
    });
    sessSearchEl.addEventListener('input', function () {
        searchQuery = sessSearchEl.value.trim().toLowerCase();
        renderSessionsList(currentAgentType, currentTermId);
    });
    // ── Paste ──────────────────────────────────────────────────────────────────
    document.addEventListener('paste', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (keyHandledPaste) {
            keyHandledPaste = false;
            return;
        }
        if (!currentTermId || historyVisible)
            return;
        var text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
        if (text) {
            vscode.postMessage({ type: 'input', termId: currentTermId, data: text.replace(/[\r\n]+$/, '') });
        }
        else {
            vscode.postMessage({ type: 'paste', termId: currentTermId });
        }
    }, true);
    // ── Resize ─────────────────────────────────────────────────────────────────
    new ResizeObserver(function () {
        if (currentTermId && fitAddons[currentTermId] && !historyVisible) {
            requestAnimationFrame(function () {
                if (currentTermId && fitAddons[currentTermId])
                    fitAddons[currentTermId].fit();
            });
        }
    }).observe(wrap);
    window.addEventListener('message', function (ev) {
        var msg = ev.data;
        if (msg.type === 'initTabs') {
            var sbt = msg.sessionsByType;
            if (sbt)
                Object.keys(sbt).forEach(function (type) { sessionsByType[type] = sbt[type]; });
            var rt = msg.runningTabs;
            msg.tabs.forEach(function (t) { createTab(t.id, t.type, t.label); });
            if (rt)
                rt.forEach(function (id) { running[id] = true; });
            // Overwrite tab titles with actual session names supplied by the extension host
            var sn = msg.sessionNames || {};
            Object.keys(sn).forEach(function (tabId) {
                if (sn[tabId])
                    tabTitles[tabId] = sn[tabId];
            });
            var activeId = msg.activeId || (msg.tabs.length > 0 ? msg.tabs[0].id : null);
            if (activeId) {
                var initType = getAgentType(activeId);
                currentAgentType = initType;
                document.querySelectorAll('.type-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset['type'] === initType);
                });
                renderTabList();
                switchTo(activeId);
            }
        }
        else if (msg.type === 'tabCreated') {
            var createdType = msg.agentType;
            var createdId = msg.id;
            createTab(createdId, createdType, msg.label);
            if (createdType !== currentAgentType) {
                currentAgentType = createdType;
                document.querySelectorAll('.type-btn').forEach(function (b) {
                    b.classList.toggle('active', b.dataset['type'] === createdType);
                });
                renderTabList();
            }
            var savedTitle = pendingTabTitle;
            pendingTabTitle = null;
            switchTo(createdId);
            if (savedTitle)
                setSessTitle(savedTitle);
            if (pendingSessionLoad && pendingSessionLoad.agentType === createdType) {
                var pending = pendingSessionLoad;
                pendingSessionLoad = null;
                vscode.postMessage({ type: 'loadSession', termId: createdId, agentType: pending.agentType, sessionId: pending.sessionId });
            }
        }
        else if (msg.type === 'started') {
            running[msg.termId] = true;
            if (msg.sessions) {
                var startBtn = document.getElementById('tab-btn-' + msg.termId);
                var startType = (startBtn && startBtn.dataset['type']) || 'claude';
                sessionsByType[startType] = msg.sessions;
            }
            if (msg.restore && terminals[msg.termId]) {
                terminals[msg.termId].write('\x1b[?1049l\x1b[0m');
                terminals[msg.termId].write(msg.restore);
                var now = new Date();
                var hh = String(now.getHours()).padStart(2, '0');
                var mm = String(now.getMinutes()).padStart(2, '0');
                terminals[msg.termId].write('\r\n\x1b[38;5;240m── restored ' + hh + ':' + mm + ' ──\x1b[0m\r\n\r\n');
            }
            if (msg.termId === currentTermId) {
                showHistoryView(false);
                setSessTitle(pendingTabTitle || tabTitles[msg.termId] || getAgentType(msg.termId));
                pendingTabTitle = null;
                terminals[msg.termId].focus();
            }
        }
        else if (msg.type === 'resumed') {
            // no-op
        }
        else if (msg.type === 'data') {
            if (terminals[msg.termId])
                terminals[msg.termId].write(msg.text);
        }
        else if (msg.type === 'exit') {
            running[msg.termId] = false;
            exitMsgs[msg.termId] = msg.code === 0 ? 'session ended' : 'exited (' + msg.code + ')';
            if (msg.termId === currentTermId && !historyVisible) {
                bannerMsg.textContent = exitMsgs[msg.termId];
                banner.style.display = 'flex';
            }
        }
        else if (msg.type === 'error') {
            running[msg.termId] = false;
            exitMsgs[msg.termId] = 'error: ' + msg.message;
            if (msg.termId === currentTermId && !historyVisible) {
                bannerMsg.textContent = exitMsgs[msg.termId];
                banner.style.display = 'flex';
            }
        }
        else if (msg.type === 'sessionSaved') {
            if (msg.agentType)
                sessionsByType[msg.agentType] = msg.sessions;
            if (historyVisible && currentAgentType === msg.agentType) {
                renderSessionsList(currentAgentType, currentTermId);
            }
        }
        else if (msg.type === 'claudeHistory') {
            claudeCodeSessions = msg.sessions;
            if (historyVisible && currentAgentType === 'claude') {
                renderSessionsList('claude', currentTermId);
            }
        }
        else if (msg.type === 'sessionContent') {
            if (terminals[msg.termId]) {
                terminals[msg.termId].write('\x1b[?1049l\x1b[0m');
                terminals[msg.termId].reset();
                if (msg.content) {
                    terminals[msg.termId].write('\x1b[?1049l\x1b[0m');
                    terminals[msg.termId].write(msg.content);
                }
                if (msg.termId === currentTermId)
                    terminals[msg.termId].focus();
            }
        }
    });
    vscode.postMessage({ type: 'ready' });
}());
