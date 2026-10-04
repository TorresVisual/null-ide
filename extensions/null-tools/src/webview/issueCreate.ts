'use strict';

// The New issue form. Moved out of issueDetail.ts unchanged in behavior; the Phase 4 composer rewrites it.

interface CreateFormData { repoLabels: GithubLabel[]; assignableUsers: GithubUser[]; templates: IssueTemplate[]; }
interface DropdownItem { value: string; label: string; color?: string; }

/** Closes the form's open dropdowns. Set while the form is on screen. */
let closeCreateDropdowns: (() => void) | null = null;

document.addEventListener('click', e => {
  if (e.composedPath().some(n => n instanceof Element && n.classList.contains('dropdown-container'))) return;
  closeCreateDropdowns?.();
});

function renderDropdown(
  containerId: string, items: DropdownItem[], selected: Set<string>,
  isOpen: () => boolean, toggleOpen: () => void, placeholder: string,
): () => void {
  const refresh = () => {
    const container = document.getElementById(containerId) as HTMLDivElement | null;
    if (!container) return;
    const open = isOpen();
    const selectedItems = items.filter(i => selected.has(i.value));
    container.innerHTML = `
      <button type="button" class="dropdown-trigger">
        ${selectedItems.length > 0 ? `<span class="selected-tags">${selectedItems.map(i => `
          <span class="tag${i.color ? ' gh-label' : ''}"${i.color ? ` style="${labelStyleVars(i.color)}"` : ''}>${escapeHtml(i.label)}<span class="tag-remove" data-value="${escapeHtml(i.value)}">&times;</span></span>`).join('')}</span>`
          : `<span class="dropdown-placeholder">${escapeHtml(placeholder)}</span>`}
        <span class="dropdown-arrow">${open ? '▲' : '▼'}</span>
      </button>
      <div class="dropdown-list${open ? '' : ' hidden'}">
        ${items.length === 0 ? '<span class="muted">None available.</span>' : items.map(i => `
          <button type="button" class="dropdown-item${selected.has(i.value) ? ' selected' : ''}" data-value="${escapeHtml(i.value)}">
            <span class="checkbox">${selected.has(i.value) ? '☑' : '☐'}</span>
            ${i.color ? `<span class="color-dot" style="background:#${i.color}"></span>` : ''}
            ${escapeHtml(i.label)}
          </button>`).join('')}
      </div>`;
    container.querySelector('.dropdown-trigger')?.addEventListener('click', () => {
      toggleOpen();
      refresh();
    });
    container.querySelectorAll<HTMLElement>('.tag-remove').forEach(el => el.addEventListener('mousedown', e => {
      e.preventDefault();
      selected.delete(el.dataset.value!);
      refresh();
    }));
    container.querySelectorAll<HTMLElement>('.dropdown-item').forEach(el => el.addEventListener('click', () => {
      const v = el.dataset.value!;
      if (selected.has(v)) selected.delete(v); else selected.add(v);
      refresh();
    }));
  };
  refresh();
  return refresh;
}

function renderCreateForm(root: HTMLElement, data: CreateFormData, post: (message: unknown) => void): void {
  let labelOpen = false;
  let assigneeOpen = false;
  const selectedLabels = new Set<string>();
  const selectedAssignees = new Set<string>();
  root.innerHTML = `
    <div id="create-form">
      <h1 class="title">New issue</h1>
      <div class="edit-form">
        ${data.templates.length > 0 ? `
        <select id="template-picker">
          <option value="">Blank issue</option>
          ${data.templates.map((t, i) => `<option value="${i}">${escapeHtml(t.name)}</option>`).join('')}
        </select>` : ''}
        <input id="edit-title" placeholder="Title">
        <div id="title-error" class="field-error hidden">Title is required.</div>
        <textarea id="edit-body" placeholder="Description"></textarea>
        <div class="picker-group">
          <span class="assignees-label">Labels:</span>
          <div class="dropdown-container" id="label-picker"></div>
        </div>
        <div class="picker-group">
          <span class="assignees-label">Assignees:</span>
          <div class="dropdown-container" id="assignee-picker"></div>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" id="save-btn">Create</button>
          <button class="btn btn-secondary" id="cancel-btn">Cancel</button>
        </div>
      </div>
    </div>`;
  const refreshLabels = renderDropdown(
    'label-picker', data.repoLabels.map(l => ({ value: l.name, label: l.name, color: l.color })), selectedLabels,
    () => labelOpen, () => { labelOpen = !labelOpen; }, 'Select labels…',
  );
  const refreshAssignees = renderDropdown(
    'assignee-picker', data.assignableUsers.map(u => ({ value: u.login, label: u.login })), selectedAssignees,
    () => assigneeOpen, () => { assigneeOpen = !assigneeOpen; }, 'Select assignees…',
  );
  closeCreateDropdowns = () => {
    if (!labelOpen && !assigneeOpen) return;
    labelOpen = false;
    assigneeOpen = false;
    refreshLabels();
    refreshAssignees();
  };
  document.getElementById('template-picker')?.addEventListener('change', e => {
    const index = (e.target as HTMLSelectElement).value;
    const template = index ? data.templates[Number(index)] : null;
    (document.getElementById('edit-title') as HTMLInputElement).value = template?.title ?? '';
    (document.getElementById('edit-body') as HTMLTextAreaElement).value = template?.body ?? '';
    selectedLabels.clear();
    template?.labels.forEach(l => {
      const match = data.repoLabels.find(rl => rl.name.toLowerCase() === l.toLowerCase());
      if (match) selectedLabels.add(match.name);
    });
    refreshLabels();
  });
  const titleInput = document.getElementById('edit-title') as HTMLInputElement;
  const titleError = document.getElementById('title-error') as HTMLDivElement;
  titleInput.addEventListener('input', () => titleError.classList.add('hidden'));
  document.getElementById('save-btn')?.addEventListener('click', () => {
    const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
    if (saveBtn.disabled) return;
    const title = titleInput.value.trim();
    if (!title) {
      titleError.classList.remove('hidden');
      titleInput.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = 'Creating…';
    post({
      type: 'submitCreate', title,
      body: (document.getElementById('edit-body') as HTMLTextAreaElement).value,
      labels: Array.from(selectedLabels), assignees: Array.from(selectedAssignees),
    });
  });
  document.getElementById('cancel-btn')?.addEventListener('click', () => post({ type: 'cancelCreate' }));
}
