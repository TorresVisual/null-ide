'use strict';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };
const vscodeApi = acquireVsCodeApi(); // may be called only once per webview

/** The only way the webview talks to the host; the union makes a renamed message a compile error. */
function send(msg: WebviewToHost): void {
  vscodeApi.postMessage(msg);
}
