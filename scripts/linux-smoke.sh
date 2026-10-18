#!/usr/bin/env bash
# Smoke test for the Linux release artifacts (#119); runs in the build-linux CI job.
# Usage: linux-smoke.sh <tarball> <deb> <overlay-dir> <version>
set -euo pipefail

tarball=$(realpath "$1"); deb=$(realpath "$2"); overlay=$(realpath "$3"); version=$4
work=$(mktemp -d)
app_pid=
cleanup() {
  [ -z "$app_pid" ] || kill "$app_pid" 2>/dev/null || true
  pkill -f "$work/app/null" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT
fail() { echo "::error::smoke: $*" >&2; exit 1; }
step() { echo "── $*"; }

# ── tarball ────────────────────────────────────────────────────────────────
step "tarball layout"
app="$work/app"; mkdir "$app"; tar -xzf "$tarball" -C "$app"
[ -x "$app/null" ] || fail "no executable 'null' at the tarball root"
[ -x "$app/bin/null" ] || fail "no bin/null launcher"
node -e '
  const [dir, version] = process.argv.slice(1);
  const p = require(dir + "/resources/app/product.json");
  const m = require(dir + "/.null-ide-install.json");
  if (p.applicationName !== "null") throw new Error("applicationName=" + p.applicationName);
  if (m.version !== version) throw new Error("install metadata version=" + m.version + ", expected " + version);
' "$app" "$version" || fail "product.json or .null-ide-install.json is wrong"

step "built-in extensions"
missing=()
for d in "$overlay"/extensions/null-*/; do
  name=$(basename "$d")
  [ -f "$app/resources/app/extensions/$name/package.json" ] || missing+=("$name")
done
for name in code-spell-checker open-remote-wsl open-remote-ssh; do
  [ -f "$app/resources/app/extensions/$name/package.json" ] || missing+=("$name")
done
[ "${#missing[@]}" -eq 0 ] || fail "missing built-in extensions: ${missing[*]}"

step "CLI"
"$app/bin/null" --version || fail "null --version failed"

step "launch under xvfb"
mkdir "$work/ud" "$work/ext" "$work/project"
xvfb-run -a "$app/null" --no-sandbox --disable-gpu --user-data-dir "$work/ud" --extensions-dir "$work/ext" "$work/project" &
app_pid=$!
for _ in $(seq 60); do
  [ -d "$work/ud/logs" ] && break
  kill -0 "$app_pid" 2>/dev/null || break
  sleep 1
done
if [ ! -d "$work/ud/logs" ]; then
  find "$work/ud" -maxdepth 3 >&2 || true
  fail "the app wrote no logs within 60 seconds (user-data-dir contents above)"
fi
sleep 25 # let extensions activate
kill -0 "$app_pid" 2>/dev/null || fail "the app exited during startup"
if grep -rE "Activating extension '[^']+' failed" "$work/ud/logs"; then fail "an extension failed to activate (lines above)"; fi
kill "$app_pid" 2>/dev/null || true; app_pid=
pkill -f "$app/null" 2>/dev/null || true

# ── deb ────────────────────────────────────────────────────────────────────
step "deb metadata"
ctl="$work/ctl"; mkdir "$ctl"; dpkg-deb -e "$deb" "$ctl"
# capture first: `cmd | grep -q` can SIGPIPE the writer and trip pipefail
info=$(dpkg-deb -I "$deb")
grep -q "^ Package: null-ide$" <<<"$info" || fail "the deb's package name is not null-ide"
if grep -rEi "packages\.microsoft\.com|microsoft\.gpg|add-microsoft-repo" "$ctl"; then fail "the deb still registers Microsoft's apt repository"; fi
if grep -qi "^Maintainer:.*microsoft" "$ctl/control"; then fail "the deb's maintainer is Microsoft"; fi

step "install / remove / purge"
sudo apt-get install -y "$deb"
[ -x /usr/bin/null ] || fail "/usr/bin/null missing after install"
[ -f /usr/share/applications/null.desktop ] || fail "desktop entry missing"
files=$(dpkg -L null-ide)
grep -q "pixmaps/null.png" <<<"$files" || fail "icon missing"
/usr/bin/null --version >/dev/null || fail "the installed null --version failed"
if [ -e /usr/share/keyrings/microsoft.gpg ] || [ -e /etc/apt/sources.list.d/vscode.sources ]; then fail "Microsoft's apt repository was registered"; fi
sudo apt-get remove -y null-ide
[ ! -e /usr/bin/null ] || fail "/usr/bin/null remains after remove"
sudo apt-get purge -y null-ide

echo "smoke: all checks passed"
