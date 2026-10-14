'use strict';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };

(function main(): void {
  const vscode = acquireVsCodeApi();
  const send = (message: GraphWebviewToHost): void => vscode.postMessage(message);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const LANE_WIDTH = 12;
  const FILE_CAP = 500;

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
    const node = document.createElementNS(SVG_NS, tag);
    for (const key of Object.keys(attrs)) node.setAttribute(key, String(attrs[key]));
    return node;
  }
  const isoOf = (seconds: number): string => new Date(seconds * 1000).toISOString();

  const app = document.getElementById('app') as HTMLElement;
  const banner = el('div', 'banner hidden');
  const notice = el('div', 'notice hidden');
  const list = el('div', 'list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Commits');
  list.tabIndex = 0;
  const spacer = el('div', 'spacer');
  const windowEl = el('div', 'window');
  const empty = el('div', 'empty hidden', 'No commits yet.');
  list.append(spacer, windowEl, empty);
  const detail = el('div', 'detail');
  app.append(banner, notice, list, detail);

  let rows: GraphRow[] = [];
  let hasMore = false;
  let loadingMore = false;
  let selectedSha: string | null = null;
  let detailData: GraphDetail | null = null;
  let detailFiles: GraphFile[] | null = null;
  let showAllFiles = false;
  let selectTimer: number | undefined;

  const indexOfSha = (sha: string | null): number => (sha === null ? -1 : rows.findIndex((r) => r.sha === sha));

  // ---- rows -------------------------------------------------------------------------------------------------

  function laneSvg(row: GraphRow): SVGElement {
    const columns = Math.min(row.laneCount, graphLaneCap());
    const width = columns * LANE_WIDTH + 8;
    const svg = svgEl('svg', { class: 'lanes', width, height: graphRowHeight(), 'aria-hidden': 'true' });
    const x = (lane: number): number => graphLaneColumn(lane) * LANE_WIDTH + 8;
    const mid = graphRowHeight() / 2;
    for (const e of row.edges) {
      const stroke = graphLaneColorVar(e.color);
      if (e.kind === 'pass') {
        if (e.from >= graphLaneCap()) continue;
        svg.appendChild(svgEl('line', { x1: x(e.from), y1: 0, x2: x(e.from), y2: graphRowHeight(), stroke, 'stroke-width': 2 }));
      } else if (e.kind === 'in') {
        svg.appendChild(svgEl('path', { d: `M ${x(e.from)} 0 C ${x(e.from)} 8, ${x(e.to)} 4, ${x(e.to)} ${mid}`, stroke, fill: 'none', 'stroke-width': 2 }));
      } else {
        svg.appendChild(svgEl('path', { d: `M ${x(e.from)} ${mid} C ${x(e.to)} 20, ${x(e.to)} 16, ${x(e.to)} ${graphRowHeight()}`, stroke, fill: 'none', 'stroke-width': 2 }));
      }
    }
    const merge = row.parents.length > 1;
    svg.appendChild(svgEl('circle', {
      cx: x(row.lane), cy: mid, r: 4,
      fill: merge ? 'var(--vscode-editor-background)' : graphLaneColorVar(row.lane), stroke: graphLaneColorVar(row.lane), 'stroke-width': 2,
    }));
    const hidden = graphHiddenLanes(row.laneCount);
    if (hidden > 0) {
      const label = svgEl('text', { x: width - 2, y: mid + 4, 'text-anchor': 'end', class: 'hidden-lanes' });
      label.textContent = `+${hidden}`;
      svg.appendChild(label);
    }
    return svg;
  }

  function rowElement(row: GraphRow): HTMLElement {
    const node = el('div', 'row');
    node.id = `row-${row.sha}`;
    node.dataset.sha = row.sha;
    node.setAttribute('role', 'option');
    node.setAttribute('aria-label', `${row.subject}, ${row.author}, ${relativeTime(isoOf(row.time))}`);
    node.setAttribute('data-vscode-context', JSON.stringify({ webviewSection: 'commit', sha: row.sha, preventDefaultContextMenuItems: true }));
    const line = el('div', 'line');
    for (const ref of row.refs) {
      const pill = el('span', `pill pill-${ref.kind}${ref.current ? ' current' : ''}`, ref.name);
      pill.title = `${ref.kind}: ${ref.name}`;
      line.appendChild(pill);
    }
    line.appendChild(el('span', 'subject', row.subject));
    line.appendChild(el('span', 'author', row.author));
    const when = el('span', 'when', relativeTime(isoOf(row.time)));
    when.title = new Date(row.time * 1000).toLocaleString();
    line.appendChild(when);
    node.append(laneSvg(row), line);
    return node;
  }

  function markSelection(): void {
    for (const child of Array.from(windowEl.children) as HTMLElement[]) {
      const on = child.dataset.sha === selectedSha;
      child.classList.toggle('selected', on);
      child.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (selectedSha) list.setAttribute('aria-activedescendant', `row-${selectedSha}`);
    else list.removeAttribute('aria-activedescendant');
  }

  function render(): void {
    const range = graphVisibleRange(list.scrollTop, list.clientHeight, rows.length);
    spacer.style.height = `${rows.length * graphRowHeight()}px`;
    windowEl.style.transform = `translateY(${range.start * graphRowHeight()}px)`;
    reconcile(windowEl, rows.slice(range.start, range.end), (r) => r.sha, rowElement);
    empty.classList.toggle('hidden', rows.length > 0);
    markSelection();
  }

  function maybeLoadMore(): void {
    if (!loadingMore && graphNeedsMore(list.scrollTop, list.clientHeight, rows.length, hasMore)) {
      loadingMore = true;
      send({ type: 'loadMore' });
    }
  }

  // ---- selection and detail ---------------------------------------------------------------------------------

  function selectSha(sha: string, reveal: boolean): void {
    selectedSha = sha;
    detailData = null;
    detailFiles = null;
    showAllFiles = false;
    const index = indexOfSha(sha);
    if (reveal && index >= 0) list.scrollTop = graphScrollToReveal(list.scrollTop, list.clientHeight, index);
    render();
    renderDetail();
    window.clearTimeout(selectTimer);
    selectTimer = window.setTimeout(() => send({ type: 'select', sha }), 100);
  }

  function renderDetail(): void {
    detail.textContent = '';
    if (!selectedSha) {
      detail.appendChild(el('div', 'placeholder', 'Select a commit to see its changes.'));
      return;
    }
    if (!detailData) {
      detail.appendChild(el('div', 'placeholder', 'Loading…'));
      return;
    }
    const d = detailData;
    const [headline, ...bodyLines] = d.message.split('\n');
    detail.appendChild(el('div', 'detail-subject', headline));
    const body = bodyLines.join('\n').trim();
    if (body) detail.appendChild(el('pre', 'detail-body', body));

    const meta = el('div', 'meta');
    meta.appendChild(el('span', '', `${d.author} <${d.authorEmail}> · ${new Date(d.authorTime * 1000).toLocaleString()}`));
    if (d.committer !== d.author || d.committerEmail !== d.authorEmail) {
      meta.appendChild(el('span', '', `committed by ${d.committer} <${d.committerEmail}>`));
    }
    const shaLine = el('span', 'sha', d.sha);
    meta.appendChild(shaLine);
    if (d.parents.length > 0) {
      const parents = el('span', 'parents', d.parents.length > 1 ? 'Parents: ' : 'Parent: ');
      for (const parent of d.parents) {
        const link = el('button', 'link', parent.slice(0, 7));
        link.addEventListener('click', () => send({ type: 'goto', sha: parent }));
        parents.appendChild(link);
      }
      meta.appendChild(parents);
    }
    detail.appendChild(meta);

    if (!detailFiles) {
      detail.appendChild(el('div', 'placeholder', 'Loading files…'));
      return;
    }
    const files = showAllFiles ? detailFiles : detailFiles.slice(0, FILE_CAP);
    const fileList = el('div', 'files');
    for (const file of files) {
      const item = el('button', `file status-${file.status}`);
      item.appendChild(el('span', 'status', file.status));
      item.appendChild(el('span', 'path', file.oldPath ? `${file.oldPath} → ${file.path}` : file.path));
      item.addEventListener('click', () => send({ type: 'openDiff', sha: d.sha, file: file.path }));
      fileList.appendChild(item);
    }
    detail.appendChild(fileList);
    if (!showAllFiles && detailFiles.length > FILE_CAP) {
      const more = el('button', 'link', `${detailFiles.length - FILE_CAP} more — show all`);
      more.addEventListener('click', () => { showAllFiles = true; renderDetail(); });
      detail.appendChild(more);
    }
    if (detailFiles.length === 0) detail.appendChild(el('div', 'placeholder', 'No file changes.'));
  }

  // ---- banner and notices -----------------------------------------------------------------------------------

  function renderBanner(inProgress: GraphInProgress | null): void {
    banner.textContent = '';
    banner.classList.toggle('hidden', inProgress === null);
    if (!inProgress) return;
    banner.appendChild(el('span', 'banner-text', `${inProgress.kind} in progress — finish or abort it before other actions.`));
    const actions: Array<'continue' | 'skip' | 'abort'> = inProgress.kind === 'merge' ? ['continue', 'abort'] : ['continue', 'skip', 'abort'];
    for (const action of actions) {
      const button = el('button', 'banner-button', action[0].toUpperCase() + action.slice(1));
      button.addEventListener('click', () => send({ type: 'banner', action }));
      banner.appendChild(button);
    }
  }

  function showNotice(message: string, retry?: 'refresh' | 'loadMore'): void {
    notice.textContent = '';
    notice.classList.remove('hidden');
    notice.appendChild(el('span', '', message));
    if (retry) {
      const button = el('button', 'banner-button', 'Retry');
      button.addEventListener('click', () => {
        notice.classList.add('hidden');
        if (retry === 'loadMore') { loadingMore = true; send({ type: 'loadMore' }); } else send({ type: 'refresh' });
      });
      notice.appendChild(button);
    }
  }

  function showUnavailable(reason: GraphUnavailableReason): void {
    app.textContent = '';
    const text: Record<GraphUnavailableReason, string> = {
      'no-folder': 'Open a folder to see its commit history.',
      remote: "Commit Graph isn't available in remote windows yet.",
      untrusted: "Commit Graph doesn't run in an untrusted workspace.",
      'not-a-repo': 'The open folder is not a Git repository.',
      'no-git': 'Git was not found. Install Git and reload the window.',
    };
    const box = el('div', 'unavailable');
    box.appendChild(el('p', '', text[reason]));
    if (reason === 'untrusted') {
      const button = el('button', 'banner-button', 'Manage Workspace Trust');
      button.addEventListener('click', () => send({ type: 'manageTrust' }));
      box.appendChild(button);
    }
    app.appendChild(box);
  }

  // ---- events -----------------------------------------------------------------------------------------------

  windowEl.addEventListener('click', (event) => {
    const row = (event.target as Element).closest('.row') as HTMLElement | null;
    if (row?.dataset.sha) { list.focus(); selectSha(row.dataset.sha, false); }
  });

  list.addEventListener('scroll', () => { render(); maybeLoadMore(); });
  window.addEventListener('resize', () => { render(); maybeLoadMore(); });

  list.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      const first = detailFiles?.[0];
      if (detailData && first) send({ type: 'openDiff', sha: detailData.sha, file: first.path });
      event.preventDefault();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const page = Math.max(1, Math.floor(list.clientHeight / graphRowHeight()) - 1);
    const next = graphMoveSelection(indexOfSha(selectedSha), event.key, page, rows.length);
    if (next >= 0 && rows[next].sha !== selectedSha) selectSha(rows[next].sha, true);
  });

  window.addEventListener('message', (event) => {
    const message = event.data as GraphHostToWebview;
    switch (message.type) {
      case 'rows': {
        loadingMore = false;
        notice.classList.add('hidden');
        hasMore = message.hasMore;
        if (message.reset) {
          const first = Math.floor(list.scrollTop / graphRowHeight());
          const anchor = rows[first]?.sha ?? null;
          const offset = list.scrollTop - first * graphRowHeight();
          rows = message.rows;
          list.scrollTop = graphAnchorAfterReset(anchor, offset, rows) ?? 0;
          if (selectedSha && indexOfSha(selectedSha) < 0) { selectedSha = null; renderDetail(); }
        } else {
          rows = rows.concat(message.rows);
        }
        render();
        maybeLoadMore();
        break;
      }
      case 'focus': {
        if (indexOfSha(message.sha) >= 0) selectSha(message.sha, true);
        break;
      }
      case 'detail':
        if (message.detail.sha === selectedSha) { detailData = message.detail; renderDetail(); }
        break;
      case 'files':
        if (message.sha === selectedSha) { detailFiles = message.files; renderDetail(); }
        break;
      case 'state':
        renderBanner(message.inProgress);
        break;
      case 'loadError':
        loadingMore = false;
        showNotice(message.message, message.retry);
        break;
      case 'unavailable':
        showUnavailable(message.reason);
        break;
    }
  });

  renderDetail();
  send({ type: 'ready' });
})();
