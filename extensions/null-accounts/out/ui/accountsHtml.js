'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHtml = buildHtml;
const accountsClient_1 = require("./accountsClient");
const CSS = `
*,*::before,*::after{box-sizing:border-box;}
body{font-family:var(--vscode-font-family);font-size:12px;line-height:1.5;color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;}
#page{max-width:680px;margin:0 auto;padding:28px 26px 60px;}
h1{font-size:19px;font-weight:600;margin:0 0 4px;}
.subtitle{margin:0 0 18px;color:var(--vscode-descriptionForeground);}
#toolbar{margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));}
button{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:4px;padding:4px 11px;cursor:pointer;font:inherit;}
button:hover{filter:brightness(1.12);}
button.primary{background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
button.danger{color:var(--vscode-errorForeground);}
#empty{display:none;text-align:center;padding:30px 18px;color:var(--vscode-descriptionForeground);border:1px dashed var(--vscode-widget-border,rgba(255,255,255,.14));border-radius:8px;}
#empty.visible{display:block;}
.card{background:var(--vscode-editorWidget-background,rgba(255,255,255,.02));border:1px solid var(--vscode-widget-border,rgba(255,255,255,.08));border-radius:7px;padding:12px 14px;margin-bottom:10px;}
.head{display:flex;align-items:baseline;gap:10px;}
.name{font-size:14px;font-weight:600;}
.meta,.email,.ppath{color:var(--vscode-descriptionForeground);}
.warn{color:var(--vscode-editorWarning-foreground);margin:2px 0 0;}
.actions{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 10px;}
.projects h3,.key h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--vscode-descriptionForeground);margin:0 0 4px;}
.project{display:flex;align-items:center;gap:10px;padding:2px 0;}
.pname{font-weight:600;}
.ppath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.project.missing .pname,.project.missing .ppath{text-decoration:line-through;opacity:.7;}
.key{margin:0 0 10px;}
.kpath,.kfp{color:var(--vscode-descriptionForeground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.kfp{font-family:var(--vscode-editor-font-family);}
`;
/** The panel page. Contains no account data — the host posts that after the script announces `ready`. */
function buildHtml(nonce) {
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
<div id="page">
  <h1>Null Accounts</h1>
  <p class="subtitle">Each project uses one account for GitHub and GitLab features.</p>
  <div id="toolbar"><button id="add-btn" class="primary">Add account</button></div>
  <div id="list"></div>
  <div id="empty">No accounts yet — add one above.</div>
</div>
<script nonce="${nonce}">${accountsClient_1.CLIENT_SCRIPT}</script>
</body>
</html>`;
}
//# sourceMappingURL=accountsHtml.js.map