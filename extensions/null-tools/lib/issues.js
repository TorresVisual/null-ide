'use strict';
function relativeLuminance(r, g, b) {
    const [rs, gs, bs] = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}
function contrastRatio(l1, l2) {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}
/** Picks whichever of black/white text has the higher WCAG contrast ratio against a GitHub label hex color. */
function labelChipStyle(hex) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const bgLuminance = relativeLuminance(r, g, b);
    const color = contrastRatio(bgLuminance, 1) > contrastRatio(bgLuminance, 0) ? '#fff' : '#111';
    return `background:#${hex};color:${color}`;
}
const COPY_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5.5" y="5.5" width="8" height="8" rx="1"/><path d="M3.5 10.5h-1a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const OPEN_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6.5 2.5h-3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 2.5h4v4M13 3l-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 8.5l4 4 8-9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BRANCH_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="4" cy="3" r="1.6"/><circle cx="4" cy="13" r="1.6"/><circle cx="12" cy="6" r="1.6"/><path d="M4 4.6V11.4M4 8c0-2 2-3.5 4-3.5h2.6" stroke-linecap="round"/></svg>';
const WORKTREE_ICON = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/><path d="M4.5 7v3a1 1 0 001 1h3" stroke-linecap="round"/></svg>';
(function () {
    const vscode = acquireVsCodeApi();
    const stateSelect = document.getElementById('state-select');
    const assigneeMe = document.getElementById('assignee-me');
    const assigneeEveryone = document.getElementById('assignee-everyone');
    const labelPicker = document.getElementById('label-picker');
    const searchInput = document.getElementById('search-input');
    const listEl = document.getElementById('list');
    const newIssueBtn = document.getElementById('new-issue-btn');
    const refreshBtn = document.getElementById('refresh-btn');
    const markReadBtn = document.getElementById('mark-read-btn');
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    const searchBar = document.getElementById('search-bar');
    const filterPopover = document.getElementById('filter-popover');
    newIssueBtn.addEventListener('click', () => vscode.postMessage({ type: 'createIssue' }));
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
    markReadBtn.addEventListener('click', () => vscode.postMessage({ type: 'markRead' }));
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
    let labelDropdownOpen = false;
    let lastRepoLabels = [];
    document.addEventListener('click', e => {
        if (e.composedPath().some(n => n instanceof Element && n.classList.contains('dropdown-container')))
            return;
        if (!labelDropdownOpen)
            return;
        labelDropdownOpen = false;
        renderLabelPicker(lastRepoLabels);
    });
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
        var _a;
        lastRepoLabels = labels;
        if (labels.length === 0) {
            labelPicker.innerHTML = '<span class="issue-meta">No labels in this repo.</span>';
            return;
        }
        const selected = labels.filter(l => selectedLabels.has(l.name));
        labelPicker.innerHTML = `
      <button type="button" class="dropdown-trigger">
        ${selected.length > 0 ? `<span class="selected-tags">${selected.map(l => `
          <span class="tag" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}<span class="tag-remove" data-value="${escapeHtml(l.name)}">&times;</span></span>`).join('')}</span>`
            : '<span class="dropdown-placeholder">Filter by label…</span>'}
        <span class="dropdown-arrow">${labelDropdownOpen ? '▲' : '▼'}</span>
      </button>
      <div class="dropdown-list${labelDropdownOpen ? '' : ' hidden'}">
        ${labels.map(l => `
          <button type="button" class="dropdown-item${selectedLabels.has(l.name) ? ' selected' : ''}" data-value="${escapeHtml(l.name)}">
            <span class="label-chip" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}</span>
          </button>`).join('')}
      </div>`;
        (_a = labelPicker.querySelector('.dropdown-trigger')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => {
            labelDropdownOpen = !labelDropdownOpen;
            renderLabelPicker(labels);
        });
        labelPicker.querySelectorAll('.tag-remove').forEach(el => el.addEventListener('mousedown', e => {
            e.preventDefault();
            selectedLabels.delete(el.dataset.value);
            renderLabelPicker(labels);
            sendFilters();
        }));
        labelPicker.querySelectorAll('.dropdown-item').forEach(el => el.addEventListener('click', () => {
            const v = el.dataset.value;
            if (selectedLabels.has(v))
                selectedLabels.delete(v);
            else
                selectedLabels.add(v);
            renderLabelPicker(labels);
            sendFilters();
        }));
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
          <div><span class="issue-num">#${issue.number}</span> <span class="issue-title">${escapeHtml(issue.title)}</span>${you ? '<span class="you-badge">@you</span>' : ''}${issue.closedLocally ? '<span class="closes-badge" title="An unpushed local commit will close this issue">closes on push</span>' : ''}</div>
          <div class="issue-meta">
            ${issue.labels.map(l => `<span class="label-chip" style="${labelChipStyle(l.color)}">${escapeHtml(l.name)}</span>`).join('')}
            ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
          </div>
          <div class="row-actions">
            <button class="branch-btn" title="Create branch for this issue">${BRANCH_ICON}</button>
            <button class="worktree-btn" title="Create worktree for this issue">${WORKTREE_ICON}</button>
            <button class="copy-btn" title="Copy as prompt">${COPY_ICON}</button>
            <button class="browser-btn" title="Open in browser">${OPEN_ICON}</button>
          </div>
        </div>
      </div>`;
        }).join('');
        listEl.querySelectorAll('.issue-row').forEach(row => {
            var _a, _b, _c, _d;
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
            (_c = row.querySelector('.branch-btn')) === null || _c === void 0 ? void 0 : _c.addEventListener('click', ev => {
                ev.stopPropagation();
                vscode.postMessage({ type: 'createBranchForIssue', number });
            });
            (_d = row.querySelector('.worktree-btn')) === null || _d === void 0 ? void 0 : _d.addEventListener('click', ev => {
                ev.stopPropagation();
                vscode.postMessage({ type: 'createWorktreeForIssue', number });
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
                    btn.innerHTML = CHECK_ICON;
                    setTimeout(() => { btn.innerHTML = COPY_ICON; }, 1200);
                }
                break;
            }
        }
    });
    vscode.postMessage({ type: 'ready' });
})();
