// Pure rules for the wizard. A plain script (no import/export): wizard.html loads it, and
// setup/ui-tests/wizard-model.test.mjs loads it through node:vm. Top-level `function`/`const` declarations only, no DOM.

const FEATURES = [
  ['desktopShortcut', 'Desktop shortcut', null],
  ['startMenuShortcut', 'Start Menu shortcut', null],
  ['safeModeShortcut', 'Start Menu shortcut for Safe Mode', null],
  ['path', 'Add "null" to PATH', 'So "null ." works in a terminal.'],
  ['contextMenu', 'Explorer context menu', 'The Windows 11 menu may ask for administrator approval once.'],
  ['fileAssociations', 'File associations', null],
  ['previewHandler', 'Preview pane in Explorer', null],
  ['widgets', 'Desktop widgets', 'Projects, Issues and Pull Requests on your desktop. Starts a small program at login.'],
];

function builtinById(builtins, id) {
  return builtins.find((b) => b.id === id);
}

/** `id` and everything it needs, following `requires` (cycle-safe). */
function withRequirements(builtins, id) {
  const seen = [];
  const visit = (x) => {
    if (seen.includes(x)) return;
    seen.push(x);
    const b = builtinById(builtins, x);
    if (b) b.requires.forEach(visit);
  };
  visit(id);
  return seen;
}

/** Ticks or unticks one built-in. An untick that an included built-in needs is refused: `blockedBy` names the dependents. */
function setBuiltin(builtins, excluded, id, on) {
  const b = builtinById(builtins, id);
  if (!b || b.locked) return { excluded, blockedBy: [] };
  if (on) {
    const need = withRequirements(builtins, id);
    return { excluded: excluded.filter((x) => !need.includes(x)), blockedBy: [] };
  }
  const by = builtins.filter((o) => !excluded.includes(o.id) && o.requires.includes(id));
  if (by.length) return { excluded, blockedBy: by.map((o) => o.label) };
  return { excluded: excluded.includes(id) ? excluded : [...excluded, id], blockedBy: [] };
}

/** What a person gets with "recommended defaults": default-off built-ins, minus those an included one needs. */
function defaultExcluded(builtins) {
  let ex = builtins.filter((b) => !b.default && !b.locked).map((b) => b.id);
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of builtins) {
      if (ex.includes(b.id)) continue;
      for (const r of b.requires) {
        if (ex.includes(r)) {
          ex = ex.filter((x) => x !== r);
          changed = true;
        }
      }
    }
  }
  return ex;
}

/** Only values that differ from the manifest default are sent, so an untouched page writes nothing into first-run.json. */
function changedSettings(defs, values) {
  const out = {};
  for (const d of defs) {
    if (d.key in values && values[d.key] !== d.default) out[d.key] = values[d.key];
  }
  return out;
}

function stepsFor(page, manifest) {
  const has = (k) => Boolean(manifest && manifest[k] && manifest[k].length);
  if (page === 'install') {
    return ['welcome', 'options', has('builtins') && 'builtins', has('marketplace') && 'marketplace', has('settings') && 'settings', 'summary'].filter(Boolean);
  }
  if (page === 'modify') return ['options', has('builtins') && 'builtins', 'summary'].filter(Boolean);
  return [];
}

function buildJob(kind, s) {
  const withChoices = kind === 'install' || kind === 'modify';
  const manifest = s.view.manifest;
  return {
    kind,
    installDir: s.dir,
    config: withChoices ? { ...s.config, excludedBuiltins: s.excluded } : null,
    firstRun: kind === 'install' ? { schema: 1, settings: changedSettings(manifest ? manifest.settings : [], s.settings), extensions: s.extensions } : null,
    deleteData: Boolean(s.deleteData),
  };
}

function summaryLines(s) {
  const lines = [`Install folder: ${s.dir}`];
  for (const [key, label] of FEATURES) lines.push(`${label}: ${s.config[key] ? 'on' : 'off'}`);
  const manifest = s.view.manifest;
  if (manifest && manifest.builtins.length) {
    const off = s.excluded.map((id) => (builtinById(manifest.builtins, id) || { label: id }).label);
    lines.push(off.length ? `Built-in extensions left out: ${off.join(', ')}` : 'Built-in extensions: all');
  }
  if (manifest) {
    for (const [key, value] of Object.entries(changedSettings(manifest.settings, s.settings))) {
      const def = manifest.settings.find((d) => d.key === key);
      lines.push(`${def.label}: ${value}`);
    }
  }
  return lines;
}

/** What the page does when the backend refuses a job before it starts: install and modify keep the person's choices. */
function startFailure(kind, message) {
  return { phase: kind === 'install' || kind === 'modify' ? 'wizard' : 'failed', note: message };
}
