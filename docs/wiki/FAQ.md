# FAQ

## What is Null IDE?

A code editor built on VSCodium (Windows first, with a Linux build), with its own theme, icons, built-in tools and installer. See [Home](Home).

## Is it VS Code?

It is VSCodium (VS Code with Microsoft's branding and telemetry removed) plus Null's patches and extensions. Most VS Code settings, keybindings and extensions work as usual.

## Does Null IDE send any data anywhere?

No telemetry (`enableTelemetry` is `false`). The only network calls are:

- Extension gallery lookups (VS Marketplace), on user action
- The GitHub Releases API for update checks
- GitHub API calls from the Issues, Pull Requests and GitHub Actions views, only after you sign in
- GitHub and GitLab API calls from the account manager, only for accounts you add
- Discord Rich Presence, only if you enable it
- Sync and activity badges, only if you turn those on

## Which platforms are supported?

Windows x64 and Linux x64 (see [Linux](Linux)); Linux has no self-update and no Explorer integration. Remote development to Linux hosts over WSL or SSH is supported through the bundled remote extensions.

## Do I need Claude Code?

No. Commit message generation uses the `claude` CLI if it is installed; turn it off with `null.commitMessage.useClaude` for a basic message built from the diff. Crash recovery and Follow Along work with Claude Code sessions, and are harmless without it.

## Why does Windows warn about the installer?

It is not code-signed. See [Troubleshooting](Troubleshooting#smartscreen-warns-about-the-installer).

## Where are my settings and extensions?

In `%APPDATA%\Null`. Uninstall keeps that folder unless you ask it to delete it.

## Can I use it next to VS Code or VSCodium?

Yes. It has its own binary (`null.exe`), data folder and settings.

## How do I update?

Click the status-bar update button, or run **Null: Check for Updates**. See [Getting Started](Getting-Started#updating).

## Which Marketplace does it use?

The VS Marketplace. See [Extensions](Extensions#installing-more).

## An extension I installed will not update

It was probably installed from a local `.vsix`, which pins it. See [Troubleshooting](Troubleshooting#a-sideloaded-extension-stopped-updating).

## Can I turn off a built-in extension?

Yes: drop it in the installer's extension list, or disable it in the Extensions view. Keep the ones others depend on; see [Extensions](Extensions#built-in-extensions).

## How do I report a bug or ask for a feature?

[Contributing](Contributing#reporting-issues).
