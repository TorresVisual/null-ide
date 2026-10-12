'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReportHtml = getReportHtml;
/** The whole UI is built by lib/report.js; this page only sets the CSP and loads it. */
function getReportHtml(nonce, cspSource, scriptUri, styleUri) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>Startup Performance</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
//# sourceMappingURL=reportHtml.js.map