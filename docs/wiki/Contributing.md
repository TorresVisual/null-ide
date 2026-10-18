# Contributing

Null IDE is a personal daily-driver editor developed in the open. Bug reports, feature ideas and pull requests are welcome.

## Reporting issues

Open an issue at [github.com/TorresVisual/null-ide/issues/new](https://github.com/TorresVisual/null-ide/issues/new/choose). Two templates exist:

- **Bug report**: what is broken, steps to reproduce, what you expected, your Null IDE version (`Help → About`) and Windows version.
- **Feature request**: what you want and why.

Search existing issues first. For a bug, try `null --safe-mode` and say whether it still happens ([Troubleshooting](Troubleshooting#the-ide-misbehaves-after-an-extension-change)).

## Working on a change

1. Fork and clone the repository, and create a branch.
2. Read [Development](Development) for the layout and the rules that trip people up:
   - edit `src/`, never the compiled `out/`;
   - run `npm run compile` in the extension and commit the refreshed `out/` (as its own `chore: refresh <ext> compiled output` commit);
   - add any new test file to the `test` script in that extension's `package.json`.
3. Test locally. Use `scripts/sync-local.ps1` to push the change into an installed Null IDE, then reload. Do not run the full editor build locally; CI does that.
4. Commit with a clear message in the existing style (Conventional Commits: `feat(scope): ...`, `fix(scope): ...`, `docs: ...`, `chore: ...`).
5. Open a pull request against `main`, describing what changed and how you checked it.

## Scope

- Null IDE is Windows x64 only, and favours a small, opinionated set of features over configurability.
- Changes to VS Code's own source belong in `patches/` and must apply cleanly after VSCodium's patches. Prefer injection (CSS/JS) or an extension where it is enough.
- Anything touching the installer, updater, shell extension or signing steps is security-sensitive; explain the threat model in the PR.

## Documentation

User-facing changes should update this wiki in the same pull request. The wiki source is [`docs/wiki/`](https://github.com/TorresVisual/null-ide/tree/main/docs/wiki) in the main repository. Edit the Markdown files there, not the wiki on github.com; a maintainer publishes them. Keep the README short and link to the wiki for detail.

Style: plain language, short pages, one topic per heading, relative wiki links like `[Features](Features)`.
