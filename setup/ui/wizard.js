const { listen } = window.__TAURI__.event;
const { invoke } = window.__TAURI__.core;
const app = document.getElementById('app');

// Same wording as main.js (the update window); a separate copy so the verified update page stays untouched.
const LABEL = {
  checking: 'Checking the release…',
  downloading: 'Downloading…',
  verifying: 'Verifying the download…',
  preparing: 'Preparing files…',
  waitingForClose: 'Waiting for Null IDE to close…',
  installing: 'Installing…',
  restarting: 'Starting Null IDE…',
  busy: 'Another setup or download is already running. Close it and try again.',
  needsReapproval: 'The Windows 11 context menu needs one-time administrator approval. Run Setup again and choose Modify to enable it.',
};
const mb = (n) => (n / 1048576).toFixed(1);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}

// phase: loading | error | maintenance | stale | uninstall | wizard | running | failed | done
const S = {
  phase: 'loading', view: null, steps: [], i: 0, kind: 'install', dir: '', config: null, initial: null,
  excluded: [], settings: {}, extensions: [], deleteData: false, note: '', error: '', progress: null, locked: null, done: null,
};

const TITLES = {
  welcome: 'Install Null IDE', options: 'Installation options', builtins: 'Built-in extensions',
  marketplace: 'Extensions from the marketplace', settings: 'A few settings', summary: 'Ready to install',
};

function load() {
  S.phase = 'loading';
  render();
  invoke('wizard_load');
}

listen('view', (e) => {
  const v = e.payload;
  S.view = v; S.dir = v.installDir; S.config = structuredClone(v.config); S.initial = structuredClone(v.config);
  S.excluded = v.page === 'install' && v.manifest ? defaultExcluded(v.manifest.builtins) : [...v.config.excludedBuiltins];
  S.settings = {}; S.extensions = []; S.deleteData = false; S.note = ''; S.i = 0;
  S.kind = v.page === 'modify' ? 'modify' : 'install';
  S.steps = stepsFor(v.page, v.manifest);
  S.phase = v.page === 'install' || v.page === 'modify' ? 'wizard' : v.page;
  render();
});
listen('view-error', (e) => { S.phase = 'error'; S.error = String(e.payload); render(); });
listen('progress', (e) => {
  S.progress = e.payload; S.locked = null;
  const was = S.phase;
  S.phase = e.payload.state === 'failed' ? 'failed' : 'running';
  was === 'running' && S.phase === 'running' ? patchRunning() : render();
});
listen('locked', (e) => { S.locked = e.payload; patchRunning(); });
listen('done', (e) => { S.done = e.payload; S.phase = 'done'; render(); });

function frame(title, sub, body, footer) {
  return [
    h('header', {}, sub ? h('div', { class: 'step' }, sub) : null, h('h1', { id: 'title', tabindex: '-1' }, title)),
    h('div', { class: 'body' }, body),
    h('footer', {}, footer),
  ];
}

function render() {
  const top = document.querySelector('.body')?.scrollTop ?? 0;
  const parts = {
    loading: () => frame('Null IDE Setup', '', h('p', { class: 'muted' }, 'Looking up the latest release…'), []),
    error: () => frame('Setup could not start', '', [h('p', { class: 'error' }, S.error), h('p', { class: 'muted' }, 'Check your internet connection and try again.')],
      [h('span', { class: 'grow' }), button('Close', quit), button('Retry', load, 'primary')]),
    maintenance: pageMaintenance, stale: pageStale, uninstall: pageUninstall, wizard: pageWizard,
    running: pageRunning, failed: pageFailed, done: pageDone,
  };
  app.replaceChildren(...parts[S.phase]());
  const body = document.querySelector('.body');
  if (body) body.scrollTop = top;
  document.getElementById('title')?.focus();
  if (S.phase === 'running') patchRunning();
}

const button = (label, onclick, cls) => h('button', { class: cls || '', onclick }, label);
const quit = () => invoke('quit');
const spacer = () => h('span', { class: 'grow' });

// ---- wizard pages ----

