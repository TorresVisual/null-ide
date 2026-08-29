const WINDOWS_DRIVE_RE = /^([a-zA-Z]):[\\/](.*)$/;
const WSL_MOUNT_RE = /^\/mnt\/([a-zA-Z])(\/.*)?$/;

/** Converts a Windows path (e.g. `C:\Users\Foo`) to its WSL equivalent (`/mnt/c/Users/Foo`). */
export function toWslPath(windowsPath: string): string {
  const trimmed = windowsPath.trim();
  const match = WINDOWS_DRIVE_RE.exec(trimmed);
  if (!match) {
    return trimmed.replace(/\\/g, '/');
  }
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/\\/g, '/');
  return rest.length > 0 ? `/mnt/${drive}/${rest}` : `/mnt/${drive}`;
}

/**
 * Converts a WSL path back to Windows. `/mnt/<drive>/...` maps to a real drive path;
 * anything else (e.g. `/home/user/proj`) only exists inside the distro's own filesystem,
 * so it's addressed through the `\\wsl.localhost\<distro>\...` UNC root.
 */
export function fromWslPath(wslPath: string, distro: string): string {
  const trimmed = wslPath.trim();
  const mountMatch = WSL_MOUNT_RE.exec(trimmed);
  if (mountMatch) {
    const drive = mountMatch[1].toUpperCase();
    const rest = (mountMatch[2] ?? '').replace(/\//g, '\\');
    return rest.length > 0 ? `${drive}:${rest}` : `${drive}:\\`;
  }
  const rest = trimmed.replace(/^\/+/, '').replace(/\//g, '\\');
  return `\\\\wsl.localhost\\${distro}\\${rest}`;
}
