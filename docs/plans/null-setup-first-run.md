# Null Setup, Sub-project 2c-1: First-Run Data Path Implementation Plan

> **For agentic workers:** See Execution Options below — the checked Execution Mode box names the REQUIRED SUB-SKILL (superpowers:executing-plans or superpowers:subagent-driven-development).

**Goal:** Make "choices made at install time" reach the IDE: `builtins.json` carries the settings and marketplace tables, `null-setup install --first-run <file>` validates the choices against it and writes `%APPDATA%\Null\null-setup\first-run.json`, and null-tools consumes that file once on its first start (allowlisted settings only, set only when the user has no value, extensions installed one at a time, failures reported once with Retry).

**Architecture:** The contract is one small JSON file with two independent guards: `setup/core` validates it against the manifest of the version being installed (`builtins.rs` gains `settings` / `marketplace`, new `first_run.rs`), and null-tools re-validates it against its own compiled-in allowlist because a file in a user folder is not trusted. The null-tools side follows the repo's pure-plus-glue split: `firstRun.ts` (no `vscode` import, host injected) holds all rules, `firstRunIntegration.ts` is the only `vscode` file. A node test pins the allowlist to `setup/builtins.config.json` so the two lists cannot drift.

**Tech Stack:** Rust (`serde_json` already a dependency; no new crates), Node ≥ 18 (`node --test`), TypeScript (null-tools, CommonJS, `out/` tracked), Markdown.

**Spec:** `docs/specs/null-setup-installer-design.md` — "State and files" (`first-run.json`), "Wizard flow" step 5 (the six settings), "First launch". This is the first of three slices that replace the spec's single "2c" (see Task 8): **2c-1 first-run data path (this plan)**, 2c-2 wizard + stub + Add/Remove Programs, 2c-3 `Null: Setup` in the IDE + retiring Inno and the PowerShell scripts. Predecessors: `docs/plans/null-setup-installer-engine.md` (2a), `docs/plans/null-setup-registrations.md` (2b).

## Execution Options

Leave every box below unchecked. The executing skill resolves them with
your human partner before Step 1 and checks the chosen boxes itself.

**Execution Target:**
- [x] Current branch (no isolation)
- [ ] New feature branch (no worktree)
- [ ] Worktree (superpowers:using-git-worktrees)

**Execution Mode:**
- [x] Inline execution (superpowers:executing-plans)
- [ ] Subagent-driven execution (superpowers:subagent-driven-development)

## Global Constraints

- Supported Windows: Windows 11 and Windows 10 22H2. No code signing.
- The installer never writes inside `%APPDATA%\Null\User\` (settings, keybindings, snippets, profiles) and never touches extension state. Its only write on the IDE's behalf is `%APPDATA%\Null\null-setup\first-run.json`.
- First launch (spec): "set a key only if the user has no value for it; only allowlisted keys"; marketplace extensions "installed one at a time with a per-extension timeout"; failure produces "one 'N extensions could not be installed (Retry)' notification and never blocks anything"; "the file is deleted only after it was processed, so a crash retries on next launch".
- `builtins.json` stays `"schema": 1`; `settings` and `marketplace` are additive and optional, so a package built before this plan still parses.
- Application defaults stay in `product.json → configurationDefaults` (and `null-theme`'s `configurationDefaults`); the manifest's `default` values only describe what the IDE has when the key is unset.
- null-tools conventions: edit `src/` only, never `out/`; after editing run `npm run compile` in `extensions/null-tools` and commit the refreshed `out/` as `chore: refresh null-tools compiled output`; a new test file is skipped until it is added to `package.json`'s `test` script **and** `tsconfig.json`'s `include`. Only `firstRunIntegration.ts` may import `vscode`.
- No new dependencies in `setup/` or `extensions/null-tools`.
- Commit style: `feat(setup): …`, `feat(null-tools): …`, `docs: …`; end messages with the attribution trailer the harness specifies.

## Review Focus

Input classes the spec implies but the happy path never exercises, most likely first. Each has a test in the task named in brackets.

1. **A `first-run.json` key that is not one of the seven, or that is `__proto__` / `constructor` / `terminal.integrated.shell.windows`** — must be ignored, never written to settings, never throw. A plain `ALLOWED[key]` lookup would find `constructor`. [Task 6]
2. **A setting the user already changed to a falsy value (`false`, `0`, `""`)** — still the user's; first-run must not overwrite it. The check is "has a global value", not "truthy". [Task 6 pure test; Task 7 glue uses `!== undefined`]
3. **A corrupt, empty, BOM-prefixed or wrong-schema file** — corrupt/wrong schema is discarded once (not retried forever) without an exception; a BOM is accepted (PowerShell and Notepad write one). [Task 6]
4. **An extension install that throws or never returns** — later extensions still install, the hung one times out, the file is still deleted, and the failed ids come back for the single Retry notification. [Task 6]
5. **A settings write that fails (e.g. the user's `settings.json` is invalid JSON), or the file already gone because a second window processed it first** — a failed write keeps the file for the next launch; a missing file is a no-op and deleting it twice does not throw. [Task 6 and Task 7]

Also covered: install-time validation rejects an unknown key, a value outside the table, an out-of-range number and an extension id that is not in the marketplace table, and writes nothing in those cases [Task 3]; an empty choice set writes no file [Task 3].

---

## File Structure

```
setup/
├── builtins.config.json                  # MODIFY add "settings" (7 keys) and "marketplace": []
├── core/src/
│   ├── builtins.rs                       # MODIFY SettingDef, SettingKind, MarketplaceExt, accepts(), valid_extension_id(), parse() checks
│   ├── first_run.rs                      # NEW FirstRun, from_json, validate, dir, write, save_from_file
│   └── lib.rs                            # MODIFY pub mod first_run;
├── core/tests/
│   ├── builtins.rs                       # MODIFY tables + the real config parses
│   └── first_run.rs                      # NEW
└── app/src/
    ├── args.rs                           # MODIFY --first-run <abs file>, install only
    └── cli.rs                            # MODIFY save the file after a successful install
scripts/
├── gen-builtins.mjs                      # MODIFY pass settings / marketplace through
└── gen-builtins.test.mjs                 # MODIFY
extensions/null-tools/
├── package.json                          # MODIFY null.updates.check setting; add firstRun.test.js to "test"
├── tsconfig.json                         # MODIFY include src/firstRun.test.ts
├── src/updaterIntegration.ts             # MODIFY gate the startup check on null.updates.check
├── src/firstRun.ts                       # NEW pure: allowlist, parse, runFirstRun, installAll
├── src/firstRun.test.ts                  # NEW
├── src/firstRunIntegration.ts            # NEW the vscode glue (host over fs + vscode.workspace)
├── src/extension.ts                      # MODIFY registerFirstRunFeature(context)
└── out/…                                 # REFRESH via npm run compile
docs/specs/null-setup-installer-design.md # MODIFY sequencing: 2c split in three
CLAUDE.md                                 # MODIFY null-setup + null-tools notes
```

The seven keys are the spec's six wizard choices (color theme variant, editor font family **and** size, auto save, format on save, update check, menu bar) — font is two keys.

---

### Task 1: Settings and marketplace tables in the manifest source

**Files:**
- Modify: `setup/builtins.config.json`
- Modify: `scripts/gen-builtins.mjs`
- Test: `scripts/gen-builtins.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `builtins.json` (the generated file) gains top-level `settings: SettingDef[]` and `marketplace: {id,label,description?}[]`. A `SettingDef` is `{ key, label, description, kind: "choice"|"bool"|"number"|"text", default, options?: {value,label}[], min?, max? }`. Tasks 2, 3 and 6 rely on exactly these field names.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/gen-builtins.test.mjs`:

```js
test('settings and marketplace pass through and default to empty', () => {
  const s = [{ key: 'files.autoSave', label: 'Auto save', kind: 'choice', default: 'off', options: [{ value: 'off', label: 'Off' }] }];
  const m = build({ builtins: [{ id: 'null-a' }], settings: s }, read, ['null-a']);
  assert.deepEqual(m.settings, s);
  assert.deepEqual(m.marketplace, []);
  const bare = build({ builtins: [{ id: 'null-a' }] }, read, []);
  assert.deepEqual([bare.settings, bare.marketplace], [[], []]);
});