function pageWizard() {
  const step = S.steps[S.i];
  const last = S.i === S.steps.length - 1;
  const installing = S.view.page === 'install';
  const sub = `Step ${S.i + 1} of ${S.steps.length}`;
  const title = step === 'summary' ? (installing ? 'Ready to install' : 'Apply changes') : TITLES[step];
  const pages = { welcome: pageWelcome, options: pageOptions, builtins: pageBuiltins, marketplace: pageMarketplace, settings: pageSettings, summary: pageSummary };
  const footer = [
    installing && !last ? button('Use recommended defaults', useDefaults, 'link') : null,
    spacer(),
    S.i > 0 ? button('Back', () => { S.i--; S.note = ''; render(); }) : button('Cancel', quit),
    button(last ? (installing ? 'Install' : 'Apply') : 'Next', next, 'primary'),
  ];
  return frame(title, sub, [pages[step](), S.note ? h('p', { class: 'note' }, S.note) : null], footer);
}

function pageWelcome() {
  const v = S.view;
  return [
    h('p', {}, `This installs Null IDE ${v.tag} for your user account. No administrator rights are needed.`),
    h('p', { class: 'muted' }, 'Setup downloads the release, checks its SHA256 and installs it. Your settings and extensions are never touched.'),
    v.manifest ? null : h('p', { class: 'note' }, 'This release does not list its built-in extensions, so they cannot be chosen.'),
  ];
}

function pageOptions() {
  const c = S.config;
  const feature = ([key, label, hint]) =>
    h('label', { class: 'row' },
      h('input', { type: 'checkbox', checked: c[key], onchange: (e) => { c[key] = e.target.checked; } }),
      h('span', {}, label, hint ? h('small', {}, hint) : null));
  return [
    S.view.page === 'install'
      ? h('label', { class: 'field' }, 'Install folder',
          h('input', { id: 'dir', type: 'text', value: S.dir, spellcheck: 'false', oninput: (e) => { S.dir = e.target.value; S.note = ''; } }))
      : h('p', { class: 'muted' }, `Installed in ${S.dir}`),
    h('div', { class: 'list' }, FEATURES.map(feature)),
  ];
}

function pageBuiltins() {
  const bs = S.view.manifest.builtins;
  const label = (id) => (bs.find((b) => b.id === id) || { label: id }).label;
  return [
    h('p', { class: 'muted' }, 'Core extensions are always installed. Anything you leave out is not copied to disk; you can add it back later with Modify.'),
    h('div', { class: 'list' }, bs.map((b) =>
      h('label', { class: 'row' },
        h('input', {
          type: 'checkbox', checked: !S.excluded.includes(b.id), disabled: b.locked,
          onchange: (e) => {
            const r = setBuiltin(bs, S.excluded, b.id, e.target.checked);
            S.excluded = r.excluded;
            S.note = r.blockedBy.length ? `${b.label} is needed by ${r.blockedBy.join(', ')}. Turn that off first.` : '';
            render();
          },
        }),
        h('span', {}, b.label, b.locked ? h('em', {}, '  Core') : null,
          h('small', {}, b.description), b.requires.length ? h('small', {}, `Needs ${b.requires.map(label).join(', ')}`) : null)))),
  ];
}

function pageMarketplace() {
  return [
    h('p', { class: 'muted' }, 'Null IDE installs these the first time it starts.'),
    h('div', { class: 'list' }, S.view.manifest.marketplace.map((x) =>
      h('label', { class: 'row' },
        h('input', {
          type: 'checkbox', checked: S.extensions.includes(x.id),
          onchange: (e) => { S.extensions = e.target.checked ? [...S.extensions, x.id] : S.extensions.filter((i) => i !== x.id); },
        }),
        h('span', {}, x.label, h('small', {}, x.description))))),
  ];
}

