import type { FromWebview, ToWebview } from '../src/viewer/messages';

// Provided by VS Code inside every webview; the only way out of the page.
declare function acquireVsCodeApi(): { postMessage(m: FromWebview): void };
const vscode = acquireVsCodeApi();

export interface Frame {
  send(m: FromWebview): void;
  body: HTMLElement;
  inspector: HTMLElement;
  showInspector(): void;
  hideInspector(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { cls?: string; text?: string; label?: string } = {},
  ...kids: Node[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (props.cls) e.className = props.cls;
  if (props.text !== undefined) e.textContent = props.text;
  if (props.label) e.setAttribute('aria-label', props.label);
  e.append(...kids);
  return e;
}

function button(text: string, onClick: () => void, label?: string): HTMLButtonElement {
  const b = el('button', { text, label });
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// Header, body and inspector for every page. The frame owns the exporting, failed and stale states;
// a page only renders a `ready` document, which it receives through onMessage.
export function mountFrame(onMessage: (m: ToWebview) => void): Frame {
  const send = (m: FromWebview) => vscode.postMessage(m);
  const name = el('span', { cls: 'name' });
  const kind = el('span', { cls: 'kind' });
  const badge = el('span', { cls: 'badge', text: 'saved file' });
  const reexport = button('↻ Re-export', () => send({ type: 'reexport' }), 'Re-export from Unreal');
  const header = el('header', { cls: 'bar' }, name, kind, badge, reexport);

  const banner = button('File changed — click to update', () => send({ type: 'update' }));
  banner.className = 'banner';
  banner.hidden = true;

  const body = el('section', { cls: 'body' });
  const inspector = el('aside', { cls: 'inspector' });
  inspector.hidden = true;
  inspector.tabIndex = -1;
  const stage = el('main', { cls: 'stage' }, body, inspector);

  document.getElementById('app')!.replaceChildren(header, banner, stage);

  const showInspector = () => {
    inspector.hidden = false;
    inspector.focus();
  };
  const hideInspector = () => {
    inspector.hidden = true;
  };
  // Clicking the empty canvas closes the inspector; clicks on nodes are handled by the page.
  body.addEventListener('click', (e) => {
    if (e.target === body) hideInspector();
  });

  const status = (text: string, extra: Node[] = []) => {
    body.replaceChildren(el('div', { cls: 'status' }, el('p', { text }), ...extra));
  };

  window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
    const m = event.data;
    switch (m.type) {
      case 'exporting':
        banner.hidden = true;
        status('Exporting from Unreal, about 6 s…');
        break;
      case 'failed':
        banner.hidden = true;
        status(m.error, [
          el('p', { cls: 'hint', text: m.hint ?? 'The export did not run. The Null Unreal output has the engine log.' }),
          button('Reopen as text', () => send({ type: 'reopenText' })),
          button('Open log', () => send({ type: 'openLog' })),
        ]);
        break;
      case 'stale':
        banner.hidden = false;
        break;
      case 'ready':
        banner.hidden = true;
        name.textContent = m.name;
        kind.textContent = m.kind;
        body.replaceChildren();
        onMessage(m);
        break;
      case 'thumbs':
        onMessage(m);
        break;
    }
  });

  send({ type: 'ready' });
  return { send, body, inspector, showInspector, hideInspector };
}
