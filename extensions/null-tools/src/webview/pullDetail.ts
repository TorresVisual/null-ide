'use strict';

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
declare const DOMPurify: { sanitize(html: string): string };

(function () {
  const vscode = acquireVsCodeApi();
  const root = document.getElementById('detail') as HTMLDivElement;
  const toastEl = document.createElement('div');
  toastEl.id = 'toast';
  toastEl.className = 'hidden';
  toastEl.setAttribute('role', 'status');
  document.body.appendChild(toastEl);

  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let pageUrl = '';

  const post = (message: unknown): void => vscode.postMessage(message);

  function toast(message: string): void {
    toastEl.textContent = message;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 6000);
  }

  /** Replaces the whole page (a refresh is rare and small) and keeps the scroll position. */
  function render(page: PullPage): void {
    pageUrl = page.url;
    const scroll = window.scrollY;
    root.innerHTML = pullPageHtml(withBodies(page, html => DOMPurify.sanitize(neutralizeImagesHtml(html))));
    window.scrollTo(0, scroll);
  }

  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const placeholder = target.closest<HTMLElement>('.img-placeholder');
    if (placeholder && !placeholder.closest('a')) {
      post({ type: 'openExternal', url: placeholder.dataset.src ?? '' });
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (anchor) {
      event.preventDefault();
      post({ type: 'openExternal', url: anchor.getAttribute('href') ?? '' }); // the host opens absolute https links only
      return;
    }
    const button = target.closest<HTMLElement>('[data-act]');
    switch (button?.dataset.act) {
      case 'checkout': post({ type: 'checkout' }); break;
      case 'refresh': post({ type: 'refresh' }); break;
      case 'open-github': post({ type: 'openExternal', url: pageUrl }); break;
      case 'rerun':
        (button as HTMLButtonElement).disabled = true; // the host answers with a toast and a fresh page
        post({ type: 'rerun' });
        break;
    }
  });

  window.addEventListener('message', event => {
    const msg = event.data as { type: string; page?: PullPage; message?: string };
    if (msg.type === 'page' && msg.page) render(msg.page);
    else if (msg.type === 'toast' && msg.message) toast(msg.message);
    else if (msg.type === 'error') root.innerHTML = `<div id="empty">${escapeHtml(msg.message ?? 'Could not load this pull request.')}</div>`;
  });

  post({ type: 'ready' });
})();