test('the real repo settings table lists the seven first-run settings with valid defaults', () => {
  const { settings, marketplace } = main();
  assert.deepEqual(settings.map((s) => s.key), [
    'workbench.colorTheme', 'editor.fontFamily', 'editor.fontSize', 'files.autoSave',
    'editor.formatOnSave', 'window.menuBarVisibility', 'null.updates.check',
  ]);
  for (const s of settings) {
    assert.ok(s.label && s.description, `${s.key} needs a label and a description`);
    assert.ok(['choice', 'bool', 'number', 'text'].includes(s.kind), s.key);
    if (s.kind === 'choice') assert.ok(s.options.some((o) => o.value === s.default), `${s.key} default is not an option`);
    if (s.kind === 'bool') assert.equal(typeof s.default, 'boolean', s.key);
    if (s.kind === 'number') assert.ok(s.default >= s.min && s.default <= s.max, `${s.key} default out of range`);
    if (s.kind === 'text') assert.equal(typeof s.default, 'string', s.key);
  }
  assert.deepEqual(marketplace, []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test scripts/gen-builtins.test.mjs`
Expected: FAIL — `m.settings` is `undefined`.

- [ ] **Step 3: Pass the tables through**

In `scripts/gen-builtins.mjs`, replace the last line of `build()`, `return { schema: 1, builtins };`, with:

```js
  return { schema: 1, builtins, settings: config.settings ?? [], marketplace: config.marketplace ?? [] };
```

Replace the end of `setup/builtins.config.json` — the line `  ]` and `}` that close the `builtins` array and the object — with:

```json
  ],
  "settings": [
    {
      "key": "workbench.colorTheme", "label": "Color theme", "description": "The look of the editor and the workbench.",
      "kind": "choice", "default": "Null Dark",
      "options": [
        { "value": "Null Dark", "label": "Null Dark" },
        { "value": "Null OLED", "label": "Null OLED" },
        { "value": "Null Light", "label": "Null Light" },
        { "value": "Null Retro", "label": "Null Retro" }
      ]
    },
    {
      "key": "editor.fontFamily", "label": "Editor font", "description": "A CSS font list; the first installed family is used.",
      "kind": "text", "default": "'Geist Mono', 'JetBrains Mono', 'Cascadia Code', monospace"
    },
    {
      "key": "editor.fontSize", "label": "Editor font size", "description": "In pixels.",
      "kind": "number", "default": 13, "min": 8, "max": 40
    },
    {
      "key": "files.autoSave", "label": "Auto save", "description": "When edited files are saved without asking.",
      "kind": "choice", "default": "off",
      "options": [
        { "value": "off", "label": "Off" },
        { "value": "afterDelay", "label": "After a delay" },
        { "value": "onFocusChange", "label": "When the editor loses focus" },
        { "value": "onWindowChange", "label": "When the window loses focus" }
      ]
    },
    {
      "key": "editor.formatOnSave", "label": "Format on save", "description": "Run the formatter every time a file is saved.",
      "kind": "bool", "default": false
    },
    {
      "key": "window.menuBarVisibility", "label": "Menu bar", "description": "Classic shows the full menu bar; compact folds it into one button.",
      "kind": "choice", "default": "classic",
      "options": [
        { "value": "classic", "label": "Classic" },
        { "value": "compact", "label": "Compact" }
      ]
    },
    {
      "key": "null.updates.check", "label": "Check for updates", "description": "Look for a new Null IDE release when the IDE starts.",
      "kind": "bool", "default": true
    }
  ],
  "marketplace": []
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test scripts/gen-builtins.test.mjs`
Expected: PASS (all tests, the original five included).

- [ ] **Step 5: Commit**

```bash
git add setup/builtins.config.json scripts/gen-builtins.mjs scripts/gen-builtins.test.mjs
git commit -m "feat(setup): settings and marketplace tables in builtins.json"
```

---

### Task 2: Manifest types, value rules and validation in `setup/core`

**Files:**
- Modify: `setup/core/src/builtins.rs`
- Test: `setup/core/tests/builtins.rs`

**Interfaces:**
- Consumes: the JSON shape from Task 1.
- Produces (in `null_setup_core::builtins`): `Manifest { schema, builtins, settings: Vec<SettingDef>, marketplace: Vec<MarketplaceExt> }`; `SettingDef::accepts(&self, &serde_json::Value) -> bool`; `pub fn valid_extension_id(&str) -> bool`; `parse()` additionally rejects duplicate/empty setting keys, a `choice` without options, a default that its own `accepts` refuses, and an invalid marketplace id. Task 3 calls `accepts` and `valid_extension_id`.

- [ ] **Step 1: Write the failing tests**

Append to `setup/core/tests/builtins.rs`:

```rust
use null_setup_core::builtins::{valid_extension_id, SettingKind};
use serde_json::json;

const S: &str = r#"{"schema":1,"builtins":[],"settings":[
  {"key":"workbench.colorTheme","label":"Theme","kind":"choice","default":"Null Dark",
   "options":[{"value":"Null Dark","label":"Dark"},{"value":"Null Light","label":"Light"}]},
  {"key":"editor.fontSize","label":"Size","kind":"number","default":13,"min":8,"max":40},
  {"key":"editor.formatOnSave","label":"Format","kind":"bool","default":false},
  {"key":"editor.fontFamily","label":"Font","kind":"text","default":"Geist Mono"}],
 "marketplace":[{"id":"ms-python.python","label":"Python"}]}"#;

#[test]
fn a_manifest_without_the_new_tables_still_parses() {
    let m = parse(M).unwrap();
    assert!(m.settings.is_empty() && m.marketplace.is_empty());
}

#[test]
fn settings_and_marketplace_are_read() {
    let m = parse(S).unwrap();
    assert_eq!(m.settings.len(), 4);
    assert_eq!(m.settings[0].kind, SettingKind::Choice);
    assert_eq!(m.settings[1].min, Some(8.0));
    assert_eq!(m.marketplace[0].id, "ms-python.python");
}

#[test]
fn accepts_checks_each_kind() {
    let m = parse(S).unwrap();
    let (theme, size, fmt, font) = (&m.settings[0], &m.settings[1], &m.settings[2], &m.settings[3]);
    assert!(theme.accepts(&json!("Null Light")) && !theme.accepts(&json!("Solarized")) && !theme.accepts(&json!(1)));
    assert!(size.accepts(&json!(8)) && size.accepts(&json!(40)) && size.accepts(&json!(13.5)));
    assert!(!size.accepts(&json!(7)) && !size.accepts(&json!(41)) && !size.accepts(&json!("13")));
    assert!(fmt.accepts(&json!(true)) && !fmt.accepts(&json!("true")) && !fmt.accepts(&json!(0)));
    assert!(font.accepts(&json!("Cascadia Code, monospace")));
    assert!(!font.accepts(&json!("")) && !font.accepts(&json!("a\nb")) && !font.accepts(&json!("x".repeat(201))));
}

