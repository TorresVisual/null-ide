'use strict';

// The Write / Preview editor behind new comments, comment and description edits, and the New issue form.
// DOM only, so it has no unit tests; every text change it applies comes from composerText.ts, which does.

interface ComposerOptions {
  /** Initial text. */
  value: string;
  /** What Esc compares against to decide whether there is anything to discard. Default: `value`. */
  pristine?: string;
  label: string;
  placeholder: string;
  post(message: unknown): void;
  /** People `@` can mention. Read on every keystroke, so it may change while the composer is open. */
  users(): GithubUser[];
  onChange?(value: string): void;
  /** Ctrl/Cmd+Enter. */
  onSubmit?(): void;
  /** Esc. With unsent changes the first Esc only asks to press it again. */
  onCancel?(): void;
}

interface Composer {
  el: HTMLElement;
  getValue(): string;
  setValue(value: string): void;
  /** Appends a block (a quote) after the current text, switches to Write and focuses. */
  insertBlock(block: string): void;
  focus(): void;
}

/** Host answers the composers are still waiting for (preview, `#` suggestions), by request id. */
const composerWaiting = new Map<number, (msg: any) => void>();
let composerSeq = 0;

/** Routes the host's `previewResult` / `suggestions` to whichever composer asked. Unknown or already-answered ids are ignored. */
function composerReceive(msg: { requestId?: number }): void {
  const waiting = msg.requestId === undefined ? undefined : composerWaiting.get(msg.requestId);
  if (!waiting) return;
  composerWaiting.delete(msg.requestId!);
  waiting(msg);
}

const COMPOSER_MIRRORED = [
  'box-sizing', 'width', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'tab-size',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
];

/** Where the caret at `index` is inside `ta`, measured by laying the same text out in a hidden copy of it. */
function composerCaretOffset(ta: HTMLTextAreaElement, index: number): { left: number; top: number; height: number } {
  const style = getComputedStyle(ta);
  const mirror = document.createElement('div');
  for (const prop of COMPOSER_MIRRORED) mirror.style.setProperty(prop, style.getPropertyValue(prop));
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = ta.value.slice(0, index);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const at = { left: marker.offsetLeft - ta.scrollLeft, top: marker.offsetTop - ta.scrollTop, height: marker.offsetHeight };
  mirror.remove();
  return at;
}