function settingControl(d) {
  const cur = d.key in S.settings ? S.settings[d.key] : d.default;
  const set = (v) => { S.settings[d.key] = v; };
  if (d.kind === 'choice') {
    return h('select', { id: d.key, onchange: (e) => set(e.target.value) },
      d.options.map((o) => h('option', { value: o.value, selected: o.value === cur }, o.label)));
  }
  if (d.kind === 'bool') return h('input', { id: d.key, type: 'checkbox', checked: cur, onchange: (e) => set(e.target.checked) });
  if (d.kind === 'number') {
    return h('input', { id: d.key, type: 'number', value: cur, min: d.min, max: d.max,
      onchange: (e) => { const n = Number(e.target.value); if (Number.isFinite(n)) set(n); } });
  }
  return h('input', { id: d.key, type: 'text', value: cur, spellcheck: 'false', onchange: (e) => set(e.target.value) });
}

function pageSettings() {
  return [
    h('p', { class: 'muted' }, 'Optional. Anything you do not change keeps Null IDE\'s default, and everything else is in the normal Settings editor.'),
    ...S.view.manifest.settings.map((d) => h('div', { class: 'field' }, h('label', { for: d.key }, d.label), settingControl(d), d.description ? h('small', {}, d.description) : null)),
  ];
}

function pageSummary() {
  return [h('ul', { class: 'summary' }, summaryLines(S).map((l) => h('li', {}, l)))];
}

async function checkDir() {
  try {
    S.dir = await invoke('wizard_check_dir', { path: S.dir });
    S.note = '';
    return true;
  } catch (e) {
    S.note = String(e);
    return false;
  }
}

async function next() {
  if (S.steps[S.i] === 'options' && S.view.page === 'install' && !(await checkDir())) return render();
  if (S.i < S.steps.length - 1) { S.i++; S.note = ''; render(); } else run(S.kind);
}

async function useDefaults() {
  const m = S.view.manifest;
  S.config = structuredClone(S.initial);
  S.excluded = m ? defaultExcluded(m.builtins) : [];
  S.settings = {}; S.extensions = [];
  if (!(await checkDir())) { S.i = S.steps.indexOf('options'); return render(); }
  S.i = S.steps.length - 1;
  render();
}

// ---- maintenance, uninstall, stale ----

function pageMaintenance() {
  return frame('Null IDE is installed', `Version ${S.view.tag}`, [
    h('p', {}, `Installed in ${S.dir}`),
    h('p', { class: 'muted' }, 'Modify changes shortcuts, integrations and built-in extensions. Repair reinstalls this version with your current choices.'),
  ], [
    button('Uninstall…', () => { S.phase = 'uninstall'; render(); }, 'danger'), spacer(),
    button('Close', quit), button('Repair', () => run('repair')),
    button('Modify…', () => { S.kind = 'modify'; S.steps = stepsFor('modify', S.view.manifest); S.view = { ...S.view, page: 'modify' }; S.i = 0; S.phase = 'wizard'; render(); }, 'primary'),
  ]);
}

function pageUninstall() {
  return frame('Uninstall Null IDE', '', [
    h('p', {}, `This removes Null IDE from ${S.dir}, its shortcuts, context menu entries and PATH entry.`),
    h('p', { class: 'muted' }, 'Your settings, extensions and data in the Null user folder are kept, so a later reinstall picks up where you left off.'),
    h('label', { class: 'row' },
      h('input', { type: 'checkbox', checked: S.deleteData, onchange: (e) => { S.deleteData = e.target.checked; } }),
      h('span', {}, 'Also delete my settings, extensions and data', h('small', {}, S.view.userDataDir))),
  ], [spacer(), button('Cancel', quit), button('Uninstall', () => run('uninstall'), 'danger')]);
}

function pageStale() {
  return frame('Null IDE is no longer installed', '', [
    h('p', {}, `Windows still lists Null IDE, but ${S.dir} is gone.`),
    h('p', { class: 'muted' }, 'Remove the leftover entry from Apps & features?'),
  ], [spacer(), button('Cancel', quit), button('Remove entry', () => {
    S.kind = 'removeEntry';
    invoke('wizard_start', { job: { kind: 'removeEntry', installDir: S.dir } }).catch((e) => { S.error = String(e); S.phase = 'error'; render(); });
  }, 'primary')]);
}

// ---- running, failed, done ----

