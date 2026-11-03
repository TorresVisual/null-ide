import { describe } from '../src/viewer/value';
import { applyMask, isToneMapped, Mask } from '../src/viewer/channels';
import { fitView, View, zoomAbout } from '../src/viewer/geometry';
import type { ToWebview } from '../src/viewer/messages';
import { mountFrame } from './frame';

// Each row shows one or more data keys, joined with × (a size is width × height).
const INSPECTOR_ROWS: [string, string[]][] = [
  ['Size', ['width', 'height']],
  ['Built size', ['builtWidth', 'builtHeight']],
  ['Compression', ['compression']],
  ['sRGB', ['sRGB']],
  ['LOD group', ['lodGroup']],
  ['Mip generation', ['mipGenSettings']],
  ['Format', ['format']],
  ['Mip count', ['mipCount']],
];

function line(label: string, value: string): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  const k = document.createElement('span');
  k.className = 'key';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'value';
  v.textContent = value;
  r.append(k, v);
  return r;
}

function button(text: string, onClick: () => void, pressed?: boolean): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  if (pressed !== undefined) b.setAttribute('aria-pressed', String(pressed));
  b.addEventListener('click', onClick);
  return b;
}

// Canvas with zoom, pan, fit, 1:1 and R/G/B/A toggles. The masked image is drawn to an offscreen canvas once per
// mask change, then placed with the view transform on every pointer move.
function renderTexture(
  m: Extract<ToWebview, { type: 'ready' }>,
  body: HTMLElement,
  inspector: HTMLElement,
  showInspector: () => void,
): void {
  const preview = m.sidecars.preview;
  if (typeof preview !== 'string') {
    body.append(line('Preview', describe(preview)));
    return;
  }
  if (isToneMapped(m.data as { compression?: unknown })) {
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = 'HDR/float texture — tone-mapped preview';
    body.append(note);
  }

  const mask: Mask = { r: true, g: true, b: true, a: true };
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  const canvas = document.createElement('canvas');
  canvas.className = 'texture-canvas';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `${m.name} preview`);
  const wrap = document.createElement('div');
  wrap.className = 'canvas-wrap';
  wrap.append(canvas);
  body.append(toolbar, wrap);

  const off = document.createElement('canvas');
  const img = new Image();
  let view: View = { scale: 1, x: 0, y: 0 };
  let content = { w: 1, h: 1 };
  let source: ImageData | undefined;

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx || !source) return;
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    ctx.drawImage(off, 0, 0);
  };
  const remask = () => {
    if (!source) return;
    off.width = source.width;
    off.height = source.height;
    const octx = off.getContext('2d');
    if (!octx) return;
    const pixels = applyMask(source.data, mask);
    octx.putImageData(new ImageData(pixels, source.width, source.height), 0, 0);
    draw();
  };
  const fit = () => {
    view = fitView(content, { w: wrap.clientWidth, h: wrap.clientHeight }, 16);
    draw();
  };
  const actual = () => {
    view = { scale: 1, x: (wrap.clientWidth - content.w) / 2, y: (wrap.clientHeight - content.h) / 2 };
    draw();
  };

  const channel = (k: keyof Mask) => {
    const b = button(k.toUpperCase(), () => {
      mask[k] = !mask[k];
      b.setAttribute('aria-pressed', String(mask[k]));
      remask();
    }, true);
    b.setAttribute('aria-label', `Show ${k.toUpperCase()} channel`);
    return b;
  };
  toolbar.append(
    button('Fit', fit),
    button('1:1', actual),
    channel('r'),
    channel('g'),
    channel('b'),
    channel('a'),
    button('Inspector', showInspector),
  );

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      view = zoomAbout(view, { x: e.clientX - rect.left, y: e.clientY - rect.top }, e.deltaY < 0 ? 1.15 : 1 / 1.15);
      draw();
    },
    { passive: false },
  );
  let drag: { x: number; y: number } | undefined;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    view = { ...view, x: view.x + e.clientX - drag.x, y: view.y + e.clientY - drag.y };
    drag = { x: e.clientX, y: e.clientY };
    draw();
  });
  canvas.addEventListener('pointerup', () => (drag = undefined));

  img.onload = () => {
    content = { w: img.naturalWidth, h: img.naturalHeight };
    const probe = document.createElement('canvas');
    probe.width = content.w;
    probe.height = content.h;
    const pctx = probe.getContext('2d');
    if (!pctx) return;
    pctx.drawImage(img, 0, 0);
    source = pctx.getImageData(0, 0, content.w, content.h);
    remask();
    fit();
  };
  img.onerror = () => body.append(line('Preview', 'not available: the PNG did not load'));
  img.src = preview;
  window.addEventListener('resize', () => {
    if (source) fit();
  });

  inspector.replaceChildren(
    ...INSPECTOR_ROWS.map(([label, keys]) =>
      line(label, keys.map((k) => describe(m.data[k])).join(' × ')),
    ),
  );
}

const frame = mountFrame((m: ToWebview) => {
  if (m.type === 'ready') renderTexture(m, frame.body, frame.inspector, frame.showInspector);
});
