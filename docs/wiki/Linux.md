# Linux

Null IDE ships an x64 Linux build next to the Windows one, in two forms: a `.deb` package and a `.tar.gz` archive. Both come from each GitHub release.

- **Baseline:** glibc 2.28 or newer (Debian 10, Ubuntu 20.04 and later). x64 only; arm64 is not built.
- **Runtime libraries:** the `.deb` declares them and `apt` installs them. For the tarball, install GTK 3, NSS, libsecret, libnotify and the X11 libraries from your distribution.

## Install

### Debian or Ubuntu (`.deb`)

```bash
sudo apt install ./null-ide-linux-x64-<tag>.deb
```

This installs the app to `/usr/share/null`, the `null` command to `/usr/bin/null`, a desktop entry and the `null://` URL handler. It does not add any Microsoft or other apt repository.

### Any distribution (`.tar.gz`)

```bash
sha256sum -c null-ide-linux-x64-<tag>.tar.gz.sha256
mkdir null-ide && tar -xzf null-ide-linux-x64-<tag>.tar.gz -C null-ide
./null-ide/null
```

The archive adds no desktop entry and no `null` command on your `PATH`. Run it from its folder, or link it yourself.

## Launch

With the `.deb` installed, open a terminal and run:

```bash
null .                # open the current folder
null path/to/file     # open a specific file
```

## Uninstall

- `.deb`: `sudo apt remove null-ide`, or `sudo apt purge null-ide` to also remove the package's configuration.
- Tarball: delete the folder you extracted.

Either way, your settings and extensions stay in `~/.config/Null`. Delete that folder for a clean slate.

## Updating

Updates are manual. When a newer release exists, the status-bar button opens its release page. Download the new package and install it over the old one. Linux installs do not update themselves.

## Sandbox note

Ubuntu 24.04 and later restrict unprivileged user namespaces, and Electron's sandbox needs them. If the window does not open, install the `.deb` (its package sets up the sandbox helper), or start the tarball with `./null --no-sandbox`.

## Known limitations

- The Ports view and **Open in Null Notes** are Windows-only.
- There is no self-update, and no Windows Explorer or shell integration.
- The first-run choices from the Windows installer do not apply.

## Troubleshooting

See [Troubleshooting](Troubleshooting) for logs and common problems.