function run(kind) {
  S.kind = kind;
  const job = buildJob(kind, S);
  S.phase = 'running'; S.progress = { state: 'checking' }; S.locked = null;
  render();
  invoke('wizard_start', { job }).catch((e) => {
    const f = startFailure(kind, String(e));
    S.phase = f.phase; S.note = f.note; S.progress = { state: 'failed', message: f.note, log: null };
    render();
  });
}

const VERB = { install: 'Installing Null IDE', modify: 'Applying changes', repair: 'Repairing Null IDE', uninstall: 'Uninstalling Null IDE' };

function pageRunning() {
  return frame(VERB[S.kind] || 'Working', '', [
    h('p', { id: 'run-status' }, 'Starting…'),
    h('progress', { id: 'run-bar', max: '100', hidden: true }),
    h('p', { id: 'run-detail', class: 'muted' }),
    h('div', { id: 'run-locked', hidden: true },
      h('p', { id: 'run-locked-text', class: 'note' }),
      h('div', { style: 'display:flex;gap:8px;margin-top:8px' },
        button('Retry', () => answer('retry')), button('Close Null IDE', () => answer('force')), button('Cancel', () => answer('cancel')))),
  ], []);
}

function answer(name) { S.locked = null; patchRunning(); invoke('action', { name }); }

function patchRunning() {
  const status = document.getElementById('run-status');
  if (!status || S.phase !== 'running') return;
  const p = S.progress || { state: 'checking' };
  const bar = document.getElementById('run-bar');
  bar.hidden = p.state !== 'downloading';
  document.getElementById('run-detail').textContent = '';
  if (p.state === 'downloading') {
    bar.value = p.total ? (p.bytes / p.total) * 100 : 0;
    document.getElementById('run-detail').textContent = `${mb(p.bytes)} of ${mb(p.total)} MB (${mb(p.bytesPerSec)} MB/s)`;
  }
  status.textContent = LABEL[p.state] ?? p.state;
  document.getElementById('run-locked').hidden = !S.locked;
  if (S.locked) {
    document.getElementById('run-locked-text').textContent =
      `Null IDE is still running (${S.locked.join(', ')}). Save your work and close it, or use Close Null IDE.`;
  }
}

function pageFailed() {
  const p = S.progress;
  return frame('Setup did not finish', '', [
    h('p', { class: 'error' }, p.message),
    p.log ? h('p', { class: 'muted' }, `Log: ${p.log}`) : null,
  ], [
    spacer(), button('Copy diagnostics', copyDiagnostics), button('Close', quit),
    S.view.page === 'install' || S.view.page === 'modify' || S.kind === 'repair' || S.kind === 'uninstall' ? button('Retry', () => run(S.kind), 'primary') : null,
  ]);
}

async function copyDiagnostics(e) {
  await navigator.clipboard.writeText(await invoke('diagnostics'));
  e.target.textContent = 'Copied';
}

function pageDone() {
  const warning = S.done && S.done.warning;
  const text = {
    install: 'Null IDE is installed.', modify: 'Your changes are applied.', repair: 'Null IDE was repaired.',
    uninstall: 'Null IDE was removed.', removeEntry: 'The leftover entry was removed.',
  }[S.kind];
  const canLaunch = S.kind === 'install' || S.kind === 'repair' || S.kind === 'modify';
  return frame(warning ? 'Finished with a warning' : 'All done', '', [
    h('p', {}, text),
    warning ? h('p', { class: 'note' }, warning) : null,
    warning ? h('p', { class: 'muted' }, 'Run Setup again and choose Repair or Modify to retry the failed part.') : null,
    S.progress && S.progress.state === 'needsReapproval' ? h('p', { class: 'note' }, LABEL.needsReapproval) : null,
  ], [
    spacer(),
    warning ? button('Copy diagnostics', copyDiagnostics) : null,
    button('Close', quit, canLaunch ? '' : 'primary'),
    canLaunch ? button('Launch Null IDE', () => invoke('wizard_launch', { dir: S.dir }).then(quit).catch((e) => { S.note = String(e); }), 'primary') : null,
  ]);
}

load();
