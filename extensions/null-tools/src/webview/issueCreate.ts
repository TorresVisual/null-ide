'use strict';

// The New issue form: a template chooser (when the repo has templates), then a title, a composer for the
// description and a sidebar of pickers. Renders into `root` and owns every click inside it; the entry script
// (issueDetail.ts) only forwards the host messages that belong to the form (see CreateForm).

interface CreateInit {
  metadata: DetailMetadata;
  templates: IssueTemplate[];
  parent: { number: number; title: string } | null;
  /** The unsent description from last time, offered for a blank issue. */
  draft: string;
}

/** What the form needs from the entry script, which it can't see into. */
interface CreateIo {
  post(message: unknown): void;
  toast(message: string): void;
  /** Queues the unsent description for the host to keep as the New issue draft. */
  saveDraftSoon(body: string): void;
  /** Cancels a queued draft save: the issue is being created. */
  dropDraft(): void;
}

/** The host messages the form answers. */
interface CreateForm {
  candidates(items: Array<{ number: number; title: string }>): void;
  setParent(parent: { number: number; title: string }): void;
  failed(): void;
  /** "Create more" succeeded: reset the form for the next issue. */
  created(number: number): void;
}

function renderCreateForm(root: HTMLElement, init: CreateInit, io: CreateIo): CreateForm {
  interface CreateState extends CreateSidebarState { template: IssueTemplate | null; createMore: boolean; busy: boolean; }
  const meta = init.metadata;
  const state: CreateState = {
    assignees: [], labels: [], type: null, milestone: null, parent: init.parent, template: null, createMore: false, busy: false,
  };
  let composer: Composer | null = null;
  let parentAnchor: HTMLElement | null = null;

  const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const titleInput = (): HTMLInputElement => byId<HTMLInputElement>('create-title');

  function renderSidebar(): void {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    sidebar.innerHTML = createSidebarHtml(state, meta);
    sidebar.querySelectorAll<HTMLImageElement>('.avatar img').forEach(img =>
      img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true }));
  }

  function showChooser(): void {
    composer = null;
    root.innerHTML = `<div id="create-form">${templateChooserHtml(init.templates)}</div>`;
    byId('create-form').addEventListener('click', onFormClick);
  }

  function showForm(template: IssueTemplate | null): void {
    state.template = template;
    state.labels = (template?.labels ?? [])
      .map(name => meta.labels.find(l => l.name.toLowerCase() === name.toLowerCase()))
      .filter((l): l is GithubLabel => !!l);
    root.innerHTML = `
      <div id="create-form">
        <div class="create-head">
          <h1 class="title">New issue</h1>
          ${init.templates.length > 0 ? '<button type="button" class="link-btn" data-act="change-template">Choose a different template</button>' : ''}
        </div>
        <div id="layout">
          <main id="main">
            <input id="create-title" class="create-title" placeholder="Title" aria-label="Title" autocomplete="off">
            <div id="title-error" class="field-error hidden">Title is required.</div>
            <div id="create-composer"></div>
            <div class="create-actions">
              <label class="create-more"><input type="checkbox" id="create-more"${state.createMore ? ' checked' : ''}> Create more</label>
              <button type="button" class="btn btn-secondary" data-act="cancel-create">Cancel</button>
              <button type="button" class="btn btn-primary" id="create-btn" data-act="submit-create">Create</button>
            </div>
          </main>
          <aside id="sidebar"></aside>
        </div>
      </div>`;
    titleInput().value = template?.title ?? '';
    composer = createComposer({
      value: template ? template.body : init.draft,
      label: 'Description',
      placeholder: 'Describe the issue',
      post: io.post,
      users: () => meta.assignees,
      // Only a blank issue is drafted; a template's text is just the starting point. Nothing is queued once Create was pressed.
      onChange: v => { if (!state.template && !state.busy) io.saveDraftSoon(v); },
      onSubmit: submit,
    });
    byId('create-composer').replaceWith(composer.el);
    renderSidebar();
    byId('create-form').addEventListener('click', onFormClick);
    byId<HTMLInputElement>('create-more').addEventListener('change', e => { state.createMore = (e.target as HTMLInputElement).checked; });
    titleInput().addEventListener('input', () => byId('title-error').classList.add('hidden'));
    titleInput().addEventListener('keydown', e => {
      if (e.isComposing || e.key !== 'Enter') return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) submit(); else composer?.focus();
    });
    titleInput().focus();
  }

  function submit(): void {
    if (state.busy || !composer) return;
    const title = titleInput().value.trim();
    if (!title) {
      byId('title-error').classList.remove('hidden');
      titleInput().focus();
      return;
    }
    state.busy = true;
    const button = byId<HTMLButtonElement>('create-btn');
    button.disabled = true;
    button.textContent = 'Creating…';
    io.dropDraft();
    io.post({
      type: 'submitCreate', title, body: composer.getValue(),
      labels: state.labels.map(l => l.name), assignees: state.assignees.map(a => a.login),
      milestone: state.milestone?.number ?? null, typeId: state.type?.id ?? null, parent: state.parent?.number ?? null,
      createMore: state.createMore,
    });
  }

  // ---- pickers ------------------------------------------------------------------------------------------------

  function pickAssignees(anchor: HTMLElement): void {
    const items = meta.assignees.map(u => ({
      value: u.login, label: u.login, html: `${avatarHtml(u)} ${escapeHtml(u.login)}`,
      selected: state.assignees.some(a => a.login === u.login),
    }));
    pickMany(anchor, 'Assign up to 10 people', items, chosen => {
      state.assignees = meta.assignees.filter(u => chosen.has(u.login));
      renderSidebar();
    });
  }

  function pickLabels(anchor: HTMLElement): void {
    const items = meta.labels.map(l => ({
      value: l.name, label: l.name, html: `<span class="gh-label" style="${labelStyleVars(l.color)}">${escapeHtml(l.name)}</span>`,
      description: l.description ?? undefined, selected: state.labels.some(c => c.name === l.name),
    }));
    pickMany(anchor, 'Apply labels', items, chosen => {
      state.labels = meta.labels.filter(l => chosen.has(l.name));
      renderSidebar();
    });
  }

  function pickMilestone(anchor: HTMLElement): void {
    const items: PickerItem[] = [{ value: '', label: 'No milestone', selected: state.milestone === null }]
      .concat(meta.milestones.map(m => ({ value: String(m.number), label: m.title, selected: m.number === state.milestone?.number })));
    openPicker({
      anchor, title: 'Set milestone', items, filterable: items.length > 8,
      onSelect: v => {
        state.milestone = v === '' ? null : meta.milestones.find(m => String(m.number) === v) ?? null;
        renderSidebar();
      },
    });
  }

  function pickType(anchor: HTMLElement): void {
    const items: PickerItem[] = [{ value: '', label: 'No type', selected: state.type === null }]
      .concat(meta.types.map(t => ({ value: t.id, label: t.name, selected: t.id === state.type?.id })));
    openPicker({
      anchor, title: 'Set issue type', items, filterable: false,
      onSelect: v => {
        state.type = v === '' ? null : meta.types.find(t => t.id === v) ?? null;
        renderSidebar();
      },
    });
  }

  function onFormClick(e: Event): void {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!act) return;
    switch (act.dataset.act) {
      case 'pick-template': {
        const index = Number(act.dataset.index);
        showForm(index >= 0 ? init.templates[index] : null);
        break;
      }
      case 'change-template': showChooser(); break;
      case 'pick-assignees': pickAssignees(act); break;
      case 'pick-labels': pickLabels(act); break;
      case 'pick-milestone': pickMilestone(act); break;
      case 'pick-type': pickType(act); break;
      case 'pick-parent':
        parentAnchor = act;
        io.post({ type: 'requestCandidates' });
        break;
      case 'submit-create': submit(); break;
      case 'cancel-create': io.post({ type: 'cancelCreate' }); break;
    }
  }

  if (init.templates.length > 0) showChooser(); else showForm(null);

  return {
    candidates(items) {
      if (!parentAnchor) return;
      const picks: PickerItem[] = [{ value: '', label: 'No parent', selected: state.parent === null }]
        .concat(items.map(c => ({ value: String(c.number), label: `#${c.number} ${c.title}`, selected: c.number === state.parent?.number })));
      openPicker({
        anchor: parentAnchor, title: 'Set parent issue', items: picks, emptyText: 'No other open issues',
        onSelect: v => {
          state.parent = v === '' ? null : items.find(c => String(c.number) === v) ?? null;
          renderSidebar();
        },
      });
    },
    setParent(parent) {
      state.parent = parent;
      renderSidebar();
    },
    failed() {
      state.busy = false;
      const button = document.getElementById('create-btn') as HTMLButtonElement | null;
      if (button) {
        button.disabled = false;
        button.textContent = 'Create';
      }
    },
    created(number) {
      state.busy = false;
      io.toast(`Created #${number}`);
      // Keeps the template, labels, milestone and parent; the next issue starts with a fresh title, text, assignees and type.
      state.assignees = [];
      state.type = null;
      titleInput().value = state.template?.title ?? '';
      composer?.setValue(state.template?.body ?? '');
      const button = byId<HTMLButtonElement>('create-btn');
      button.disabled = false;
      button.textContent = 'Create';
      renderSidebar();
      titleInput().focus();
    },
  };
}