#[test]
fn parse_rejects_bad_settings_and_marketplace_tables() {
    let with = |settings: &str, market: &str| format!(r#"{{"schema":1,"builtins":[],"settings":{settings},"marketplace":{market}}}"#);
    let bool_setting = |key: &str| format!(r#"{{"key":"{key}","label":"x","kind":"bool","default":true}}"#);
    // duplicate and empty keys
    assert!(parse(&with(&format!("[{0},{0}]", bool_setting("a.b")), "[]")).is_err());
    assert!(parse(&with(&format!("[{}]", bool_setting("")), "[]")).is_err());
    // a choice without options, a default outside the options, a default out of range, a wrongly typed default
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"choice","default":"x"}]"#, "[]")).is_err());
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"choice","default":"z","options":[{"value":"x","label":"x"}]}]"#, "[]")).is_err());
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"number","default":50,"min":1,"max":10}]"#, "[]")).is_err());
    assert!(parse(&with(r#"[{"key":"a","label":"x","kind":"bool","default":"yes"}]"#, "[]")).is_err());
    // marketplace ids are passed to the extension installer
    for bad in ["../x", "a", "a.b.c", ".b", "a.", "a b.c", ""] {
        assert!(parse(&with("[]", &format!(r#"[{{"id":"{bad}","label":"x"}}]"#))).is_err(), "{bad:?}");
    }
}

#[test]
fn extension_ids_are_publisher_dot_name() {
    assert!(valid_extension_id("ms-python.python") && valid_extension_id("A1.b-2"));
    assert!(!valid_extension_id("python") && !valid_extension_id("a.b.c") && !valid_extension_id("-a.b") && !valid_extension_id("a.b/"));
}

#[test]
fn the_real_repo_settings_table_parses() {
    // setup/core/ -> setup/builtins.config.json; built-ins are generated at build time, so only the new tables are checked here.
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("builtins.config.json");
    let cfg: serde_json::Value = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let text = json!({ "schema": 1, "builtins": [], "settings": cfg["settings"], "marketplace": cfg["marketplace"] }).to_string();
    assert_eq!(parse(&text).unwrap().settings.len(), 7);
}
```

- [ ] **Step 2: Run to verify they fail**

Run (from `setup/`): `cargo test --locked -p null-setup-core --test builtins`
Expected: FAIL to compile — `valid_extension_id`, `SettingKind`, `m.settings` do not exist.

- [ ] **Step 3: Implement**

In `setup/core/src/builtins.rs`: add `use serde_json::Value;` next to `use serde::Deserialize;`, add the following after the `Builtin` struct, and replace the `Manifest` struct and the end of `parse`.

```rust
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct Choice {
    pub value: String,
    pub label: String,
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SettingKind { Choice, Bool, Number, Text }

/// One IDE setting the installer may preset. `default` is what the IDE has when the key is unset.
#[derive(Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingDef {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    pub kind: SettingKind,
    pub default: Value,
    #[serde(default)]
    pub options: Vec<Choice>,
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl SettingDef {
    /// The only values `first-run.json` may carry for this key. null-tools has the same rules in `firstRun.ts`.
    pub fn accepts(&self, v: &Value) -> bool {
        match self.kind {
            SettingKind::Choice => v.as_str().is_some_and(|s| self.options.iter().any(|o| o.value == s)),
            SettingKind::Bool => v.is_boolean(),
            SettingKind::Number => v
                .as_f64()
                .is_some_and(|n| self.min.map_or(true, |m| n >= m) && self.max.map_or(true, |m| n <= m)),
            SettingKind::Text => v.as_str().is_some_and(|s| !s.is_empty() && s.chars().count() <= 200 && !s.chars().any(char::is_control)),
        }
    }
}

/// An extension the IDE installs from the marketplace on first launch.
#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct MarketplaceExt {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
}

/// `publisher.name`, each part alphanumeric or `-` and starting alphanumeric. The id reaches the extension installer.
pub fn valid_extension_id(id: &str) -> bool {
    let part = |p: &str| p.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    matches!(id.split_once('.'), Some((a, b)) if part(a) && part(b))
}
```

Replace the `Manifest` struct with:

```rust
#[derive(Deserialize, Debug, PartialEq)]
pub struct Manifest {
    pub schema: u32,
    pub builtins: Vec<Builtin>,
    #[serde(default)]
    pub settings: Vec<SettingDef>,
    #[serde(default)]
    pub marketplace: Vec<MarketplaceExt>,
}
```

In `parse`, replace the final `Ok(m)` with:

```rust
    let mut keys = HashSet::new();
    for s in &m.settings {
        if s.key.is_empty() || !keys.insert(s.key.as_str()) {
            return Err(Error::Package(format!("{FILE}: empty or duplicate setting key {:?}", s.key)));
        }
        if s.kind == SettingKind::Choice && s.options.is_empty() {
            return Err(Error::Package(format!("{FILE}: {} is a choice without options", s.key)));
        }
        if !s.accepts(&s.default) {
            return Err(Error::Package(format!("{FILE}: the default of {} is not a valid value for it", s.key)));
        }
    }
    for e in &m.marketplace {
        if !valid_extension_id(&e.id) {
            return Err(Error::Package(format!("{FILE}: invalid marketplace extension id {:?}", e.id)));
        }
    }
    Ok(m)
```

- [ ] **Step 4: Run to verify they pass**

Run (from `setup/`): `cargo test --locked -p null-setup-core --test builtins`
Expected: PASS (the original builtins tests and the six new ones).

- [ ] **Step 5: Commit**

```bash
git add setup/core/src/builtins.rs setup/core/tests/builtins.rs
git commit -m "feat(setup): parse and validate the settings and marketplace tables"
```

---

### Task 3: `first_run` module — validate against the manifest, write atomically

**Files:**
- Create: `setup/core/src/first_run.rs`
- Modify: `setup/core/src/lib.rs`
- Test: `setup/core/tests/first_run.rs`

**Interfaces:**
- Consumes: `builtins::{Manifest, SettingDef::accepts, load}` from Task 2.
- Produces (in `null_setup_core::first_run`): `pub const FILE: &str = "first-run.json"`; `pub const SCHEMA: u32 = 1`; `pub struct FirstRun { pub schema: u32, pub settings: BTreeMap<String, Value>, pub extensions: Vec<String> }` (serde camelCase-neutral: field names are already lowercase); `from_json(&str) -> Result<FirstRun>`; `validate(&Manifest, &FirstRun) -> Result<()>`; `dir() -> Result<PathBuf>` (`%APPDATA%\Null\null-setup`); `write(&Path, &FirstRun) -> Result<()>`; `save_from_file(install: &Path, file: &Path, dir: &Path) -> Result<()>` — Task 4 calls the last two.

- [ ] **Step 1: Write the failing tests**

Create `setup/core/tests/first_run.rs`:

```rust
use std::{fs, path::Path};

use null_setup_core::{
    builtins,
    first_run::{self, FirstRun},
};

const MANIFEST: &str = r#"{"schema":1,"builtins":[],"settings":[
  {"key":"files.autoSave","label":"Auto save","kind":"choice","default":"off",
   "options":[{"value":"off","label":"Off"},{"value":"afterDelay","label":"Delay"}]},
  {"key":"editor.fontSize","label":"Size","kind":"number","default":13,"min":8,"max":40}],
 "marketplace":[{"id":"ms-python.python","label":"Python"}]}"#;

fn manifest() -> builtins::Manifest { builtins::parse(MANIFEST).unwrap() }

fn parse(text: &str) -> FirstRun { first_run::from_json(text).unwrap() }

/// An install folder (with the builtins.json the package ships), a choices file and the folder first-run.json goes to.
fn world(choices: &str) -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let install = tmp.path().join("Null IDE");
    fs::create_dir_all(&install).unwrap();
    fs::write(install.join("builtins.json"), MANIFEST).unwrap();
    let file = tmp.path().join("choices.json");
    fs::write(&file, choices).unwrap();
    let dir = tmp.path().join("appdata").join("Null").join("null-setup");
    (tmp, install, file, dir)
}

#[test]
fn from_json_accepts_a_bom_and_unknown_fields_but_not_another_schema() {
    let f = parse("\u{feff}{\"schema\":1,\"settings\":{\"files.autoSave\":\"off\"},\"extras\":true}");
    assert_eq!(f.settings.len(), 1);
    assert!(first_run::from_json("{\"schema\":2}").is_err());
    assert!(first_run::from_json("{\"settings\":{}}").is_err()); // no schema
    assert!(first_run::from_json("{nope").is_err());
}

#[test]
fn validate_accepts_good_choices() {
    let f = parse(r#"{"schema":1,"settings":{"files.autoSave":"afterDelay","editor.fontSize":15},"extensions":["ms-python.python"]}"#);
    first_run::validate(&manifest(), &f).unwrap();
}

#[test]
fn validate_rejects_what_the_manifest_does_not_offer() {
    let m = manifest();
    let bad = |text: &str| first_run::validate(&m, &parse(text)).unwrap_err().to_string();
    assert!(bad(r#"{"schema":1,"settings":{"terminal.integrated.shell.windows":"x"}}"#).contains("terminal.integrated.shell.windows"));
    assert!(bad(r#"{"schema":1,"settings":{"files.autoSave":"sometimes"}}"#).contains("files.autoSave"));
    assert!(bad(r#"{"schema":1,"settings":{"editor.fontSize":99}}"#).contains("editor.fontSize"));
    assert!(bad(r#"{"schema":1,"settings":{"editor.fontSize":"13"}}"#).contains("editor.fontSize"));
    assert!(bad(r#"{"schema":1,"extensions":["evil.extension"]}"#).contains("evil.extension"));
}

#[test]
fn write_creates_the_folder_and_replaces_an_older_file() {
    let (_t, _i, _f, dir) = world("{}");
    first_run::write(&dir, &parse(r#"{"schema":1,"settings":{"files.autoSave":"off"}}"#)).unwrap();
    first_run::write(&dir, &parse(r#"{"schema":1,"settings":{"files.autoSave":"afterDelay"}}"#)).unwrap();
    let back = parse(&fs::read_to_string(dir.join(first_run::FILE)).unwrap());
    assert_eq!(back.settings["files.autoSave"], "afterDelay");
    assert!(!dir.join("first-run.json.tmp").exists());
}

#[test]
fn save_from_file_validates_against_the_installed_manifest_and_writes() {
    let (_t, install, file, dir) = world(r#"{"schema":1,"settings":{"files.autoSave":"afterDelay"},"extensions":["ms-python.python"]}"#);
    first_run::save_from_file(&install, &file, &dir).unwrap();
    let back = parse(&fs::read_to_string(dir.join(first_run::FILE)).unwrap());
    assert_eq!((back.settings.len(), back.extensions.as_slice()), (1, &["ms-python.python".to_string()][..]));
}

#[test]
fn save_from_file_writes_nothing_for_an_invalid_or_empty_choice_set() {
    let (_t, install, file, dir) = world(r#"{"schema":1,"settings":{"files.autoSave":"sometimes"}}"#);
    assert!(first_run::save_from_file(&install, &file, &dir).is_err());
    assert!(!dir.exists());
    fs::write(&file, r#"{"schema":1,"settings":{},"extensions":[]}"#).unwrap();
    first_run::save_from_file(&install, &file, &dir).unwrap();
    assert!(!dir.join(first_run::FILE).exists());
}

#[test]
fn save_from_file_needs_a_manifest_in_the_install_and_a_readable_file() {
    let (_t, install, file, dir) = world(r#"{"schema":1,"settings":{"files.autoSave":"off"}}"#);
    fs::remove_file(install.join("builtins.json")).unwrap();
    assert!(first_run::save_from_file(&install, &file, &dir).is_err());
    assert!(first_run::save_from_file(&install, Path::new("Z:\\nope\\choices.json"), &dir).is_err());
    assert!(!dir.exists());
}
```

- [ ] **Step 2: Run to verify it fails**

Run (from `setup/`): `cargo test --locked -p null-setup-core --test first_run`
Expected: FAIL to compile — `first_run` module does not exist.

- [ ] **Step 3: Implement**

Add `pub mod first_run;` to `setup/core/src/lib.rs` (after `pub mod extract;`). Create `setup/core/src/first_run.rs`:

```rust
//! The hand-over from the installer to the IDE: choices made during install that null-tools applies on its first start.
//! The file lives outside the install (`%APPDATA%\Null\null-setup\first-run.json`) because `%APPDATA%\Null\User` is the user's.

use std::{collections::BTreeMap, fs, path::{Path, PathBuf}};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    builtins::{self, Manifest},
    error::{Error, IoCtx, Result},
};

pub const FILE: &str = "first-run.json";
pub const SCHEMA: u32 = 1;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct FirstRun {
    pub schema: u32,
    pub settings: BTreeMap<String, Value>,
    pub extensions: Vec<String>,
}

impl Default for FirstRun {
    fn default() -> Self { FirstRun { schema: SCHEMA, settings: BTreeMap::new(), extensions: Vec::new() } }
}

impl FirstRun {
    fn is_empty(&self) -> bool { self.settings.is_empty() && self.extensions.is_empty() }
}

pub fn from_json(text: &str) -> Result<FirstRun> {
    // A missing "schema" must not read as the current one, so it is checked on the raw value first.
    let raw: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))?;
    if raw["schema"].as_u64() != Some(SCHEMA as u64) {
        return Err(Error::Other(format!("{FILE}: expected schema {SCHEMA}")));
    }
    serde_json::from_value(raw).map_err(|e| Error::Other(format!("invalid {FILE}: {e}")))
}

/// Every key and value must be one the manifest of the version being installed offers.
pub fn validate(m: &Manifest, f: &FirstRun) -> Result<()> {
    for (key, value) in &f.settings {
        let def = m
            .settings
            .iter()
            .find(|s| &s.key == key)
            .ok_or_else(|| Error::Other(format!("{FILE}: {key} is not a setting this version offers")))?;
        if !def.accepts(value) {
            return Err(Error::Other(format!("{FILE}: {value} is not a valid value for {key}")));
        }
    }
    for id in &f.extensions {
        if !m.marketplace.iter().any(|e| &e.id == id) {
            return Err(Error::Other(format!("{FILE}: {id} is not in this version's extension list")));
        }
    }
    Ok(())
}

/// `%APPDATA%\Null\null-setup`
pub fn dir() -> Result<PathBuf> {
    let appdata = std::env::var_os("APPDATA").filter(|v| !v.is_empty()).ok_or_else(|| Error::Other("APPDATA is not set".into()))?;
    Ok(PathBuf::from(appdata).join("Null").join("null-setup"))
}

/// Temp file then rename, so the IDE never reads half a file; replaces an unconsumed older one.
pub fn write(dir: &Path, f: &FirstRun) -> Result<()> {
    fs::create_dir_all(dir).ctx("create the first-run folder")?;
    let text = serde_json::to_string_pretty(f).map_err(|e| Error::Other(e.to_string()))?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    fs::write(&tmp, text).ctx("write first-run.json")?;
    fs::rename(&tmp, dir.join(FILE)).ctx("replace first-run.json")
}

/// Reads the choices file the caller gave, checks it against the `builtins.json` of the installed package and, when
/// it holds anything, writes it to `dir`. Nothing is written on any error.
pub fn save_from_file(install: &Path, file: &Path, dir: &Path) -> Result<()> {
    let f = from_json(&fs::read_to_string(file).ctx(format!("read {}", file.display()))?)?;
    let m = builtins::load(install)?
        .ok_or_else(|| Error::Other("this package has no builtins.json, so the first-run choices cannot be checked".into()))?;
    validate(&m, &f)?;
    if f.is_empty() {
        return Ok(());
    }
    write(dir, &f)
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `setup/`): `cargo test --locked -p null-setup-core --test first_run`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add setup/core/src/first_run.rs setup/core/src/lib.rs setup/core/tests/first_run.rs
git commit -m "feat(setup): first-run.json writer validated against the manifest"
```

---

### Task 4: `install --first-run <file>`

**Files:**
- Modify: `setup/app/src/args.rs`
- Modify: `setup/app/src/cli.rs`
- Test: `setup/app/src/args.rs` (its `tests` module)

**Interfaces:**
- Consumes: `first_run::{save_from_file, dir}` from Task 3.
- Produces: `Args.first_run: Option<PathBuf>`; the flag is accepted by `install` only. The wizard (2c-2) will call `install … --first-run <file>`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module at the end of `setup/app/src/args.rs`:

```rust
    #[test]
    fn first_run_is_an_absolute_file_for_install_only() {
        let a = p("install --version v1 --install-dir C:\\x --first-run C:\\f.json").unwrap();
        assert_eq!(a.first_run.as_deref(), Some(std::path::Path::new("C:\\f.json")));
        assert!(p("install --version v1 --install-dir C:\\x").unwrap().first_run.is_none());
        assert!(p("install --version v1 --install-dir C:\\x --first-run f.json").is_err()); // relative: the cwd is changed before the work starts
        assert!(p("repair --install-dir C:\\x --first-run C:\\f.json").is_err());
        assert!(p("update --version v1 --install-dir C:\\x --first-run C:\\f.json").is_err());
        assert!(p("install --version v1 --install-dir C:\\x --first-run").is_err());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run (from `setup/`): `cargo test --locked -p null-setup first_run_is_an_absolute_file`
Expected: FAIL to compile — no field `first_run`.

- [ ] **Step 3: Implement**

In `setup/app/src/args.rs`: add `pub first_run: Option<PathBuf>,` as the last field of `Args`; in `parse` add `let mut first_run = None;` after the `let (mut config, mut force_close, mut delete_data) …` line; add the match arm `"--first-run" => first_run = Some(PathBuf::from(value("--first-run")?)),` after the `--config` arm; add after the `--config must be an absolute path` check:

```rust
    if first_run.as_deref().is_some_and(|f| !f.is_absolute()) {
        return Err("--first-run must be an absolute path".into());
    }
    if first_run.is_some() && mode != Mode::Install {
        return Err("--first-run only applies to install".into());
    }
```

and change the final line to `Ok(Args { mode, repo, tag, install_dir, launch, config, force_close, delete_data, first_run })`.

In `setup/app/src/cli.rs`: add `first_run,` to the `null_setup_core::{ … }` import list and replace the `Mode::Install` arm with:

```rust
        Mode::Install => {
            let cfg = load_config(a)?.unwrap_or_default();
            deploy(a, Kind::Install, a.tag.clone(), Some(cfg), ctx)?;
            // ponytail: a registration warning from deploy() returns before this, so a partly-registered install loses its first-run choices; re-run install after `repair` if that matters.
            if let Some(f) = &a.first_run {
                first_run::save_from_file(&a.install_dir, f, &first_run::dir()?)
                    .map_err(|e| Error::Other(format!("installed, but the first-run choices were not saved: {e}")))?;
            }
            Ok(())
        }
```

- [ ] **Step 4: Run to verify it passes**

Run (from `setup/`): `cargo test --locked -p null-setup-core -p null-setup`
Expected: PASS (everything, including the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add setup/app/src/args.rs setup/app/src/cli.rs
git commit -m "feat(setup): install --first-run hands the installer's choices to the IDE"
```

---

### Task 5: `null.updates.check` — a setting the wizard can preset

The update check is currently unconditional; the spec's "update check on/off" needs something to switch.

**Files:**
- Modify: `extensions/null-tools/package.json` (configuration properties)
- Modify: `extensions/null-tools/src/updaterIntegration.ts`

**Interfaces:**
- Produces: setting `null.updates.check` (boolean, default `true`). Only the startup check honors it; `Null: Check for Updates` always works. Task 6's allowlist and the manifest from Task 1 name this exact key.

- [ ] **Step 1: Add the setting**

In `extensions/null-tools/package.json`, add as the first entry of `contributes.configuration.properties` (before `null.recentProjects.maxItems`):

```json
        "null.updates.check": {
          "type": "boolean",
          "default": true,
          "description": "Check for a new Null IDE release when the IDE starts. The command \"Null: Check for Updates\" always works."
        },
```

- [ ] **Step 2: Gate the startup check**

In `extensions/null-tools/src/updaterIntegration.ts`, replace the startup block

```ts
  refreshUpdateButton();
  checkForUpdate(context, true)
    .then(update => { refreshUpdateButton(); if (update) return promptForUpdate(update); })
    .catch(() => { /* startup check — stay silent when offline */ });
```

with (keep whatever follows the original block unchanged):

```ts
  refreshUpdateButton();
  if (vscode.workspace.getConfiguration('null').get<boolean>('updates.check', true)) {
    checkForUpdate(context, true)
      .then(update => { refreshUpdateButton(); if (update) return promptForUpdate(update); })
      .catch(() => { /* startup check — stay silent when offline */ });
  }
```

- [ ] **Step 3: Compile**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json --noEmit`
Expected: no output (no trivial-branch test: the one-line gate is covered by the manual check in Task 8).

- [ ] **Step 4: Commit**

```bash
git add extensions/null-tools/package.json extensions/null-tools/src/updaterIntegration.ts
git commit -m "feat(null-tools): null.updates.check turns the startup update check off"
```

---

### Task 6: `firstRun.ts` — the pure rules, with the allowlist pinned to the manifest source

**Files:**
- Create: `extensions/null-tools/src/firstRun.ts`
- Create: `extensions/null-tools/src/firstRun.test.ts`
- Modify: `extensions/null-tools/package.json` (`test` script), `extensions/null-tools/tsconfig.json` (`include`)

**Interfaces:**
- Consumes: the key names from Task 1/5 (pinned by a test against `setup/builtins.config.json`).
- Produces (all exported from `firstRun.ts`): `FIRST_RUN_SCHEMA = 1`; `ALLOWED_SETTINGS: Record<string, (v: unknown) => boolean>`; `interface FirstRunHost { read(): string | undefined; remove(): void; hasUserValue(key: string): boolean; setSetting(key: string, value: unknown): Promise<void>; installExtension(id: string): Promise<void>; log(message: string): void }`; `interface FirstRunResult { applied: string[]; kept: string[]; failedSettings: string[]; failedExtensions: string[] }`; `parseFirstRun(text): { settings: Record<string, unknown>; extensions: string[] } | undefined`; `runFirstRun(host, timeoutMs): Promise<FirstRunResult | undefined>`; `installAll(host, ids, timeoutMs): Promise<string[]>` (returns the failed ids). Task 7 consumes these.

- [ ] **Step 1: Write the failing tests**

Create `extensions/null-tools/src/firstRun.test.ts`:

```ts
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import test from 'node:test';
import { ALLOWED_SETTINGS, FirstRunHost, installAll, parseFirstRun, runFirstRun } from './firstRun';

class FakeHost implements FirstRunHost {
  removed = 0;
  set: [string, unknown][] = [];
  installs: string[] = [];
  logs: string[] = [];
  constructor(
    private text: string | undefined,
    private userValues: string[] = [],
    private opts: { failSet?: string; failInstall?: string[]; hangInstall?: string[] } = {},
  ) {}
  read() { return this.text; }
  remove() { this.removed++; }
  hasUserValue(key: string) { return this.userValues.includes(key); }
  async setSetting(key: string, value: unknown) {
    if (key === this.opts.failSet) { throw new Error('settings.json is invalid'); }
    this.set.push([key, value]);
  }
  async installExtension(id: string) {
    this.installs.push(id);
    if (this.opts.hangInstall?.includes(id)) { return new Promise<void>(() => { /* never settles */ }); }
    if (this.opts.failInstall?.includes(id)) { throw new Error('offline'); }
  }
  log(message: string) { this.logs.push(message); }
}

const file = (o: object) => JSON.stringify({ schema: 1, ...o });

// ── the allowlist is the same list as setup/builtins.config.json ───────────

interface SettingDef { key: string; kind: string; default: unknown; options?: { value: string }[]; min?: number; max?: number }

test('the allowlist matches the settings table the installer validates against', () => {
  // out/ -> null-tools -> extensions -> repo root
  const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'setup', 'builtins.config.json'), 'utf8'));
  const defs: SettingDef[] = config.settings;
  assert.deepStrictEqual(Object.keys(ALLOWED_SETTINGS).sort(), defs.map(d => d.key).sort());
  for (const d of defs) {
    const rule = ALLOWED_SETTINGS[d.key];
    assert.ok(rule(d.default), `${d.key}: default`);
    for (const o of d.options ?? []) { assert.ok(rule(o.value), `${d.key}=${o.value}`); }
    if (d.kind === 'choice') { assert.ok(!rule('definitely-not-an-option'), d.key); }
    if (d.kind === 'bool') { assert.ok(rule(true) && rule(false) && !rule('true') && !rule(1), d.key); }
    if (d.kind === 'number') {
      assert.ok(rule(d.min) && rule(d.max), `${d.key}: bounds`);
      assert.ok(!rule(d.min! - 1) && !rule(d.max! + 1) && !rule(String(d.min)), `${d.key}: outside`);
    }
    if (d.kind === 'text') { assert.ok(!rule('') && !rule('a\nb') && !rule('x'.repeat(201)), d.key); }
  }
});

// ── parseFirstRun ──────────────────────────────────────────────────────────

test('parseFirstRun reads the schema, tolerates a BOM and drops invalid extension ids', () => {
  const parsed = parseFirstRun('\uFEFF' + file({ settings: { 'files.autoSave': 'afterDelay' }, extensions: ['ms-python.python', '../x', 'a', 7] }));
  assert.deepStrictEqual(parsed, { settings: { 'files.autoSave': 'afterDelay' }, extensions: ['ms-python.python'] });
  assert.deepStrictEqual(parseFirstRun(file({})), { settings: {}, extensions: [] });
});

test('parseFirstRun returns undefined for anything that is not a schema-1 object', () => {
  for (const bad of ['', '{nope', 'null', '[]', '"x"', '{"schema":2}', '{"settings":{}}']) {
    assert.strictEqual(parseFirstRun(bad), undefined, JSON.stringify(bad));
  }
});

// ── runFirstRun ────────────────────────────────────────────────────────────

test('applies allowlisted settings the user has no value for, then deletes the file', async () => {
  const host = new FakeHost(file({ settings: { 'files.autoSave': 'afterDelay', 'editor.fontSize': 15 } }));
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(host.set, [['files.autoSave', 'afterDelay'], ['editor.fontSize', 15]]);
  assert.deepStrictEqual(result?.applied, ['files.autoSave', 'editor.fontSize']);
  assert.strictEqual(host.removed, 1);
});

test('never overwrites a value the user already set, even a falsy one', async () => {
  const host = new FakeHost(file({ settings: { 'editor.formatOnSave': true, 'editor.fontSize': 15 } }), ['editor.formatOnSave']);
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(host.set, [['editor.fontSize', 15]]);
  assert.deepStrictEqual(result?.kept, ['editor.formatOnSave']);
});

test('ignores keys outside the allowlist, prototype keys and invalid values', async () => {
  const raw = '{"schema":1,"settings":{"__proto__":{"x":1},"constructor":"y","toString":"z",'
    + '"terminal.integrated.shell.windows":"C:\\\\evil.exe","editor.fontSize":"huge","files.autoSave":"afterDelay"}}';
  const host = new FakeHost(raw);
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(host.set, [['files.autoSave', 'afterDelay']]);
  assert.deepStrictEqual(result?.applied, ['files.autoSave']);
  assert.strictEqual(host.removed, 1);
});

test('an unusable file is discarded once without throwing or touching anything', async () => {
  for (const bad of ['', '{nope', '{"schema":2,"settings":{"files.autoSave":"off"}}', '[]']) {
    const host = new FakeHost(bad);
    assert.strictEqual(await runFirstRun(host, 50), undefined);
    assert.strictEqual(host.removed, 1, JSON.stringify(bad));
    assert.deepStrictEqual([host.set, host.installs], [[], []]);
  }
});

test('no file means nothing happens', async () => {
  const host = new FakeHost(undefined);
  assert.strictEqual(await runFirstRun(host, 50), undefined);
  assert.deepStrictEqual([host.removed, host.set, host.installs], [0, [], []]);
});

test('a failed settings write keeps the file for the next launch and does not stop the others', async () => {
  const host = new FakeHost(file({ settings: { 'files.autoSave': 'afterDelay', 'editor.fontSize': 15 } }), [], { failSet: 'files.autoSave' });
  const result = await runFirstRun(host, 50);
  assert.deepStrictEqual(result?.failedSettings, ['files.autoSave']);
  assert.deepStrictEqual(host.set, [['editor.fontSize', 15]]);
  assert.strictEqual(host.removed, 0);
});

test('extensions install one at a time in order; a failure or a hang does not stop the rest or keep the file', async () => {
  const host = new FakeHost(
    file({ extensions: ['a.one', 'b.two', 'c.three', 'd.four'] }), [],
    { failInstall: ['b.two'], hangInstall: ['c.three'] },
  );
  const result = await runFirstRun(host, 20);
  assert.deepStrictEqual(host.installs, ['a.one', 'b.two', 'c.three', 'd.four']);
  assert.deepStrictEqual(result?.failedExtensions, ['b.two', 'c.three']);
  assert.strictEqual(host.removed, 1);
  assert.ok(host.logs.some(l => /c\.three.*timed out/.test(l)));
});

test('installAll returns exactly the ids that failed (the Retry path)', async () => {
  const host = new FakeHost(undefined, [], { failInstall: ['x.y'] });
  assert.deepStrictEqual(await installAll(host, ['p.q', 'x.y'], 20), ['x.y']);
  assert.deepStrictEqual(await installAll(host, [], 20), []);
});
```

Add `out/firstRun.test.js` to the end of the `node --test …` list in the `test` script of `extensions/null-tools/package.json`, and `"src/firstRun.test.ts"` to the `include` array of `extensions/null-tools/tsconfig.json` (e.g. after `"src/updateStatus.test.ts"`).

- [ ] **Step 2: Run to verify it fails**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json`
Expected: FAIL — `Cannot find module './firstRun'`.

- [ ] **Step 3: Implement**

Create `extensions/null-tools/src/firstRun.ts`:

```ts
'use strict';

// Applies the choices null-setup left in %APPDATA%\Null\null-setup\first-run.json. No `vscode` import: the host does the I/O.
// The file sits in a user folder, so it is validated again here; the list below must equal setup/builtins.config.json's
// "settings" (a test pins them together).

export const FIRST_RUN_SCHEMA = 1;

type Rule = (v: unknown) => boolean;

const oneOf = (...values: string[]): Rule => v => typeof v === 'string' && values.includes(v);
const bool: Rule = v => typeof v === 'boolean';
const between = (min: number, max: number): Rule => v => typeof v === 'number' && v >= min && v <= max;
const text: Rule = v => typeof v === 'string' && v.length > 0 && v.length <= 200 && !/[\u0000-\u001f\u007f]/.test(v);

export const ALLOWED_SETTINGS: Record<string, Rule> = {
  'workbench.colorTheme': oneOf('Null Dark', 'Null OLED', 'Null Light', 'Null Retro'),
  'editor.fontFamily': text,
  'editor.fontSize': between(8, 40),
  'files.autoSave': oneOf('off', 'afterDelay', 'onFocusChange', 'onWindowChange'),
  'editor.formatOnSave': bool,
  'window.menuBarVisibility': oneOf('classic', 'compact'),
  'null.updates.check': bool,
};

export interface FirstRunHost {
  /** The file's text, or undefined when there is none. */
  read(): string | undefined;
  /** Must not throw when the file is already gone (a second window may have taken it). */
  remove(): void;
  /** True when the user has a global value for the key, whatever it is. */
  hasUserValue(key: string): boolean;
  setSetting(key: string, value: unknown): Promise<void>;
  installExtension(id: string): Promise<void>;
  log(message: string): void;
}

export interface FirstRunResult {
  applied: string[];
  kept: string[];
  failedSettings: string[];
  failedExtensions: string[];
}

const EXTENSION_ID = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function parseFirstRun(text: string): { settings: Record<string, unknown>; extensions: string[] } | undefined {
  let raw: any;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return undefined; }
  if (!raw || typeof raw !== 'object' || raw.schema !== FIRST_RUN_SCHEMA) { return undefined; }
  const settings = raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings) ? raw.settings : {};
  const extensions = Array.isArray(raw.extensions)
    ? raw.extensions.filter((id: unknown): id is string => typeof id === 'string' && EXTENSION_ID.test(id))
    : [];
  return { settings, extensions };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** One at a time, each with its own timeout. Returns the ids that did not install. */
export async function installAll(host: FirstRunHost, ids: string[], timeoutMs: number): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await withTimeout(host.installExtension(id), timeoutMs);
      host.log(`installed ${id}`);
    } catch (err) {
      host.log(`could not install ${id}: ${message(err)}`);
      failed.push(id);
    }
  }
  return failed;
}

export async function runFirstRun(host: FirstRunHost, timeoutMs: number): Promise<FirstRunResult | undefined> {
  const text = host.read();
  if (text === undefined) { return undefined; }
  const file = parseFirstRun(text);
  if (!file) {
    host.log('first-run.json is unusable; discarded');
    host.remove();
    return undefined;
  }

  const result: FirstRunResult = { applied: [], kept: [], failedSettings: [], failedExtensions: [] };
  for (const [key, value] of Object.entries(file.settings)) {
    // hasOwn: a plain lookup would find `constructor` and `toString` on the object.
    if (!Object.hasOwn(ALLOWED_SETTINGS, key) || !ALLOWED_SETTINGS[key](value)) {
      host.log(`ignored ${key}`);
      continue;
    }
    if (host.hasUserValue(key)) { result.kept.push(key); continue; }
    try {
      await host.setSetting(key, value);
      result.applied.push(key);
    } catch (err) {
      host.log(`could not set ${key}: ${message(err)}`);
      result.failedSettings.push(key);
    }
  }
  result.failedExtensions = await installAll(host, file.extensions, timeoutMs);

  // A failed settings write is worth another launch (setting is idempotent); a failed extension install is reported
  // once with Retry instead. ponytail: an extension the user ignores the notification for is not retried next launch.
  if (result.failedSettings.length === 0) { host.remove(); }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run (in `extensions/null-tools`): `npx tsc -p tsconfig.json && node --test out/firstRun.test.js`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add extensions/null-tools/src/firstRun.ts extensions/null-tools/src/firstRun.test.ts extensions/null-tools/package.json extensions/null-tools/tsconfig.json
git commit -m "feat(null-tools): first-run rules with the allowlist pinned to the installer's table"
```

---

### Task 7: `firstRunIntegration.ts` — the `vscode` glue, wired at activation

**Files:**
- Create: `extensions/null-tools/src/firstRunIntegration.ts`
- Modify: `extensions/null-tools/src/extension.ts`
- Refresh: `extensions/null-tools/out/`

**Interfaces:**
- Consumes: `FirstRunHost`, `runFirstRun`, `installAll` from Task 6.
- Produces: `registerFirstRunFeature(context: vscode.ExtensionContext): void`, called once from `activate`.

- [ ] **Step 1: Write the glue**

Create `extensions/null-tools/src/firstRunIntegration.ts`:

```ts
'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FirstRunHost, installAll, runFirstRun } from './firstRun';

const INSTALL_TIMEOUT_MS = 120_000;

export function registerFirstRunFeature(context: vscode.ExtensionContext): void {
  const appData = process.env.APPDATA;
  if (!appData) { return; }
  const file = path.join(appData, 'Null', 'null-setup', 'first-run.json');
  const output = vscode.window.createOutputChannel('Null Setup');
  context.subscriptions.push(output);

  const host: FirstRunHost = {
    read() {
      try { return fs.readFileSync(file, 'utf8'); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') { output.appendLine(`cannot read ${file}: ${(err as Error).message}`); }
        return undefined;
      }
    },
    remove() {
      try { fs.rmSync(file, { force: true }); } // force: another window may have deleted it already
      catch (err) { output.appendLine(`cannot delete ${file}: ${(err as Error).message}`); }
    },
    // globalValue, not get(): a default from product.json / null-theme is not the user's choice, and false/0/"" are values.
    hasUserValue: key => vscode.workspace.getConfiguration().inspect(key)?.globalValue !== undefined,
    setSetting: async (key, value) => { await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global); },
    installExtension: async id => { await vscode.commands.executeCommand('workbench.extensions.installExtension', id); },
    log: m => output.appendLine(m),
  };

  const notifyFailed = (ids: string[]): void => {
    if (ids.length === 0) { return; }
    const n = ids.length;
    void vscode.window
      .showWarningMessage(`${n} extension${n === 1 ? '' : 's'} chosen during setup could not be installed.`, 'Retry')
      .then(async choice => { if (choice === 'Retry') { notifyFailed(await installAll(host, ids, INSTALL_TIMEOUT_MS)); } });
  };

  runFirstRun(host, INSTALL_TIMEOUT_MS)
    .then(result => notifyFailed(result?.failedExtensions ?? []))
    .catch(err => output.appendLine(`first run failed: ${(err as Error).message}`));
}
```

- [ ] **Step 2: Wire it into activation**

In `extensions/null-tools/src/extension.ts` add `import { registerFirstRunFeature } from './firstRunIntegration';` after the `registerRecoveryFeature` import, and call `registerFirstRunFeature(context);` directly after `registerUpdaterFeature(context);` in `activate`.

- [ ] **Step 3: Compile, run the whole null-tools unit suite**

Run (in `extensions/null-tools`): `npm run compile && npm test`
Expected: both succeed; `npm test` prints no failures (the existing tests plus `firstRun.test.js`).

- [ ] **Step 4: Commit source and refreshed output separately**

```bash
git add extensions/null-tools/src/firstRunIntegration.ts extensions/null-tools/src/extension.ts
git commit -m "feat(null-tools): apply the installer's first-run choices on first start"
git add extensions/null-tools/out
git commit -m "chore: refresh null-tools compiled output"
```

---

### Task 8: Document the split, update CLAUDE.md, and check it in a real IDE

**Files:**
- Modify: `docs/specs/null-setup-installer-design.md` (the "Sequencing" slice list)
- Modify: `CLAUDE.md`
- Create: `docs/specs/null-setup-first-run-check.md` (result record)

**Interfaces:**
- Consumes: everything above.
- Produces: a recorded **PASS/FAIL** for the end-to-end behavior. FAIL stops the plan; report to the user.

- [ ] **Step 1: Update the spec's slice list**

In `docs/specs/null-setup-installer-design.md`, under "Sequencing → Sub-project 2", replace the `**2c wizard and first run**` bullet with:

```markdown
- **2c wizard and first run**, split in three plans:
  - **2c-1 first-run data path** (`docs/plans/null-setup-first-run.md`): the `settings` / `marketplace` tables in `builtins.json`, `install --first-run`, the `first-run.json` writer in `core` and its null-tools consumer, `null.updates.check`.
  - **2c-2 wizard and stub installer**: the wizard UI (default mode with no install found, `modify` pre-filled, uninstall page), the Add/Remove Programs entry, publishing `NullIDESetup-<version>.exe` as the stub.
  - **2c-3 `Null: Setup` and retirement**: the in-IDE page that shows and edits the saved choices, then deleting Inno Setup, `scripts/install-null-ide.ps1`, `scripts/update-null-ide.ps1`, `updater/` and updating the README and `build-local.ps1`; the Windows 10 22H2 matrix.
```

- [ ] **Step 2: Update CLAUDE.md**

In the `### \`setup/\` (null-setup)` section append one paragraph:

```markdown
First-run hand-over (sub-project 2c-1): `builtins.json` also carries a `settings` table (the seven keys the wizard may preset: `workbench.colorTheme`, `editor.fontFamily`, `editor.fontSize`, `files.autoSave`, `editor.formatOnSave`, `window.menuBarVisibility`, `null.updates.check`) and a `marketplace` table (empty); both come from `setup/builtins.config.json`. `install --first-run <abs file>` (install only) checks the choices against the installed package's `builtins.json` (`first_run::validate`) and writes `%APPDATA%\Null\null-setup\first-run.json`; nothing is written for an invalid or empty set. null-tools consumes it once (see its table). Plan `docs/plans/null-setup-first-run.md`; check `docs/specs/null-setup-first-run-check.md`.
```

In the `null-tools` features table add a row after "Crash recovery":

```markdown
| **First-run choices** | `firstRun.ts` (pure, host injected) + `firstRunIntegration.ts` (the only `vscode` file): on activation reads `%APPDATA%\Null\null-setup\first-run.json` once. Only the seven allowlisted settings (`ALLOWED_SETTINGS`, pinned by a test to `setup/builtins.config.json`), only when the user has no global value (`inspect().globalValue === undefined`, so a user's `false` stays); extensions install one at a time with a 120 s timeout, failures give one notification with Retry. The file is deleted after processing; a failed settings write keeps it for the next launch, an unusable one is discarded. `null.updates.check` (default on) gates only the startup update check |
```

- [ ] **Step 3: Check it in a real IDE (isolated profile)**

Run in PowerShell. `$env:APPDATA` is overridden for this shell only, so the IDE started from it uses a throwaway profile, as in the other runbooks.

```powershell
$env:APPDATA = "$env:TEMP\ApData-firstrun"; Remove-Item $env:APPDATA -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory "$env:APPDATA\Null\null-setup" -Force | Out-Null
'{"schema":1,"settings":{"files.autoSave":"afterDelay","editor.fontSize":17,"editor.formatOnSave":true,"null.updates.check":false,"terminal.integrated.shell.windows":"C:\\evil.exe","constructor":"x"},"extensions":["not-a.real-extension-zzz"]}' |
  Set-Content "$env:APPDATA\Null\null-setup\first-run.json" -Encoding utf8
# push the new null-tools into a scratch copy of the install (never the daily one) and start it
& "D:\Coding\Apps\null-ide\scripts\sync-local.ps1" -InstallDir "$env:LOCALAPPDATA\NullTest\Null IDE.pristine"
& "$env:LOCALAPPDATA\NullTest\Null IDE.pristine\null.exe"
```

If `Null IDE.pristine` does not exist, copy the daily `Null IDE` folder to that path first and add an empty `data\` folder inside it (see `docs/specs/null-setup-installer-engine-test-runbook.md`). `utf8` in Windows PowerShell 5.1 writes a BOM — that is intended, it is one of the cases under test.

Record in `docs/specs/null-setup-first-run-check.md` (Windows and Null IDE version, then a PASS/FAIL line for each, with the observed text on a FAIL):

1. Open the Settings JSON of this scratch profile (`%APPDATA%\Null\User\settings.json`): it contains `files.autoSave`, `editor.fontSize` 17, `editor.formatOnSave` true, `null.updates.check` false, and **not** `terminal.integrated.shell.windows` or `constructor`.
2. A warning notification says "1 extension chosen during setup could not be installed." with a **Retry** button; Retry shows the same warning again (the id is fake). Output → "Null Setup" lists `ignored terminal.integrated.shell.windows`, `ignored constructor` and the install failure.
3. `%APPDATA%\Null\null-setup\first-run.json` no longer exists.
4. Close the IDE, recreate the file with `{"schema":1,"settings":{"editor.fontSize":30}}`, set `"editor.fontSize": 12` yourself in the scratch `settings.json`, start the IDE: the value stays 12 and the file is gone (the user's value wins).
5. Close the IDE, set `"editor.formatOnSave": false` in `settings.json`, recreate a file with `formatOnSave: true`, start: the value stays `false` (falsy user value wins).
6. With `null.updates.check` false, the Output channel of the updater (`Null`) shows no "Checking for updates" line at startup; running **Null: Check for Updates** does check.

Then reset: `Remove-Item "$env:TEMP\ApData-firstrun" -Recurse -Force` and open a new shell (the `$env:APPDATA` override is per shell).

- [ ] **Step 4: Run every suite once more**

Run: `cd setup && cargo test --locked -p null-setup-core -p null-setup` ; `node --test scripts/gen-builtins.test.mjs` ; `cd extensions/null-tools && npm test`
Expected: all green. Paste the three summary lines into the record file.

- [ ] **Step 5: Refresh the graph and commit**

Run: `graphify update .`

```bash
git add docs/specs/null-setup-installer-design.md docs/specs/null-setup-first-run-check.md CLAUDE.md
git commit -m "docs: record the first-run check and split slice 2c in three"
```

---

## Self-Review (done while writing)

- **Spec coverage:** `first-run.json` file and owner (Tasks 3, 4), allowlisted set-if-unset settings (6), marketplace extensions one by one with timeout and one Retry notification (6, 7), deleted only after processing / crash retry (6), the six wizard settings as seven keys (1), update-check on/off (5), installer never writes in `User\` (3 writes only `…\null-setup`). Not in this slice by design: the wizard page itself, `Null: Setup`, Add/Remove Programs, Inno retirement — they are 2c-2 and 2c-3 (Task 8 records that).
- **Placeholders:** none; every step has its code or exact command. The two judgment calls are marked `ponytail:` in code (registration-warning path; ignored-notification extensions).
- **Type consistency:** `SettingDef.accepts` / `valid_extension_id` (Task 2) are the names Task 3 calls; `first_run::{save_from_file, dir}` (Task 3) are the names Task 4 calls; `FirstRunHost`, `runFirstRun`, `installAll`, `failedExtensions` (Task 6) are the names Task 7 uses; the seven keys are identical in Task 1's config, Task 5, Task 6's `ALLOWED_SETTINGS` and Task 8's check (the pin test fails if they differ).
- **Review Focus:** all five classes have a named test (items 1–5 → Task 6 tests "ignores keys…", "never overwrites…", "an unusable file…", "extensions install one at a time…", "a failed settings write…" and "no file means nothing happens"; glue-only parts → Task 8 checks 4–5).
