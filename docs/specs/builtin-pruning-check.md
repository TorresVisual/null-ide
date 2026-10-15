# Built-in pruning check (null-setup, sub-project 2a gate)

The installer leaves unchecked built-in extensions off disk. This check proves that a Null IDE with every
non-locked built-in deleted from `resources/app/extensions/` still works, and that a restored one is noticed.

- Windows 11 Pro 10.0.26100
- Null IDE 1.135.06055 (commit `1a46a584725d5dd330e0bcd7f5510f24990efcf2`), portable scratch copy (`data\` inside the install)
- Removed: `null-markdown`, `null-format`, `null-cpp`, `null-actions`, `null-env`, `null-sync`, `null-activity`, `null-music`, `null-startup`, `code-spell-checker`, `open-remote-wsl`, `open-remote-ssh`. Left: `null-tools`, `null-accounts`, `null-theme`, `null-icons`.

| Observation | Result |
|---|---|
| Two consecutive starts (second exercises the scanner cache): no error notification, `@builtin null` lists exactly the four locked ones, Extension Host output clean, Null Dashboard opens, `.md` opens as plain text | PASS |
| `null-music` copied back, IDE restarted: it appears in `@builtin null` again | PASS |

Checked by hand by the maintainer; the scratch copy was prepared by script.

**Verdict: PASS.** Tasks 2-9 of `docs/plans/null-setup-installer-engine.md` run unchanged.
