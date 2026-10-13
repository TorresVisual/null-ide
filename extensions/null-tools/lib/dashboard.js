'use strict';
(function main() {
    const vscode = acquireVsCodeApi();
    const byId = (id) => document.getElementById(id);
    const list = byId('list');
    const search = byId('search');
    const sort = byId('sort');
    const SVG_NS = 'http://www.w3.org/2000/svg';
    let projects = [];
    let loaded = false;
    let rows = [];
    let selectedPath;
    let selectedIndex = 0;
    function el(tag, className, text) {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined)
            node.textContent = text;
        return node;
    }
    function icon(name) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'i');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttribute('href', `#i-${name}`);
        svg.appendChild(use);
        return svg;
    }
    function send(type, project, extra = {}) {
        vscode.postMessage(Object.assign(Object.assign({ type }, (project ? { path: project.path } : {})), extra));
    }
    function actionButton(project, label, type, glyph, extra = {}) {
        const button = el('button', glyph ? 'icon-btn' : 'text-btn');
        button.tabIndex = -1;
        button.title = label;
        button.setAttribute('aria-label', label);
        if (glyph)
            button.appendChild(icon(glyph));
        else
            button.textContent = label;
        button.addEventListener('click', event => { event.stopPropagation(); send(type, project, extra); });
        return button;
    }
    function buildRow(project, index) {
        var _a, _b;
        const row = el('div', project.available ? 'row' : 'row missing');
        row.id = `row-${index}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', 'false');
        row.dataset.path = project.path;
        row.title = project.path;
        const lead = el('span', project.pinned ? 'lead pinned' : 'lead');
        if (project.pinned)
            lead.appendChild(icon('pin'));
        const branch = el('span', 'branch');
        if (!project.available)
            branch.textContent = 'Folder missing';
        else if (project.gitStatus) {
            branch.append(icon('branch'), el('span', 'text', project.gitStatus.branch));
            if (project.gitStatus.dirty) {
                const dot = el('span', 'dirty');
                dot.title = 'Uncommitted changes';
                dot.setAttribute('role', 'img');
                dot.setAttribute('aria-label', 'Uncommitted changes');
                branch.appendChild(dot);
            }
        }
        const time = el('span', 'time', shortProjectTime(project.timestamp));
        time.title = relativeProjectTime(project.timestamp);
        const actions = el('div', 'actions');
        if (project.available) {
            actions.append(actionButton(project, 'Open in new window', 'openProject', 'window', { forceNewWindow: true }), actionButton(project, project.pinned ? 'Unpin' : 'Pin to top', 'setPinned', 'pin', { pinned: !project.pinned }), actionButton(project, 'Reveal in File Explorer', 'revealProject', 'folder'), actionButton(project, 'Copy path', 'copyProjectPath', 'copy'));
        }
        else
            actions.appendChild(actionButton(project, 'Locate…', 'locateProject', undefined));
        actions.appendChild(actionButton(project, 'Remove from list', 'removeProject', 'x'));
        row.append(lead, el('span', 'name', project.label), el('span', 'path', projectDirectory(project.path)), el('span', 'type', (_a = project.projectType) !== null && _a !== void 0 ? _a : ''), branch, el('span', 'account', (_b = project.account) !== null && _b !== void 0 ? _b : ''), time, actions);
        row.addEventListener('click', () => open(project, false));
        row.addEventListener('mousemove', () => { if (rows[selectedIndex] !== row)
            select(rows.indexOf(row), false); });
        return row;
    }
    function open(project, forceNewWindow) {
        send(project.available ? 'openProject' : 'locateProject', project, project.available ? { forceNewWindow } : {});
    }
    function projectAt(row) {
        return projects.find(project => project.path === (row === null || row === void 0 ? void 0 : row.dataset.path));
    }
    function select(index, scroll) {
        var _a, _b;
        if (!rows.length)
            return;
        index = Math.max(0, Math.min(rows.length - 1, index));
        (_a = rows[selectedIndex]) === null || _a === void 0 ? void 0 : _a.setAttribute('aria-selected', 'false');
        (_b = rows[selectedIndex]) === null || _b === void 0 ? void 0 : _b.querySelectorAll('button').forEach(button => { button.tabIndex = -1; });
        selectedIndex = index;
        const row = rows[index];
        row.setAttribute('aria-selected', 'true');
        row.querySelectorAll('button').forEach(button => { button.tabIndex = 0; });
        selectedPath = row.dataset.path;
        search.setAttribute('aria-activedescendant', row.id);
        if (scroll)
            row.scrollIntoView({ block: 'nearest' });
    }
    function emptyMessage() {
        const empty = el('div', '');
        empty.id = 'empty';
        const query = search.value.trim();
        empty.append(el('strong', '', query ? `No projects match “${query}”` : 'No recent projects yet'), document.createTextNode(query ? 'Search matches the project name and its path.' : 'Open a folder, clone a repository or start a new project from Start. Projects you open show up here.'));
        return empty;
    }
    function render() {
        const scrollTop = list.scrollTop;
        list.replaceChildren();
        rows = [];
        if (!loaded)
            return;
        const sections = projectSections(projects, search.value, sort.value);
        if (!sections.length) {
            list.appendChild(emptyMessage());
            search.removeAttribute('aria-activedescendant');
            return;
        }
        for (const section of sections) {
            const heading = el('div', 'section-title', section.title);
            heading.appendChild(el('span', 'count', String(section.projects.length)));
            list.appendChild(heading);
            for (const project of section.projects) {
                const row = buildRow(project, rows.length);
                rows.push(row);
                list.appendChild(row);
            }
        }
        const keep = rows.findIndex(row => row.dataset.path === selectedPath);
        select(keep >= 0 ? keep : Math.min(selectedIndex, rows.length - 1), false);
        list.scrollTop = scrollTop;
    }
    function renderHome(message) {
        const update = byId('update');
        update.hidden = !message.update;
        if (message.update) {
            update.replaceChildren(icon('update'), el('span', 'label', message.update.ready ? `Restart to install ${message.update.version}` : `Downloading ${message.update.version}…`));
            update.setAttribute('aria-disabled', String(!message.update.ready));
        }
        byId('today').hidden = message.todayMs === undefined;
        if (message.todayMs !== undefined)
            byId('today-value').textContent = formatDuration(message.todayMs);
        byId('env').hidden = message.envMissing === undefined;
        if (message.envMissing !== undefined)
            byId('env-value').textContent = `${message.envMissing} missing`;
    }
    window.addEventListener('message', (event) => {
        const message = event.data;
        if (message.type === 'projects') {
            loaded = true;
            projects = message.projects.map(project => { var _a, _b; return (Object.assign(Object.assign({}, project), { gitStatus: (_b = (_a = projects.find(known => known.path === project.path)) === null || _a === void 0 ? void 0 : _a.gitStatus) !== null && _b !== void 0 ? _b : null })); });
            render();
        }
        else if (message.type === 'gitStatus') {
            const project = projects.find(item => item.path === message.path);
            if (project) {
                project.gitStatus = message.status;
                render();
            }
        }
        else
            renderHome(message);
    });
    search.addEventListener('input', () => { selectedPath = undefined; selectedIndex = 0; render(); });
    sort.addEventListener('change', render);
    document.addEventListener('keydown', event => {
        const target = event.target;
        const jumps = { ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 };
        if (event.key in jumps || ((event.key === 'Home' || event.key === 'End') && !search.value)) {
            if (target === sort)
                return;
            event.preventDefault();
            select(event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : selectedIndex + jumps[event.key], true);
        }
        else if (event.key === 'Enter' && target !== sort && !(target.tagName === 'BUTTON')) {
            const project = projectAt(rows[selectedIndex]);
            if (project) {
                event.preventDefault();
                open(project, event.ctrlKey || event.shiftKey);
            }
        }
        else if (event.key === 'Delete' && target !== sort && !search.value) {
            const project = projectAt(rows[selectedIndex]);
            if (project) {
                event.preventDefault();
                send('removeProject', project);
            }
        }
        else if (event.altKey && event.key.toLowerCase() === 'p') {
            const project = projectAt(rows[selectedIndex]);
            if (project) {
                event.preventDefault();
                send('setPinned', project, { pinned: !project.pinned });
            }
        }
        else if (event.key === 'Escape' && search.value) {
            search.value = '';
            selectedPath = undefined;
            render();
        }
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && !/^(INPUT|SELECT|BUTTON)$/.test(target.tagName)) {
            search.focus();
        }
    });
    window.addEventListener('focus', () => { if (document.activeElement === document.body)
        search.focus(); });
    const clicks = { refresh: 'refresh', 'open-folder': 'openFolder', 'new-project': 'newProject', 'clone-repo': 'cloneRepo', 'open-issues': 'openIssues', 'open-accounts': 'openAccounts', env: 'openEnv' };
    for (const [id, type] of Object.entries(clicks))
        byId(id).addEventListener('click', () => send(type));
    byId('update').addEventListener('click', () => { if (byId('update').getAttribute('aria-disabled') !== 'true')
        send('installUpdate'); });
    search.focus();
    send('ready');
})();