function createComposer(opts: ComposerOptions): Composer {
  const el = document.createElement('div');
  el.className = 'composer';
  el.innerHTML = `
    <div class="composer-head">
      <div class="composer-tabs" role="tablist">
        <button type="button" class="composer-tab active" role="tab" aria-selected="true" data-tab="write">Write</button>
        <button type="button" class="composer-tab" role="tab" aria-selected="false" data-tab="preview">Preview</button>
      </div>
      <div class="composer-tools">${COMPOSER_TOOLS.map(t =>
        `<button type="button" class="icon-btn" data-tool="${t.id}" title="${t.title}" aria-label="${t.title}">${octicon(t.icon)}</button>`).join('')}</div>
    </div>
    <textarea class="composer-input" spellcheck="true"></textarea>
    <div class="composer-preview post-body hidden"></div>
    <div class="composer-hint hidden" role="status"></div>
    <div class="composer-suggest hidden" role="listbox"></div>`;
  const ta = el.querySelector('.composer-input') as HTMLTextAreaElement;
  const preview = el.querySelector('.composer-preview') as HTMLElement;
  const hint = el.querySelector('.composer-hint') as HTMLElement;
  const popup = el.querySelector('.composer-suggest') as HTMLElement;
  const tools = el.querySelector('.composer-tools') as HTMLElement;
  ta.value = opts.value;
  ta.placeholder = opts.placeholder;
  ta.setAttribute('aria-label', opts.label);

  let mode: 'write' | 'preview' = 'write';
  let previewedText: string | null = null;
  let previewSeq = 0;
  let armedDiscard = false;
  let suggestions: ComposerSuggestion[] = [];
  let active = 0;
  let trigger: { trigger: '@' | '#'; prefix: string; start: number } | null = null;
  let suggestSeq = 0;
  let suggestTimer: ReturnType<typeof setTimeout> | undefined;

  const changed = (): void => {
    armedDiscard = false;
    hint.classList.add('hidden');
    opts.onChange?.(ta.value);
  };

  // ---- text edits ---------------------------------------------------------------------------------------------

  /** Replaces the whole text through the browser's edit command so Ctrl+Z still works; plain assignment would wipe the undo stack. */
  function replaceAll(edit: ComposerEdit): void {
    const scroll = ta.scrollTop;
    ta.focus();
    ta.select();
    if (!edit.value || !document.execCommand('insertText', false, edit.value)) ta.value = edit.value;
    ta.setSelectionRange(edit.start, edit.end);
    ta.scrollTop = scroll;
    closeSuggest(); // the input event the edit command fires may have opened the popup for the old caret
    changed();
  }

  function runTool(id: string): void {
    if (mode !== 'write') return;
    const edit = applyTool(id, ta.value, ta.selectionStart, ta.selectionEnd);
    if (edit) replaceAll(edit);
  }

  // ---- Write / Preview ----------------------------------------------------------------------------------------

  function showPreview(): void {
    const text = ta.value;
    previewedText = null;
    if (!text.trim()) {
      preview.innerHTML = '<span class="muted">Nothing to preview</span>';
      return;
    }
    preview.innerHTML = '<span class="muted">Loading preview…</span>';
    const id = ++composerSeq;
    previewSeq = id;
    composerWaiting.set(id, msg => {
      // The user may have gone back to Write, or asked for a newer preview, while this was in flight.
      if (mode !== 'preview' || previewSeq !== id) return;
      if (msg.error) {
        preview.innerHTML = `<span class="field-error">${escapeHtml(msg.error)}</span>`;
        return;
      }
      preview.innerHTML = DOMPurify.sanitize(neutralizeImagesHtml(msg.html));
      previewedText = text;
    });
    opts.post({ type: 'preview', requestId: id, text });
  }

  function setMode(next: 'write' | 'preview'): void {
    mode = next;
    closeSuggest();
    el.querySelectorAll<HTMLElement>('.composer-tab').forEach(tab => {
      const on = tab.dataset.tab === next;
      tab.classList.toggle('active', on);
      tab.setAttribute('aria-selected', String(on));
    });
    ta.classList.toggle('hidden', next === 'preview');
    tools.classList.toggle('hidden', next === 'preview');
    preview.classList.toggle('hidden', next === 'write');
    if (next === 'write') ta.focus();
    else if (previewedText !== ta.value) showPreview();
  }

  // ---- @ and # autocomplete -----------------------------------------------------------------------------------

  function closeSuggest(): void {
    clearTimeout(suggestTimer);
    suggestSeq++; // any answer still on its way is now stale
    suggestions = [];
    trigger = null;
    popup.classList.add('hidden');
  }

  function renderSuggest(): void {
    if (suggestions.length === 0) {
      popup.classList.add('hidden');
      return;
    }
    popup.innerHTML = suggestions.map((s, i) =>
      `<button type="button" class="composer-suggest-item${i === active ? ' active' : ''}" role="option" data-index="${i}">${s.html}</button>`).join('');
    popup.classList.remove('hidden');
    const at = composerCaretOffset(ta, ta.selectionStart);
    popup.style.left = `${Math.max(0, Math.min(ta.offsetLeft + at.left, el.clientWidth - popup.offsetWidth - 4))}px`;
    popup.style.top = `${ta.offsetTop + at.top + at.height + 2}px`;
  }

  function updateSuggest(): void {
    const t = ta.selectionStart === ta.selectionEnd ? activeTrigger(ta.value, ta.selectionStart) : null;
    if (!t) {
      closeSuggest();
      return;
    }
    trigger = t;
    clearTimeout(suggestTimer);
    const id = ++suggestSeq;
    if (t.trigger === '@') {
      suggestions = matchUsers(opts.users(), t.prefix).map(userSuggestion);
      active = 0;
      renderSuggest();
      return;
    }
    suggestTimer = setTimeout(() => {
      const request = ++composerSeq;
      composerWaiting.set(request, msg => {
        if (id !== suggestSeq || !trigger) return; // typed on, moved the caret, or closed the popup
        suggestions = (msg.items as Array<{ number: number; title: string; state: string }>).map(issueSuggestion);
        active = 0;
        renderSuggest();
      });
      opts.post({ type: 'suggest', requestId: request, prefix: t.prefix });
    }, 150);
  }

  function accept(index: number): void {
    const s = suggestions[index];
    if (!s || !trigger) return;
    replaceAll(applySuggestion(ta.value, trigger.start, ta.selectionStart, s.insert));
  }

  // ---- events -------------------------------------------------------------------------------------------------

  ta.addEventListener('input', () => {
    changed();
    updateSuggest();
  });
  ta.addEventListener('click', updateSuggest);
  ta.addEventListener('blur', closeSuggest);

  ta.addEventListener('keydown', e => {
    if (e.isComposing) return; // an input method is still choosing characters
    const open = !popup.classList.contains('hidden');
    const mod = e.ctrlKey || e.metaKey;
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length;
      renderSuggest();
      return;
    }
    if (open && (e.key === 'Enter' || e.key === 'Tab') && !mod) {
      e.preventDefault();
      accept(active);
      return;
    }
    if (open && e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeSuggest();
      return;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      opts.onSubmit?.();
      return;
    }
    if (mod && !e.altKey && !e.shiftKey) {
      const tool = COMPOSER_TOOLS.find(t => t.key === e.key.toLowerCase());
      if (tool) {
        e.preventDefault();
        runTool(tool.id);
        return;
      }
    }
    if (e.key === 'Escape' && opts.onCancel) {
      e.preventDefault();
      if (ta.value !== (opts.pristine ?? opts.value) && !armedDiscard) {
        armedDiscard = true;
        hint.textContent = 'Press Esc again to discard your changes.';
        hint.classList.remove('hidden');
      } else {
        opts.onCancel();
      }
    }
  });

  el.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    const tab = target.closest<HTMLElement>('[data-tab]');
    if (tab) {
      setMode(tab.dataset.tab as 'write' | 'preview');
      return;
    }
    const tool = target.closest<HTMLElement>('[data-tool]');
    if (tool) runTool(tool.dataset.tool!);
  });

  // mousedown, not click, and preventDefault: the textarea keeps focus, so the blur handler doesn't close the popup first.
  popup.addEventListener('mousedown', e => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest<HTMLElement>('.composer-suggest-item');
    if (item) accept(Number(item.dataset.index));
  });

  return {
    el,
    getValue: () => ta.value,
    setValue(value) {
      if (mode === 'preview') setMode('write');
      replaceAll({ value, start: value.length, end: value.length });
    },
    insertBlock(block) {
      if (mode === 'preview') setMode('write');
      const base = ta.value.replace(/\s+$/, '');
      const value = `${base ? `${base}\n\n` : ''}${block}\n\n`;
      replaceAll({ value, start: value.length, end: value.length });
      ta.scrollTop = ta.scrollHeight;
    },
    focus() {
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    },
  };
}
