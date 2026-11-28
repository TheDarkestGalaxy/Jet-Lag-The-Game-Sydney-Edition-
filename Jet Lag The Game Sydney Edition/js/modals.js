// Clean in-app mobile-friendly modal helpers (replaces ugly native browser alert/confirm/prompt dialogs)

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const TEAM_COLOR_SWATCHES = [
  '#F99D1C', // T1 Gold
  '#0098CD', // T2 Blue
  '#168388', // M1 Metro Teal
  '#D11F2F', // T9 Red
  '#5AB031', // F1 Ferry Green
  '#C4258F', // T5 Magenta
  '#005AA3', // T4 Illawarra Blue
  '#F37021', // T3 Orange
  '#00954C', // T8 Airport Green
  '#a855f7'  // Purple
];

export const ACCENT_THEMES = [
  { id: 'gold', name: 'Sydney Gold (T1)', color: '#F99D1C', secondary: '#168388' },
  { id: 'teal', name: 'Metro Teal (M1)', color: '#168388', secondary: '#0098CD' },
  { id: 'blue', name: 'Harbour Blue (T2)', color: '#0098CD', secondary: '#F99D1C' },
  { id: 'red', name: 'Northern Red (T9)', color: '#D11F2F', secondary: '#F99D1C' },
  { id: 'green', name: 'Ferry Green (F1)', color: '#5AB031', secondary: '#0098CD' }
];

export function openAppModal(html) {
  const box = document.getElementById('app-modal-box');
  const backdrop = document.getElementById('app-modal');
  if (!box || !backdrop) return;
  box.innerHTML = html;
  backdrop.classList.add('open');
}

export function closeAppModal() {
  document.getElementById('app-modal')?.classList.remove('open');
}

export function showConfirmModal({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  openAppModal(`
    <div class="card-title">${esc(title)}</div>
    <p class="muted">${esc(message)}</p>
    <div class="row">
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="m-cfm-ok" style="flex:1">${esc(confirmLabel)}</button>
      <button class="btn btn-ghost" id="m-cfm-cancel">Cancel</button>
    </div>
  `);
  document.getElementById('m-cfm-ok').onclick = () => {
    closeAppModal();
    onConfirm?.();
  };
  document.getElementById('m-cfm-cancel').onclick = () => closeAppModal();
}

export function showPromptModal({ title, label, value = '', placeholder = '', type = 'text', submitLabel = 'Save', onSubmit }) {
  openAppModal(`
    <div class="card-title">${esc(title)}</div>
    <div class="field">
      <label>${esc(label)}</label>
      <input type="${esc(type)}" id="m-prm-input" class="input" value="${esc(value)}" placeholder="${esc(placeholder)}" />
    </div>
    <div class="row">
      <button class="btn btn-primary" id="m-prm-ok" style="flex:1">${esc(submitLabel)}</button>
      <button class="btn btn-ghost" id="m-prm-cancel">Cancel</button>
    </div>
  `);
  const inp = document.getElementById('m-prm-input');
  setTimeout(() => { inp?.focus(); inp?.select?.(); }, 40);
  const submit = () => {
    const val = inp.value.trim();
    if (!val) return;
    closeAppModal();
    onSubmit?.(val);
  };
  document.getElementById('m-prm-ok').onclick = submit;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  document.getElementById('m-prm-cancel').onclick = () => closeAppModal();
}

export function showCopyModal(title, text) {
  openAppModal(`
    <div class="card-title">${esc(title)}</div>
    <p class="muted">Copy the link below to share with your group:</p>
    <input type="text" id="m-copy-inp" class="input mono" value="${esc(text)}" readonly />
    <div class="row">
      <button class="btn btn-primary" id="m-copy-btn" style="flex:1">Select & Copy</button>
      <button class="btn btn-ghost" id="m-copy-close">Close</button>
    </div>
  `);
  const inp = document.getElementById('m-copy-inp');
  setTimeout(() => { inp?.focus(); inp?.select(); }, 40);
  document.getElementById('m-copy-btn').onclick = () => {
    inp.select();
    try { document.execCommand('copy'); } catch {}
    closeAppModal();
  };
  document.getElementById('m-copy-close').onclick = () => closeAppModal();
}

export function showEditTeamModal(team, canDelete, { onSave, onDelete }) {
  let pickedColor = team.color || TEAM_COLOR_SWATCHES[0];
  openAppModal(`
    <div class="card-title">Customize Team</div>
    <div class="field">
      <label>Team Name</label>
      <input type="text" id="m-tm-name" class="input" value="${esc(team.name)}" maxlength="28" />
    </div>
    <div class="field">
      <label>Team Color</label>
      <div class="swatch-grid" id="m-tm-swatches">
        ${TEAM_COLOR_SWATCHES.map(
          (c) => `<button type="button" class="swatch-btn ${c.toLowerCase() === pickedColor.toLowerCase() ? 'active' : ''}" data-swatch="${c}" style="background:${c}" title="${c}"></button>`
        ).join('')}
        <input type="color" id="m-tm-custom-color" value="${esc(pickedColor)}" title="Custom Color" style="width:30px;height:30px;border:none;background:none;cursor:pointer" />
      </div>
    </div>
    <div class="row">
      <button class="btn btn-primary" id="m-tm-save" style="flex:1">Save Team</button>
      ${canDelete ? `<button class="btn btn-danger" id="m-tm-del">Delete</button>` : ''}
      <button class="btn btn-ghost" id="m-tm-cancel">Cancel</button>
    </div>
  `);

  const customInp = document.getElementById('m-tm-custom-color');
  document.querySelectorAll('[data-swatch]').forEach((b) => {
    b.onclick = () => {
      pickedColor = b.dataset.swatch;
      customInp.value = pickedColor;
      document.querySelectorAll('[data-swatch]').forEach((x) => x.classList.toggle('active', x === b));
    };
  });
  customInp.oninput = (e) => {
    pickedColor = e.target.value;
    document.querySelectorAll('[data-swatch]').forEach((x) => x.classList.remove('active'));
  };

  document.getElementById('m-tm-save').onclick = () => {
    const name = document.getElementById('m-tm-name').value.trim();
    if (!name) return;
    closeAppModal();
    onSave?.({ name, color: pickedColor });
  };
  document.getElementById('m-tm-del')?.addEventListener('click', () => {
    closeAppModal();
    onDelete?.();
  });
  document.getElementById('m-tm-cancel').onclick = () => closeAppModal();
}
