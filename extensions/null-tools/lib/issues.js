'use strict';
(function () {
    const vscode = acquireVsCodeApi();
    const stateSelect = document.getElementById('state-select');
    const assigneeMe = document.getElementById('assignee-me');
    const assigneeEveryone = document.getElementById('assignee-everyone');
    const labelPicker = document.getElementById('label-picker');
    const searchInput = document.getElementById('search-input');
    const listEl = document.getElementById('list');
    const refreshBtn = document.getElementById('refresh-btn');
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    const searchBar = document.getElementById('search-bar');
    const filterPopover = document.getElementById('filter-popover');
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    searchToggleBtn.addEventListener('click', () => {
        searchBar.classList.toggle('hidden');
        searchToggleBtn.classList.toggle('active');
        if (!searchBar.classList.contains('hidden'))
            searchInput.focus();
    });
    filterToggleBtn.addEventListener('click', () => {
        filterPopover.classList.toggle('hidden');
        filterToggleBtn.classList.toggle('active');
    });
    let assignee = 'everyone';
    let selectedNumber = null;
    let viewerLogin = null;
    const selectedLabels = new Set();
    function escapeHtml(s) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return s.replace(/[&<>"']/g, c => map[c]);
    }
    function sendFilters() {
        vscode.postMessage({
            type: 'setFilters',
            labels: Array.from(selectedLabels),
            assignee,
            query: searchInput.value,
        });
    }
    function renderLabelPicker(labels) {
        if (labels.length === 0) {
            labelPicker.innerHTML = '<span class="issue-meta">No labels in this repo.</span>';
            return;
        }
        labelPicker.innerHTML = labels.map(l => `
      <label class="chip-check">
        <input type="checkbox" value="${escapeHtml(l.name)}" ${selectedLabels.has(l.name) ? 'checked' : ''}>
        <span class="label-chip" style="background:#${l.color}">${escapeHtml(l.name)}</span>
      </label>`).join('');
        labelPicker.querySelectorAll('input').forEach(cb => {
            cb.addEventListener('change', () => {
                if (cb.checked)
                    selectedLabels.add(cb.value);
                else
                    selectedLabels.delete(cb.value);
                sendFilters();
            });
        });
    }
    stateSelect.addEventListener('change', () => {
        vscode.postMessage({ type: 'setState', state: stateSelect.value });
    });
    searchInput.addEventListener('input', sendFilters);
    assigneeMe.addEventListener('click', () => {
        assignee = 'me';
        assigneeMe.classList.add('active');
        assigneeEveryone.classList.remove('active');
        sendFilters();
    });
    assigneeEveryone.addEventListener('click', () => {
        assignee = 'everyone';
        assigneeEveryone.classList.add('active');
        assigneeMe.classList.remove('active');
        sendFilters();
    });
    function renderList(issues) {
        if (issues.length === 0) {
            listEl.innerHTML = '<div id="empty">No issues match.</div>';
            return;
        }
        listEl.innerHTML = issues.map(issue => {
            const you = viewerLogin && issue.assignees.some(a => a.login === viewerLogin);
            return `
      <div class="issue-row${issue.state === 'closed' ? ' closed' : ''}${issue.number === selectedNumber ? ' selected' : ''}" data-number="${issue.number}">
        <span class="state-dot" title="${issue.state}"></span>
        <div class="issue-main">
          <div><span class="issue-num">#${issue.number}</span> <span class="issue-title">${escapeHtml(issue.title)}</span>${you ? '<span class="you-badge">@you</span>' : ''}</div>
          <div class="issue-meta">
            ${issue.labels.map(l => `<span class="label-chip" style="background:#${l.color}">${escapeHtml(l.name)}</span>`).join('')}
            ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
          </div>
        </div>
        <div class="row-actions">
          <button class="copy-btn" title="Copy as prompt">📋</button>
          <button class="browser-btn" title="Open in browser">↗</button>
        </div>
      </div>`;
        }).join('');
        listEl.querySelectorAll('.issue-row').forEach(row => {
            var _a, _b;
            const number = Number(row.dataset.number);
            row.addEventListener('click', () => {
                selectedNumber = number;
                vscode.postMessage({ type: 'selectIssue', number });
                listEl.querySelectorAll('.issue-row').forEach(r => r.classList.remove('selected'));
                row.classList.add('selected');
            });
            (_a = row.querySelector('.copy-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', ev => {
                ev.stopPropagation();
                vscode.postMessage({ type: 'copyAsPromptForIssue', number });
            });
            (_b = row.querySelector('.browser-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', ev => {
                ev.stopPropagation();
                vscode.postMessage({ type: 'openIssueInBrowser', number });
            });
        });
    }
    window.addEventListener('message', event => {
        var _a, _b;
        const msg = event.data;
        switch (msg.type) {
            case 'init':
                stateSelect.value = msg.state;
                break;
            case 'issues':
                if (msg.status === 'ok') {
                    viewerLogin = (_a = msg.viewerLogin) !== null && _a !== void 0 ? _a : viewerLogin;
                    if (msg.repoLabels)
                        renderLabelPicker(msg.repoLabels);
                    renderList(msg.issues);
                }
                else {
                    const messages = {
                        'no-workspace': 'Open a folder to browse its GitHub issues.',
                        'no-remote': 'This folder has no GitHub remote.',
                        'signed-out': 'Sign in to GitHub to view issues.',
                        'error': msg.message || 'Failed to load issues.',
                    };
                    const text = messages[msg.status] || 'Failed to load issues.';
                    listEl.innerHTML = `<div id="empty">${escapeHtml(text)}${msg.status === 'signed-out' ? '<br><button class="action" id="signin-btn">Sign in</button>' : ''}</div>`;
                    (_b = document.getElementById('signin-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => vscode.postMessage({ type: 'signIn' }));
                }
                break;
            case 'copiedIssue': {
                const btn = listEl.querySelector(`.issue-row[data-number="${msg.number}"] .copy-btn`);
                if (btn) {
                    btn.textContent = '✓';
                    setTimeout(() => { btn.textContent = '📋'; }, 1200);
                }
                break;
            }
        }
    });
    vscode.postMessage({ type: 'ready' });
})();
