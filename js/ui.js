// Store-independent UI primitives: escaping, icons, toasts, dialogs, menus, form helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// One icon family: 24px grid, 2px round stroke.
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>',
  chores: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  money: '<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h3"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  bell: '<path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z"/><path d="M10 21h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.1"/>',
  repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  away: '<path d="M3 11.5 21 3l-8.5 18-2-7.5z"/>',
  guest: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.5A6.5 6.5 0 0 1 21.5 20"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3.5h3l2.4 11.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.5L21 8H6.2"/>',
  edit: '<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  arrowL: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.1M3.5 12h.1M3.5 18h.1"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
};
export const ic = (n, size = 20) => `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[n] || ''}</svg>`;

// ---------- toasts ----------
export function toast(msg, { action, onAction, error = false, ms = 7000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  const remove = () => el.remove();
  if (action) $('button', el).addEventListener('click', () => { onAction(); remove(); });
  $('#toasts').appendChild(el);
  setTimeout(remove, ms);
}

// ---------- form fields ----------
export const field = (name, label, inner, { hint, optional } = {}) =>
  `<div class="field"><label for="f-${name}">${label}${optional ? ' <span class="opt">(optional)</span>' : ''}</label>${inner}${hint ? `<p class="hint" id="hint-${name}">${hint}</p>` : ''}<p class="field-error" id="err-${name}" hidden></p></div>`;
export const input = (n, v = '', extra = '') => `<input type="text" id="f-${n}" name="${n}" value="${esc(v)}" ${extra}>`;
export const select = (n, opts, sel, extra = '') =>
  `<select id="f-${n}" name="${n}" ${extra}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
export const segmented = (n, opts, sel, extra = '') =>
  `<div class="seg" role="radiogroup">${opts.map(([v, l]) => `<label><input type="radio" name="${n}" value="${esc(v)}"${v === sel ? ' checked' : ''} ${extra}><span>${esc(l)}</span></label>`).join('')}</div>`;
export const checkGroup = (n, label, members, checked) =>
  `<fieldset id="grp-${n}"><legend>${label}</legend><div class="checks">${members.map((m) => `<label><input type="checkbox" name="${n}[]" value="${m.id}"${checked.includes(m.id) ? ' checked' : ''}>${esc(m.name)}</label>`).join('')}</div><p class="field-error" id="err-${n}" hidden></p></fieldset>`;

export function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) {
    if (k.endsWith('[]')) (out[k.slice(0, -2)] ||= []).push(v); else out[k] = v;
  }
  return out;
}
export function showErrors(form, errors) {
  $$('.field-error', form).forEach((p) => { p.hidden = true; p.textContent = ''; });
  $$('[aria-invalid]', form).forEach((i) => i.removeAttribute('aria-invalid'));
  const alertBox = $('#form-alert', form);
  if (alertBox) alertBox.hidden = true;
  let firstEl = null;
  const general = [];
  for (const [k, msg] of Object.entries(errors)) {
    const p = $(`#err-${k}`, form);
    const ctl = $(`#f-${k}`, form) || $(`#grp-${k} input`, form);
    if (!p) { general.push(msg); continue; }
    p.innerHTML = `${ic('alert', 16)}<span>${esc(msg)}</span>`; p.hidden = false;
    if (ctl) { ctl.setAttribute('aria-invalid', 'true'); ctl.setAttribute('aria-describedby', `err-${k}`); }
    firstEl ||= ctl;
  }
  if (general.length && alertBox) { alertBox.textContent = general.join(' '); alertBox.hidden = false; if (!firstEl) alertBox.focus?.(); }
  if (firstEl && firstEl.focus) firstEl.focus();
}

