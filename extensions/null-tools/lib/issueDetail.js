'use strict';
(function () {
    const vscode = acquireVsCodeApi();
    const detailEl = document.getElementById('detail');
    function escapeHtml(s) {
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
        return s.replace(/[&<>"']/g, c => map[c]);
    }
    function renderDetail(issue, comments) {
        var _a, _b;
        detailEl.innerHTML = `
      <h2><span class="state-badge${issue.state === 'closed' ? ' closed' : ''}">${issue.state}</span> #${issue.number} ${escapeHtml(issue.title)}</h2>
      <div class="issue-meta">
        ${issue.labels.map(l => `<span class="label-chip" style="background:#${l.color}">${escapeHtml(l.name)}</span>`).join('')}
        opened by ${escapeHtml(issue.user.login)} · ${issue.comments} comments · updated ${issue.updated_at.slice(0, 10)}
      </div>
      <div>
        <button class="action" id="copy-btn">Copy as prompt</button>
        <button class="action" id="browser-btn">Open in browser ↗</button>
      </div>
      <div id="detail-body">${escapeHtml(issue.body || '(no description)')}</div>
      <div id="comments">
        ${comments.map(c => `
          <div class="comment">
            <span class="comment-author">${escapeHtml(c.user.login)}</span>
            <span class="issue-meta">${c.created_at.slice(0, 10)}</span>
            <div>${escapeHtml(c.body)}</div>
          </div>`).join('') || '<div class="issue-meta">No comments.</div>'}
      </div>`;
        (_a = document.getElementById('copy-btn')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', () => vscode.postMessage({ type: 'copyAsPrompt' }));
        (_b = document.getElementById('browser-btn')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));
    }
    window.addEventListener('message', event => {
        const msg = event.data;
        switch (msg.type) {
            case 'issueDetail':
                renderDetail(msg.issue, msg.comments);
                break;
            case 'copied': {
                const btn = detailEl.querySelector('#copy-btn');
                if (btn) {
                    btn.textContent = 'Copied!';
                    setTimeout(() => { if (btn)
                        btn.textContent = 'Copy as prompt'; }, 1500);
                }
                break;
            }
        }
    });
    vscode.postMessage({ type: 'ready' });
})();
