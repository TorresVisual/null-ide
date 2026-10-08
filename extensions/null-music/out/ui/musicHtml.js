'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMusicWebviewHtml = getMusicWebviewHtml;
/** The whole UI is built by lib/music.js; this page only sets the CSP and loads it. */
function getMusicWebviewHtml(nonce, cspSource, scriptUri, styleUri) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource}; script-src 'nonce-${nonce}'; media-src ${cspSource} https: http: blob: data:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>Null Music</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}
//# sourceMappingURL=musicHtml.js.map