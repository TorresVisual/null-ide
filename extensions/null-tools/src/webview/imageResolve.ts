'use strict';

// Thumbnails for the images in rendered markdown (posts and the composer's preview). neutralizeImagesHtml leaves a
// `.img-placeholder` chip per image; this asks the host for a local copy of each (it downloads with the token, which the
// webview doesn't have) and swaps the chip for an <img> once the copy exists. DOM only, so no unit tests: which URLs are
// images and where they come from is decided host-side (imageUrls.ts).
// ponytail: no reserved size, so the layout shifts when an image appears; add width/height from the <img> tag if it bothers anyone.

/** Webview URI of each image's local copy, by the URL the post carries. Outlives renders: the timeline is rebuilt often. */
const resolvedImages = new Map<string, string>();
/** Why an image failed, by URL, so a re-render shows the reason again without asking the host twice. */
const failedImages = new Map<string, string>();
/** URLs already sent to the host. */
const requestedImages = new Set<string>();

function markImageFailed(placeholder: HTMLElement, reason: string): void {
  placeholder.classList.add('img-failed');
  placeholder.title = `Couldn't load this image (${reason}). Click to open it on github.com.`;
}

function showImage(placeholder: HTMLElement, src: string): void {
  const url = placeholder.dataset.src ?? '';
  const img = document.createElement('img');
  img.className = 'post-img';
  img.alt = placeholder.dataset.alt ?? '';
  img.addEventListener('error', () => {
    // The local file wouldn't load (deleted, or outside the folders the webview may read): fall back to the chip, once.
    resolvedImages.delete(url);
    failedImages.set(url, 'the local copy could not be read');
    markImageFailed(placeholder, 'the local copy could not be read');
    img.replaceWith(placeholder);
  }, { once: true });
  img.src = src;
  placeholder.replaceWith(img);
}

/** Thumbnails for the placeholders in `container`: known ones right away, new ones after one batched request to the host. */
function resolveImagesIn(container: ParentNode, post: (message: unknown) => void): void {
  const wanted: string[] = [];
  container.querySelectorAll<HTMLElement>('.img-placeholder[data-src]').forEach(el => {
    const url = el.dataset.src!;
    const src = resolvedImages.get(url);
    const failure = failedImages.get(url);
    if (src) showImage(el, src);
    else if (failure) markImageFailed(el, failure);
    else if (!requestedImages.has(url)) {
      requestedImages.add(url);
      wanted.push(url);
    }
  });
  if (wanted.length > 0) post({ type: 'resolveImages', urls: wanted });
}

/** The host has the file: every chip for that URL, wherever it is on the page, becomes the image. */
function imageResolved(url: string, src: string): void {
  resolvedImages.set(url, src);
  document.querySelectorAll<HTMLElement>('.img-placeholder[data-src]').forEach(el => {
    if (el.dataset.src === url) showImage(el, src);
  });
}

function imageFailed(url: string, reason: string): void {
  failedImages.set(url, reason);
  document.querySelectorAll<HTMLElement>('.img-placeholder[data-src]').forEach(el => {
    if (el.dataset.src === url) markImageFailed(el, reason);
  });
}

/** Forgets failures so the next render asks again: a refresh, after the user fixed their connection. */
function retryFailedImages(): void {
  for (const url of failedImages.keys()) requestedImages.delete(url);
  failedImages.clear();
}
