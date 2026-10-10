'use strict';

import { CLIENT_SCRIPT } from './accountsClient';

// Theme variables only: the panel follows whatever colour theme is active, with Signal Blue
// (button.background / focusBorder) as the single accent. Mono is for paths and fingerprints.
const CSS = `
*,*::before,*::after{box-sizing:border-box;}
:root{
  --line:var(--vscode-panel-border,var(--vscode-widget-border,rgba(128,128,128,.25)));
  --muted:var(--vscode-descriptionForeground);
  --raised:var(--vscode-editorWidget-background,var(--vscode-sideBar-background));
  --control:var(--vscode-input-background);
  --mono:var(--vscode-editor-font-family,monospace);
}
body{font-family:var(--vscode-font-family);font-size:12px;line-height:1.5;color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;}
#page{max-width:720px;margin:0 auto;padding:32px 28px 72px;}
h1,h2,h3,p,dl,dd{margin:0;}
.page-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-bottom:4px;}
h1{font-size:20px;font-weight:600;letter-spacing:-.01em;}
.subtitle{color:var(--muted);margin-bottom:24px;max-width:60ch;text-wrap:pretty;}
.muted{color:var(--muted);}
.mono{font-family:var(--mono);}

button{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:0;border-radius:4px;font:inherit;cursor:pointer;white-space:nowrap;
  background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);transition:background-color .1s;}
button:hover{background:var(--vscode-button-secondaryHoverBackground,var(--vscode-button-secondaryBackground));}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
button.primary:hover{background:var(--vscode-button-hoverBackground,var(--vscode-button-background));}
button.ghost{background:transparent;color:var(--vscode-foreground);box-shadow:inset 0 0 0 1px var(--line);}
button.ghost:hover,button.icon:hover{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));}
button.icon{width:26px;padding:0;justify-content:center;background:transparent;color:var(--muted);}
button.icon:hover{color:var(--vscode-foreground);}
button.danger{color:var(--vscode-errorForeground);}
button.danger:hover,button.icon.danger:hover{color:var(--vscode-errorForeground);background:color-mix(in srgb,var(--vscode-errorForeground) 14%,transparent);}
:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px;}
.icon-svg{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;}

#empty{padding:56px 0;text-align:center;}
#empty h2{font-size:14px;font-weight:600;margin-bottom:4px;}
#empty p{color:var(--muted);max-width:44ch;margin:0 auto;text-wrap:balance;}

.account{background:var(--raised);border:1px solid var(--line);border-radius:8px;margin-bottom:16px;}
.account>*{padding:16px 18px;}
.account>*+*{border-top:1px solid var(--line);}
.who-row{display:flex;align-items:center;gap:12px;}
.avatar{width:36px;height:36px;flex:none;border-radius:8px;display:grid;place-items:center;font-size:15px;font-weight:600;background:var(--control);border:1px solid var(--line);text-transform:uppercase;}
.who{flex:1;min-width:0;}
.who h2{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.where{display:flex;flex-wrap:wrap;align-items:center;gap:6px;color:var(--muted);}
.tag{padding:0 6px;border:1px solid var(--line);border-radius:10px;font-size:11px;line-height:16px;color:var(--muted);}
.tag.warn{color:var(--vscode-editorWarning-foreground);border-color:currentColor;}

.notice{display:flex;flex-wrap:wrap;align-items:center;gap:10px;background:color-mix(in srgb,var(--vscode-editorWarning-foreground) 10%,transparent);}
.notice .icon-svg{color:var(--vscode-editorWarning-foreground);width:16px;height:16px;}
.notice p{flex:1;min-width:0;}

.identity{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 24px;}
.field dt{color:var(--muted);margin-bottom:2px;}
.field dd{display:flex;align-items:center;gap:4px;min-height:26px;font-size:13px;}
.field .value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.identity-foot{margin-top:10px;}
.lead{margin-bottom:12px;}
.kv .tag{justify-self:start;}

.block-head{display:flex;align-items:center;gap:6px;margin-bottom:10px;}
.block-head h3{font-size:12px;font-weight:600;}
.block-head .icon-svg{color:var(--muted);}
.count{color:var(--muted);font-weight:400;}
.kv{display:grid;gap:2px;margin-bottom:12px;min-width:0;}
.kv .mono{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.kv .fp{color:var(--muted);}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.actions+.actions{margin-top:6px;}
.spacer{flex:1;}

.switch{background:transparent;color:var(--vscode-foreground);padding:0 8px 0 4px;}
.switch:hover{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));}
.track{position:relative;width:26px;height:14px;border-radius:7px;background:var(--control);border:1px solid var(--vscode-input-border,var(--line));transition:background-color .12s,border-color .12s;}
.track::after{content:"";position:absolute;top:2px;left:2px;width:8px;height:8px;border-radius:50%;background:var(--muted);transition:transform .12s,background-color .12s;}
.switch[aria-checked="true"] .track{background:var(--vscode-button-background);border-color:var(--vscode-button-background);}
.switch[aria-checked="true"] .track::after{transform:translateX(12px);background:var(--vscode-button-foreground);}

.project{display:flex;align-items:center;gap:10px;min-height:30px;margin:0 -8px;padding:0 4px 0 8px;border-radius:4px;}
.project:hover{background:var(--vscode-list-hoverBackground);}
.project>.icon-svg{color:var(--muted);}
.pname{font-weight:600;}
.ppath{flex:1;min-width:0;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.project.missing .pname{color:var(--muted);font-weight:400;}

@media (prefers-reduced-motion:reduce){*{transition:none!important;}}
`;

/** The panel page. Contains no account data — the host posts that after the script announces `ready`. */
export function buildHtml(nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Null Accounts</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
<main id="page">
  <header class="page-head">
    <h1>Accounts</h1>
    <button id="add-btn" class="primary" type="button"></button>
  </header>
  <p class="subtitle">Each project uses one account for GitHub and GitLab features, and commits as that account’s identity.</p>
  <div id="list"></div>
  <div id="empty" hidden>
    <h2>No accounts yet</h2>
    <p>Add a GitHub or GitLab account to give your projects their own sign-in, git identity and SSH key.</p>
  </div>
</main>
<script nonce="${nonce}">${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
