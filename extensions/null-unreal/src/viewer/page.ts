import type { Kind } from '../exportFormat';

export type Page = 'texture' | 'material' | 'mesh' | 'properties';

export function pageFor(kind: Kind): Page {
  switch (kind) {
    case 'texture':
      return 'texture';
    case 'material':
      return 'material';
    case 'skeletal-mesh':
      return 'mesh';
    default:
      return 'properties';
  }
}

export interface PageOptions {
  page: Page;
  nonce: string;
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  title: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// No inline script and no inline style: the page runs one nonce'd script from lib/ and styles from the extension.
export function buildHtml(o: PageOptions): string {
  const csp = [
    "default-src 'none'",
    `img-src ${o.cspSource} data: blob:`,
    `connect-src ${o.cspSource}`,
    `style-src ${o.cspSource}`,
    `script-src 'nonce-${o.nonce}'`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(o.title)}</title>
<link rel="stylesheet" href="${esc(o.styleUri)}">
</head>
<body data-page="${o.page}">
<div id="app"></div>
<script nonce="${o.nonce}" src="${esc(o.scriptUri)}"></script>
</body>
</html>`;
}