// ---------- dialogs ----------
const modal = () => $('#modal');
let closedAt = 0;
let lastFocus = null;
export function openModal({ title, body, submitLabel = 'Save', onSubmit, danger = false, footerExtra = '' }) {
  const m = modal();
  if (!m.contains(document.activeElement)) lastFocus = document.activeElement; // keep the original opener when swapping dialogs
  m.innerHTML = `<form novalidate><div class="dlg-head"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-btn" data-action="close-modal" aria-label="Close dialog">${ic('x')}</button></div>
    <div class="dlg-body"><div class="form-alert" id="form-alert" role="alert" tabindex="-1" hidden></div>${body}</div>
    <div class="dlg-actions">${footerExtra}<button type="button" class="btn" data-action="close-modal">${onSubmit ? 'Cancel' : 'Close'}</button>${onSubmit ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}" data-submit>${esc(submitLabel)}</button>` : ''}</div></form>`;
  const form = $('form', m);
  m._submit = onSubmit;
  if (!m.open) m.showModal();
  m.scrollTop = 0;
  const first = $('.dlg-body input:not([type=hidden]):not([type=checkbox]):not([type=radio]), .dlg-body select, .dlg-body textarea', form);
  if (first && !danger) first.focus(); else (danger ? $('[data-submit]', form) : $('.icon-btn', form))?.focus();
  return form;
}
export function closeModal() { const m = modal(); if (m.open) { closedAt = Date.now(); m.close(); } m._submit = null; }
export function initModal() {
  const m = modal();
  // A fast double-click on "Save" would otherwise land its second click on whatever sits under the closed dialog.
  document.addEventListener('click', (e) => { if (e.detail >= 2 && Date.now() - closedAt < 600) { e.preventDefault(); e.stopPropagation(); } }, true);
  m.addEventListener('close', () => {
    closedAt = Date.now();
    if (m.open) return; // a new dialog was opened in the same tick (e.g. view → edit)
    m._submit = null;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  });
  m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
  m.addEventListener('submit', (e) => {
    e.preventDefault(); e.stopPropagation();
    const form = e.target;
    if (!m._submit) return;
    const btn = $('[data-submit]', form);
    if (btn.disabled) return; // double-submit guard
    btn.disabled = true;
    let res;
    try { res = m._submit(formData(form), form); } catch (err) { console.error(err); res = { ok: false, errors: { _: 'Something went wrong while saving. Please try again.' } }; }
    if (res && res.ok === false) { btn.disabled = false; showErrors(form, res.errors || { _: res.error || 'Could not save.' }); return; }
    closeModal();
  });
}
export function confirmDialog({ title, message, confirmLabel = 'Delete', onConfirm }) {
  openModal({ title, danger: true, submitLabel: confirmLabel, body: `<p>${message}</p>`, onSubmit: () => { onConfirm(); return { ok: true }; } });
}

// ---------- menus (kebab / add) ----------
export function menu({ id, label, items, icon = 'more', text = '', cls = 'icon-btn' }) {
  const body = items.map((it) => it === '-' ? '<div class="menu-sep" role="separator"></div>'
    : `<button type="button" role="menuitem" class="menu-item${it.danger ? ' danger' : ''}" data-action="${it.action}" ${Object.entries(it.data || {}).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ')}>${it.icon ? ic(it.icon, 18) : ''}<span>${esc(it.label)}</span></button>`).join('');
  return `<div class="menu"><button type="button" class="${cls}" aria-haspopup="menu" aria-expanded="false" aria-controls="menu-${id}" data-menu-toggle ${text ? '' : `aria-label="${esc(label)}"`}>${ic(icon, text ? 18 : 20)}${text ? `<span>${esc(text)}</span>` : ''}</button><div class="menu-pop" id="menu-${id}" role="menu" aria-label="${esc(label)}" hidden>${body}</div></div>`;
}
function closeMenus(except, restore = false) {
  $$('.menu-pop:not([hidden])').forEach((p) => {
    if (except && p === except) return;
    p.hidden = true;
    const t = p.previousElementSibling;
    t.setAttribute('aria-expanded', 'false');
    if (restore) t.focus();
  });
}
export function initMenus() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-menu-toggle]');
    if (t) {
      const pop = t.nextElementSibling;
      const open = pop.hidden;
      closeMenus(pop);
      pop.hidden = !open; t.setAttribute('aria-expanded', String(open));
      if (open) $('.menu-item', pop)?.focus();
      return;
    }
    if (e.target.closest('.menu-item')) { closeMenus(); return; }
    closeMenus();
    $$('details.status[open]').forEach((d) => { if (!d.contains(e.target)) d.open = false; });
  });
  document.addEventListener('keydown', (e) => {
    const pop = e.target.closest?.('.menu-pop');
    if (e.key === 'Escape') {
      if ($('.menu-pop:not([hidden])')) { closeMenus(null, true); e.stopPropagation(); }
      $$('details.status[open]').forEach((d) => { d.open = false; $('summary', d).focus(); });
      return;
    }
    if (pop && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = $$('.menu-item', pop), i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
    if (pop && e.key === 'Tab') closeMenus();
  });
}
