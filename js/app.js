import * as L from './logic.js';
import { createStore, STARTER_CHORES } from './store.js';

// ---------- boot ----------
let storage;
try { storage = window.localStorage; storage.getItem('roomsync.probe'); } catch (e) {
  const m = new Map(); // storage blocked: keep working in memory (store will report save failures)
  storage = { getItem: (k) => m.get(k) ?? null, setItem: () => { throw new Error('Storage unavailable'); }, removeItem: (k) => m.delete(k) };
}
const store = createStore({ storage });
const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const modal = $('#modal');

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICONS = {
  home: '<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',
  chores: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
  money: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 15h2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  bell: '<path d="M6 17V11a6 6 0 1 1 12 0v6l2 2H4zM10 21h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
};
const ic = (n, size = 22) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const CAT_GLYPH = { away: '↗', quiet: '☾', guest: '☺', plans: '★' };
const name = (id) => store.nameOf(id);
const avatar = (id) => `<span class="avatar" aria-hidden="true">${esc(name(id)[0] || '?')}</span>`;
const who = (id) => (id === store.me() ? 'You' : name(id));
const money = L.fmtMoney;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const empty = (title, text) => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;

// ---------- routing ----------
function parseRoute() {
  const [path, qs = ''] = (location.hash.replace(/^#\/?/, '') || 'home').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}
const ui = { statsWeek: null, calWeek: null, handled: null };

// ---------- toasts ----------
function toast(msg, { action, onAction, error = false, ms = 7000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ''}`;
  const remove = () => el.remove();
  if (action) $('button', el).addEventListener('click', () => { onAction(); remove(); });
  $('#toasts').appendChild(el);
  setTimeout(remove, ms);
}
const afterDelete = () => {
  if (store.undoLabel) toast(store.undoLabel, { action: 'Undo', onAction: () => { store.undoLast(); toast('Restored.'); } });
};

// ---------- modal & forms ----------
const field = (nameAttr, label, inner, hint) => `<div class="field"><label for="f-${nameAttr}">${label}</label>${inner}${hint ? `<p class="hint" id="hint-${nameAttr}">${hint}</p>` : ''}<p class="field-error" id="err-${nameAttr}" hidden></p></div>`;
const input = (n, v = '', extra = '') => `<input id="f-${n}" name="${n}" value="${esc(v)}" ${extra}>`;
const select = (n, opts, sel, extra = '') => `<select id="f-${n}" name="${n}" ${extra}>${opts.map(([v, l]) => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
const memberOpts = () => store.state.members.map((m) => [m.id, m.id === store.me() ? `${m.name} (you)` : m.name]);
const checkGroup = (n, label, checked, errName) => `<fieldset id="grp-${n}"><legend>${label}</legend><div class="checks">${store.state.members.map((m) => `<label><input type="checkbox" name="${n}[]" value="${m.id}"${checked.includes(m.id) ? ' checked' : ''}>${esc(m.name)}</label>`).join('')}</div><p class="field-error" id="err-${errName || n}" hidden></p></fieldset>`;

let lastFocus = null;
function openModal({ title, body, submitLabel = 'Save', onSubmit, danger = false, extraActions = '', noForm = false }) {
  lastFocus = document.activeElement;
  const actions = `<div class="modal-actions">${extraActions}<button type="button" class="btn" data-action="close-modal">${onSubmit ? 'Cancel' : 'Close'}</button>${onSubmit ? `<button type="submit" class="btn ${danger ? 'danger' : 'primary'}">${esc(submitLabel)}</button>` : ''}</div>`;
  modal.innerHTML = `<form novalidate><h2 id="modal-title">${esc(title)}</h2><div class="form-alert" id="form-alert" role="alert" hidden></div>${body}${actions}</form>`;
  const form = $('form', modal);
  modal._submit = onSubmit;
  if (!modal.open) modal.showModal();
  const first = $('input:not([type=hidden]):not([type=checkbox]), select, textarea', form);
  if (first && !danger) first.focus();
  return form;
}
function closeModal() { if (modal.open) modal.close(); modal._submit = null; }
modal.addEventListener('close', () => { modal._submit = null; if (lastFocus && document.contains(lastFocus)) lastFocus.focus(); });
modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); }); // click on backdrop

function formData(form) {
  const out = {};
  for (const [k, v] of new FormData(form)) {
    if (k.endsWith('[]')) (out[k.slice(0, -2)] ||= []).push(v); else out[k] = v;
  }
  return out;
}
function showErrors(form, errors) {
  $$('.field-error', form).forEach((p) => { p.hidden = true; p.textContent = ''; });
  $$('[aria-invalid]', form).forEach((i) => { i.removeAttribute('aria-invalid'); });
  $('#form-alert', form).hidden = true;
  let firstEl = null;
  const general = [];
  for (const [k, msg] of Object.entries(errors)) {
    const p = $(`#err-${k}`, form);
    const ctl = $(`#f-${k}`, form) || $(`#grp-${k} input`, form) || $(`#grp-${k}`, form);
    if (!p) { general.push(msg); continue; }
    p.textContent = msg; p.hidden = false;
    if (ctl) { ctl.setAttribute('aria-invalid', 'true'); ctl.setAttribute('aria-describedby', `err-${k}`); }
    firstEl ||= ctl;
  }
  if (general.length) { const a = $('#form-alert', form); a.textContent = general.join(' '); a.hidden = false; }
  if (firstEl && firstEl.focus) firstEl.focus();
}
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

document.addEventListener('submit', (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.dataset.inline) return handleInlineForm(form);
  if (!modal._submit) return;
  const btn = $('button[type=submit]', form);
  if (btn.disabled) return; // double-submit guard
  btn.disabled = true;
  let res;
  try { res = modal._submit(formData(form), form); } catch (err) { console.error(err); res = { ok: false, errors: { _: 'Something went wrong saving that. Please try again.' } }; }
  if (res && res.ok === false) { btn.disabled = false; showErrors(form, res.errors || { _: res.error || 'Could not save.' }); return; }
  closeModal();
});

function confirmDialog({ title, message, confirmLabel = 'Delete', onConfirm }) {
  openModal({ title, danger: true, submitLabel: confirmLabel, body: `<p>${message}</p>`, onSubmit: () => { onConfirm(); return { ok: true }; } });
}

// ---------- shared views ----------
function groupPending(list) {
  const t = store.today(), weekEnd = L.addDays(L.startOfWeek(t), 6);
  const g = { 'Overdue': [], 'Today': [], 'Later this week': [], 'Next up': [] };
  for (const o of list) {
    if (o.due < t) g.Overdue.push(o); else if (o.due === t) g.Today.push(o); else if (o.due <= weekEnd) g['Later this week'].push(o); else g['Next up'].push(o);
  }
  return Object.entries(g).filter(([, v]) => v.length);
}
function rotationText(o) {
  const c = store.sel.chore(o);
  if (!c) return '';
  const parts = [];
  if (c.recurrence === 'weekly') parts.push('Repeats weekly');
  if (c.rotation.length) {
    const nextId = L.nextAssigneeId(c, o);
    parts.push(`Next: ${who(nextId)}`);
  }
  return parts.join(' · ');
}
function choreRow(o, { reassign = false, edit = true, showAssignee = true } = {}) {
  const t = store.today();
  const overdue = o.due < t;
  const c = store.sel.chore(o);
  const rot = rotationText(o);
  const sel = reassign ? `<label class="sr-only" for="re-${o.id}">Reassign “${esc(o.title)}”</label><select id="re-${o.id}" data-change="reassign" data-id="${o.id}">${store.state.members.map((m) => `<option value="${m.id}"${m.id === o.assigneeId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : '';
  return `<li class="row${overdue ? ' is-overdue' : ''}" id="occ-${o.id}">
    <button class="check" data-action="complete" data-id="${o.id}" aria-label="Mark “${esc(o.title)}” complete" title="Mark complete">${ic('check', 18)}</button>
    <div class="row-main">
      <div class="row-title">${esc(o.title)}</div>
      <div class="row-meta"><span class="due">${L.relativeDue(o.due, t)}</span>${showAssignee ? `<span>${avatar(o.assigneeId)}${esc(who(o.assigneeId))}</span>` : ''}${rot ? `<span>${esc(rot)}</span>` : ''}</div>
      ${o.notes ? `<div class="row-note">${esc(o.notes)}</div>` : ''}
      ${c && c.rotation.length ? `<div class="row-note">Rotation: ${c.rotation.map((id) => esc(name(id))).join(' → ')}</div>` : ''}
    </div>
    <div class="row-actions">${sel}${edit ? `<button class="btn small" data-action="edit-chore" data-id="${o.id}" aria-label="Edit ${esc(o.title)}">Edit</button>` : ''}</div>
  </li>`;
}
function doneRow(o) {
  const d = L.toDateStr(new Date(o.doneAt));
  const diff = L.diffDays(o.due, d);
  const next = o.nextOccId && store.state.occurrences.find((x) => x.id === o.nextOccId);
  const canUndo = !next || !next.doneAt;
  return `<li class="row" id="occ-${o.id}">
    <span class="check done" aria-hidden="true">${ic('check', 18)}</span>
    <div class="row-main">
      <div class="row-title">${esc(o.title)}</div>
      <div class="row-meta"><span>Completed by ${esc(who(o.doneBy))} · ${L.fmtStamp(o.doneAt)}</span>
        <span>${diff <= 0 ? '<span class="pill good">On time</span>' : `<span class="pill late">${plural(diff, 'day')} after due date</span>`}</span>
        <span>Was due ${L.fmtDay(o.due)}${o.assigneeId !== o.doneBy ? ` · assigned to ${esc(name(o.assigneeId))}` : ''}</span></div>
    </div>
    <div class="row-actions">${canUndo ? `<button class="btn small" data-action="undo-complete" data-id="${o.id}" aria-label="Undo completing ${esc(o.title)}">Undo</button>` : ''}</div>
  </li>`;
}
function eventChip(ev, tag = 'button') {
  return `<${tag} class="ev cat-${ev.category}" ${tag === 'button' ? `type="button" data-action="view-event" data-id="${ev.id}"` : ''}><span aria-hidden="true">${CAT_GLYPH[ev.category]} </span><strong>${esc(ev.title)}</strong><small>${L.CATEGORIES[ev.category].label} · ${esc(L.describeEventTime(ev))}</small></${tag}>`;
}
const eventRow = (ev) => `<li class="row" id="ev-${ev.id}">
  <div class="row-main"><button type="button" class="ev cat-${ev.category}" data-action="view-event" data-id="${ev.id}" style="margin:0"><span aria-hidden="true">${CAT_GLYPH[ev.category]} </span><strong>${esc(ev.title)}</strong><small>${L.CATEGORIES[ev.category].label} · ${esc(L.describeEventTime(ev))} · ${esc(who(ev.creatorId))}</small></button></div></li>`;
const shopRow = (i, { full = false } = {}) => `<li class="row" id="item-${i.id}"><div class="row-main"><div class="row-title">${esc(i.name)} <span class="muted">× ${esc(i.qty)}</span></div>
  <div class="row-meta">${i.buyerId ? `<span>${avatar(i.buyerId)}${esc(who(i.buyerId))} will buy</span>` : '<span>Nobody has claimed this yet</span>'}</div>${i.notes ? `<div class="row-note">${esc(i.notes)}</div>` : ''}</div>
  ${full ? `<div class="row-actions">
    ${!i.buyerId ? `<button class="btn small" data-action="claim" data-id="${i.id}" aria-label="Claim ${esc(i.name)}">Claim</button>` : i.buyerId === store.me() ? `<button class="btn small" data-action="unclaim" data-id="${i.id}" aria-label="Unclaim ${esc(i.name)}">Unclaim</button>` : ''}
    <button class="btn small primary" data-action="purchase" data-id="${i.id}" aria-label="Mark ${esc(i.name)} purchased">Mark purchased</button>
    <button class="btn small" data-action="edit-item" data-id="${i.id}" aria-label="Edit ${esc(i.name)}">Edit</button>
    <button class="btn small" data-action="delete-item" data-id="${i.id}" aria-label="Remove ${esc(i.name)}">Remove</button></div>` : ''}</li>`;

// ---------- pages ----------
function viewHome() {
  const s = store.state, t = store.today(), weekEnd = L.addDays(L.startOfWeek(t), 6);
  const mine = store.sel.mine().filter((o) => o.due >= t && o.due <= weekEnd);
  const today = mine.filter((o) => o.due === t), week = mine.filter((o) => o.due > t);
  const overdue = store.sel.overdue();
  const bal = store.sel.balances()[store.me()] || 0;
  const mySettle = store.sel.settlements().filter((x) => x.from === store.me() || x.to === store.me());
  const needed = store.sel.needed();
  const events = store.sel.upcomingEvents(14).slice(0, 4);
  const feed = s.activity.slice(0, 8);
  const sec = (label, list) => list.length ? `<div class="group-label">${label}</div><ul class="list">${list.map((o) => choreRow(o, { edit: false, showAssignee: false })).join('')}</ul>` : '';
  return `<div class="page-head"><div><h1>Hi, ${esc(name(store.me()))}</h1><p>Here’s what’s happening at ${esc(s.household.name)}.</p></div></div>
  <p class="muted" style="margin-top:-6px">Know what needs to happen, who’s responsible, and what’s already done.</p>
  <div class="quick" role="group" aria-label="Quick actions">
    <button class="btn primary" data-action="add-chore">+ Add chore</button><button class="btn primary" data-action="add-expense">+ Add expense</button>
    <button class="btn primary" data-action="add-item">+ Add shopping item</button><button class="btn primary" data-action="add-event">+ Add event</button></div>
  <div class="grid two">
    <section class="card" aria-labelledby="h-mine"><div class="card-head"><h2 id="h-mine">My chores</h2><a href="#/chores/mine">All my chores</a></div>
      ${mine.length ? sec('Due today', today) + sec('Later this week', week) : empty('Nothing due this week', 'You’re clear for now. Check the full list for what’s coming up.')}</section>
    <section class="card" aria-labelledby="h-over"><div class="card-head"><h2 id="h-over">Overdue household tasks</h2><a href="#/chores/all">All chores</a></div>
      ${overdue.length ? `<ul class="list">${overdue.map((o) => choreRow(o, { edit: false })).join('')}</ul>` : empty('Nothing overdue', 'Every open chore is on schedule.')}</section>
    <section class="card" aria-labelledby="h-bal"><div class="card-head"><h2 id="h-bal">My balance</h2><a href="#/money/expenses">Expenses</a></div>
      <div class="kpi ${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}">${bal > 0 ? `You’re owed ${money(bal)}` : bal < 0 ? `You owe ${money(-bal)}` : 'All settled up'}</div>
      ${mySettle.length ? `<ul class="list small muted" style="margin-top:8px">${mySettle.map((x) => `<li>${x.from === store.me() ? `You could pay ${esc(name(x.to))} ${money(x.cents)}` : `${esc(name(x.from))} could pay you ${money(x.cents)}`}</li>`).join('')}</ul>` : ''}
      <p class="hint">Based on recorded expenses and paybacks. RoomSync doesn’t move money.</p></section>
    <section class="card" aria-labelledby="h-shop"><div class="card-head"><h2 id="h-shop">Still needed</h2><a href="#/money/shopping">Shopping list</a></div>
      ${needed.length ? `<ul class="list">${needed.slice(0, 6).map((i) => shopRow(i)).join('')}</ul>${needed.length > 6 ? `<p class="small muted">+ ${needed.length - 6} more</p>` : ''}` : empty('Shopping list is empty', 'Add something the apartment is running low on.')}</section>
    <section class="card" aria-labelledby="h-ev"><div class="card-head"><h2 id="h-ev">Upcoming events</h2><a href="#/calendar">Calendar</a></div>
      ${events.length ? `<ul class="list">${events.map(eventRow).join('')}</ul>` : empty('No events coming up', 'Add quiet time, guests, or plans so everyone knows.')}</section>
    <section class="card" aria-labelledby="h-act"><div class="card-head"><h2 id="h-act">Recent activity</h2></div>
      ${feed.length ? `<ul class="list feed">${feed.map((a) => `<li><a href="${esc(a.link)}"><strong>${esc(who(a.actorId))}</strong> ${esc(a.verb)} ${esc(a.subject)}</a><time datetime="${a.ts}">${L.fmtStamp(a.ts)}</time></li>`).join('')}</ul>` : empty('No activity yet', 'Completed chores, purchases, and changes show up here.')}</section>
  </div>`;
}

function tabs(items, current) {
  return `<nav class="tabs" aria-label="Sections">${items.map(([href, label, key]) => `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

function viewChores(tab) {
  ui.statsWeek ||= L.startOfWeek(store.today());
  const stats = store.sel.weekStats(ui.statsWeek);
  const wkEnd = L.addDays(ui.statsWeek, 6);
  const statsCard = `<section class="card" aria-labelledby="h-stats" style="margin-bottom:16px"><div class="card-head"><h2 id="h-stats">Chores due ${L.fmtMonthDay(ui.statsWeek)} – ${L.fmtMonthDay(wkEnd)}</h2>
    <div class="weeknav"><button class="btn small" data-action="stats-week" data-delta="-7" aria-label="Previous week">←</button><button class="btn small" data-action="stats-week" data-delta="0">This week</button><button class="btn small" data-action="stats-week" data-delta="7" aria-label="Next week">→</button></div></div>
    <table><thead><tr><th scope="col">Roommate</th><th scope="col" class="num">Completed</th><th scope="col" class="num">Still pending</th></tr></thead><tbody>
    ${stats.map((r) => `<tr><th scope="row" style="text-transform:none;letter-spacing:0;font-size:1rem;color:inherit">${avatar(r.id)}${esc(name(r.id))}${r.id === store.me() ? ' <span class="pill you">you</span>' : ''}</th><td class="num">${r.completed}</td><td class="num">${r.pending}</td></tr>`).join('')}</tbody></table>
    <p class="hint">These counts only show what’s recorded for the week. They aren’t a fairness score — schedules and availability differ.</p></section>`;
  let body;
  if (tab === 'done') {
    const list = store.sel.done();
    body = `<section class="card">${list.length ? `<ul class="list">${list.map(doneRow).join('')}</ul>` : empty('No completed chores yet', 'Tap the circle next to a chore when it’s done.')}</section>`;
  } else {
    const list = tab === 'mine' ? store.sel.mine() : store.sel.pending();
    const groups = groupPending(list);
    body = `<section class="card">${groups.length ? groups.map(([label, items]) => `<div class="group-label">${label}</div><ul class="list">${items.map((o) => choreRow(o, { reassign: tab === 'all', showAssignee: tab === 'all' })).join('')}</ul>`).join('') : empty(tab === 'mine' ? 'You have no open chores' : 'No open chores', 'Add a chore to get started.')}</section>`;
  }
  return `<div class="page-head"><div><h1>Chores</h1><p>Who’s responsible, and what’s already done.</p></div><button class="btn primary" data-action="add-chore">+ Add chore</button></div>
  ${tabs([['#/chores/mine', 'My chores', 'mine'], ['#/chores/all', 'All chores', 'all'], ['#/chores/done', 'Completed', 'done']], tab)}${statsCard}${body}`;
}

function viewMoney(tab) {
  const head = `<div class="page-head"><div><h1>Expenses &amp; shopping</h1><p>Shared costs and what the apartment still needs.</p></div></div>${tabs([['#/money/expenses', 'Expenses', 'expenses'], ['#/money/shopping', 'Shopping', 'shopping']], tab)}`;
  if (tab === 'shopping') {
    const needed = store.sel.needed(), bought = store.sel.purchased();
    return head + `<div class="stack"><section class="card" aria-labelledby="h-need"><div class="card-head"><h2 id="h-need">Needed (${needed.length})</h2><button class="btn primary small" data-action="add-item">+ Add item</button></div>
      ${needed.length ? `<ul class="list">${needed.map((i) => shopRow(i, { full: true })).join('')}</ul>` : empty('Nothing needed right now', 'Add an item when something runs low.')}</section>
    <section class="card" aria-labelledby="h-bought"><div class="card-head"><h2 id="h-bought">Purchased history</h2></div>
      ${bought.length ? `<ul class="list">${bought.map((i) => `<li class="row" id="item-${i.id}"><div class="row-main"><div class="row-title">${esc(i.name)} <span class="muted">× ${esc(i.qty)}</span></div><div class="row-meta"><span>Bought by ${esc(who(i.purchasedBy))} · ${L.fmtStamp(i.purchasedAt)}</span><span>${i.expenseId ? `<a href="#/money/expenses?id=${i.expenseId}">Linked expense</a>` : 'No expense recorded'}</span></div></div>
        <div class="row-actions">${i.expenseId ? '' : `<button class="btn small" data-action="reopen-item" data-id="${i.id}" aria-label="Move ${esc(i.name)} back to needed">Needed again</button>`}</div></li>`).join('')}</ul>` : empty('Nothing purchased yet', 'Purchased items are kept here.')}</section></div>`;
  }
  const s = store.state, bal = store.sel.balances(), settle = store.sel.settlements();
  const hist = [...s.expenses.map((e) => ({ k: 'e', d: e.date, c: e.createdAt, v: e })), ...s.reimbursements.map((r) => ({ k: 'r', d: r.date, c: r.createdAt, v: r }))].sort((a, b) => b.d.localeCompare(a.d) || b.c.localeCompare(a.c));
  const expRow = (e) => {
    const lines = e.participantIds.map((id) => id === e.payerId ? `${esc(name(id))}’s share: ${money(e.splits[id])} (paid the full ${money(e.amountCents)})` : `${esc(name(id))} owes ${esc(name(e.payerId))} ${money(e.splits[id])}`);
    if (!e.participantIds.includes(e.payerId)) lines.unshift(`${esc(name(e.payerId))} paid ${money(e.amountCents)} and isn’t part of the split`);
    return `<li class="row" id="exp-${e.id}"><div class="row-main"><div class="row-title">${esc(e.description)} · ${money(e.amountCents)}</div>
      <div class="row-meta"><span>Paid by ${esc(who(e.payerId))}</span><span>${L.fmtDay(e.date)}</span><span>Split ${plural(e.participantIds.length, 'way')} equally</span>${e.shoppingItemId ? '<span class="pill">From shopping list</span>' : ''}</div>
      <details><summary>Breakdown</summary><ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul></details></div>
      <div class="row-actions"><button class="btn small" data-action="edit-expense" data-id="${e.id}" aria-label="Edit ${esc(e.description)}">Edit</button><button class="btn small" data-action="delete-expense" data-id="${e.id}" aria-label="Delete ${esc(e.description)}">Delete</button></div></li>`;
  };
  const reRow = (r) => `<li class="row"><div class="row-main"><div class="row-title">${esc(name(r.fromId))} paid back ${esc(name(r.toId))} ${money(r.amountCents)}</div><div class="row-meta"><span>${L.fmtDay(r.date)}</span><span>Recorded outside RoomSync</span>${r.note ? `<span>${esc(r.note)}</span>` : ''}</div></div>
    <div class="row-actions"><button class="btn small" data-action="delete-reimb" data-id="${r.id}" aria-label="Delete recorded payback">Delete</button></div></li>`;
  return head + `<div class="stack">
    <div class="grid two">
      <section class="card" aria-labelledby="h-tot"><h2 id="h-tot">Recorded spending · ${L.fmtMonth(store.today())}</h2><div class="kpi">${money(store.sel.monthTotal())}</div><p class="hint">Total of expenses dated this month. Paybacks aren’t counted as spending.</p></section>
      <section class="card" aria-labelledby="h-bal2"><h2 id="h-bal2">Balances</h2>
        <table><thead><tr><th scope="col">Roommate</th><th scope="col" class="num">Net</th></tr></thead><tbody>${s.members.map((m) => `<tr><th scope="row" style="text-transform:none;letter-spacing:0;font-size:1rem;color:inherit">${avatar(m.id)}${esc(m.name)}</th><td class="num ${bal[m.id] > 0 ? 'pos' : bal[m.id] < 0 ? 'neg' : ''}">${bal[m.id] > 0 ? `is owed ${money(bal[m.id])}` : bal[m.id] < 0 ? `owes ${money(-bal[m.id])}` : 'settled'}</td></tr>`).join('')}</tbody></table></section></div>
    <section class="card" aria-labelledby="h-set"><div class="card-head"><h2 id="h-set">Settle up</h2><div class="row-actions"><button class="btn primary small" data-action="add-expense">+ Add expense</button><button class="btn small" data-action="add-reimb">Record a payback</button></div></div>
      <p class="notice">Recording a payback only updates RoomSync’s ledger — it does not transfer money. Pay each other outside the app, then record it here.</p>
      ${settle.length ? `<ul class="list" style="margin-top:8px">${settle.map((x) => `<li class="row"><div class="row-main">${esc(name(x.from))} could pay ${esc(name(x.to))} <strong>${money(x.cents)}</strong> to settle up</div><div class="row-actions"><button class="btn small" data-action="add-reimb" data-from="${x.from}" data-to="${x.to}" data-cents="${x.cents}">Record this payback</button></div></li>`).join('')}</ul>` : `<p class="muted">Everyone’s even. Nothing to settle.</p>`}</section>
    <section class="card" aria-labelledby="h-hist"><div class="card-head"><h2 id="h-hist">Expenses &amp; paybacks</h2></div>
      ${hist.length ? `<ul class="list">${hist.map((h) => (h.k === 'e' ? expRow(h.v) : reRow(h.v))).join('')}</ul>` : empty('No expenses yet', 'Add the first shared expense, like rent utilities or groceries.')}</section></div>`;
}

function viewCalendar() {
  ui.calWeek ||= L.startOfWeek(store.today());
  const t = store.today();
  const days = Array.from({ length: 7 }, (_, i) => L.addDays(ui.calWeek, i));
  const dayCard = (d) => {
    const evs = store.sel.eventsOn(d), occs = store.sel.occsOn(d);
    return `<section class="day${d === t ? ' today' : ''}" aria-label="${L.fmtDay(d)}"><h3><span>${L.fmtWeekday(d)}</span><span>${L.fmtMonthDay(d)}${d === t ? ' · today' : ''}</span></h3>
      ${evs.map((e) => eventChip(e)).join('')}
      ${occs.map((o) => `<a class="ev chore" href="#/chores/${o.doneAt ? 'done' : 'all'}?id=${o.id}"><span aria-hidden="true">${o.doneAt ? '✓' : '○'} </span><strong>${esc(o.title)}</strong><small>Chore · ${esc(who(o.assigneeId))}${o.doneAt ? ' · done' : ''}</small></a>`).join('')}
      ${!evs.length && !occs.length ? '<p class="small muted" style="margin:0">Nothing planned</p>' : ''}</section>`;
  };
  const up = store.sel.upcomingEvents(30);
  return `<div class="page-head"><div><h1>Calendar</h1><p>Away time, quiet hours, guests, and plans. Dated chores show up here too.</p></div><button class="btn primary" data-action="add-event">+ Add event</button></div>
  <div class="weeknav" style="margin-bottom:12px"><button class="btn small" data-action="cal-week" data-delta="-7" aria-label="Previous week">←</button><button class="btn small" data-action="cal-week" data-delta="0">This week</button><button class="btn small" data-action="cal-week" data-delta="7" aria-label="Next week">→</button><strong>${L.fmtMonthDay(days[0])} – ${L.fmtMonthDay(days[6])}</strong></div>
  <div class="legend" aria-label="Legend">${Object.entries(L.CATEGORIES).map(([k, v]) => `<span class="ev cat-${k}"><span aria-hidden="true">${CAT_GLYPH[k]} </span>${v.label}</span>`).join('')}<span class="ev chore">○ Chore</span></div>
  <div class="week">${days.map(dayCard).join('')}</div>
  <section class="card" style="margin-top:16px" aria-labelledby="h-up"><div class="card-head"><h2 id="h-up">Upcoming events (next 30 days)</h2></div>
    ${up.length ? `<ul class="list">${up.map(eventRow).join('')}</ul>` : empty('No upcoming events', 'Nothing on the calendar yet. Guest events are just a heads-up, with no approval needed.')}</section>`;
}

function viewNotifications() {
  const list = store.sel.notifications();
  const p = store.prefsOf(store.me());
  return `<div class="page-head"><div><h1>Notifications</h1><p>For ${esc(name(store.me()))}</p></div><button class="btn" data-action="read-all"${list.some((n) => !n.read) ? '' : ' disabled'}>Mark all as read</button></div>
  <div class="stack"><section class="card">${list.length ? `<ul class="list">${list.map((n) => `<li class="notif ${n.read ? 'read' : 'unread'}"><span class="dot" aria-hidden="true"></span>
    <a class="n-main" href="${esc(n.link)}" data-action="open-notif" data-id="${n.id}"><span class="sr-only">${n.read ? 'Read: ' : 'Unread: '}</span><div class="n-title">${esc(n.title)}</div><div class="small muted">${esc(n.body)}</div><div class="small muted">${L.fmtStamp(n.createdAt)}</div></a>
    <button class="btn small ghost" data-action="toggle-read" data-id="${n.id}">${n.read ? 'Mark unread' : 'Mark read'}</button></li>`).join('')}</ul>` : empty('You’re all caught up', 'Assignments, due-date reminders, new expenses, and calendar changes show up here.')}</section>
  <section class="card" aria-labelledby="h-pref"><h2 id="h-pref">Reminder preferences for ${esc(name(store.me()))}</h2>
    <form data-inline="prefs" style="margin-top:10px"><label class="inline-check"><input type="checkbox" name="reminders" ${p.reminders ? 'checked' : ''} data-change="pref"> Remind me about chores that are due soon or overdue</label>
    <div class="field" style="max-width:320px"><label for="f-leadDays">Remind me</label><select id="f-leadDays" name="leadDays" data-change="pref">${[[0, 'On the day it’s due'], [1, '1 day before'], [2, '2 days before']].map(([v, l]) => `<option value="${v}"${p.leadDays === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
    <label class="inline-check"><input type="checkbox" name="updates" ${p.updates ? 'checked' : ''} data-change="pref"> Tell me about new assignments, shared expenses, and calendar changes</label></form>
    <p class="notice">These are in-app reminders only. They’re checked while RoomSync is open in this browser. Background push notifications aren’t implemented, and nothing is sent to your phone or email.</p></section></div>`;
}

function viewSettings() {
  const s = store.state;
  return `<div class="page-head"><div><h1>Household &amp; settings</h1></div></div><div class="stack">
  <section class="card"><h2>${esc(s.household.name)}</h2><p class="muted">${s.mode === 'demo' ? 'Demo household with fictional roommates.' : 'Your household.'} Members: ${s.members.map((m) => esc(m.name)).join(', ')}.</p>
    <p class="notice">Data is saved only in this browser on this device. It doesn’t sync, and there are no accounts or invite codes yet. To try “another roommate’s view,” use the Viewing as switcher in the header.</p></section>
  <section class="card"><h2>User-testing events</h2><p class="muted">RoomSync logs basic events locally (household created, chore assigned/completed with on-time info, expense created, purchases, calendar events). Nothing is sent anywhere. Export them to share with your research team.</p>
    <p class="small muted">${s.analytics.length} events recorded on this device.</p><button class="btn" data-action="export">Download events (JSON)</button></section>
  <section class="card"><h2>Start over</h2><p class="muted">Deletes this household’s data from this browser and returns to the welcome screen.</p>
    <button class="btn danger" data-action="reset">${s.mode === 'demo' ? 'Reset demo' : 'Delete all data'}</button></section></div>`;
}

// ---------- onboarding ----------
function viewWelcome() {
  return `<main id="main" class="welcome" tabindex="-1"><h1>RoomSync</h1>
  <p class="lead">Know what needs to happen, who’s responsible, and what’s already done—without chasing your roommates.</p>
  <div class="stack">
  <section class="card"><h2>Try the demo household</h2><p class="muted">Four fictional roommates with sample chores, expenses, and plans. Switch between roommates to see shared updates.</p><button class="btn primary" data-action="start-demo">Try demo household</button></section>
  <section class="card" aria-labelledby="h-create"><h2 id="h-create">Create your household</h2><p class="muted">Takes about a minute. Add everyone now — you can switch between roommates from the header.</p>
    <form data-inline="create" novalidate style="margin-top:12px"><div class="form-alert" id="form-alert" role="alert" hidden></div>
    ${field('userName', 'Your name', input('userName', '', 'autocomplete="given-name" maxlength="30"'))}
    ${field('householdName', 'Household name', input('householdName', '', 'maxlength="40" placeholder="e.g. Elm Street 3B"'))}
    <fieldset id="grp-others"><legend>Roommates (1–4 others)</legend><div class="members-inputs" id="others">${[1, 2].map((i) => `<input type="text" name="others[]" aria-label="Roommate ${i} name" maxlength="30" placeholder="Roommate ${i}">`).join('')}</div>
      <p class="field-error" id="err-others" hidden></p><button type="button" class="btn small" data-action="add-roommate" style="margin-top:8px">+ Add another roommate</button></fieldset>
    <fieldset><legend>Starter chores (optional)</legend><div class="checks">${STARTER_CHORES.map((c) => `<label><input type="checkbox" name="starter[]" value="${c.key}"> ${esc(c.title)}</label>`).join('')}</div><p class="hint">Weekly, rotating between everyone.</p></fieldset>
    <button type="submit" class="btn primary">Create household</button></form></section>
  <section class="card"><h2>Join with an invite code</h2><p class="muted">Not available yet. Joining from another phone or laptop needs accounts and a server, which this prototype doesn’t have. Everything is stored in this browser only.</p></section></div></main>`;
}
function handleInlineForm(form) {
  if (form.dataset.inline === 'create') {
    const d = formData(form);
    const res = store.createHousehold({ userName: d.userName, householdName: d.householdName, others: d.others || [], starter: d.starter || [] });
    if (!res.ok) return showErrors(form, res.errors);
    location.hash = '#/home';
    toast(`Welcome to ${store.state.household.name}!`);
  }
}

// ---------- forms ----------
const today = () => store.today();
function openChoreForm(occ) {
  const c = occ && store.sel.chore(occ);
  const rotating = !!(c && c.rotation.length);
  const form = openModal({
    title: occ ? 'Edit chore' : 'Add chore', submitLabel: occ ? 'Save changes' : 'Add chore',
    body: `${field('title', 'Chore', input('title', occ ? occ.title : '', 'maxlength="80" required aria-required="true"'))}
      ${field('notes', 'Notes (optional)', `<textarea id="f-notes" name="notes" maxlength="300">${esc(occ ? occ.notes : '')}</textarea>`)}
      <div class="row2">${field('assigneeId', 'Assigned to', select('assigneeId', memberOpts(), occ ? occ.assigneeId : store.me()))}
      ${field('due', 'Due date', input('due', occ ? occ.due : today(), 'type="date" required'))}</div>
      ${field('recurrence', 'Repeats', select('recurrence', [['once', 'One time'], ['weekly', 'Every week']], c ? c.recurrence : 'once', 'data-change="chore-form"'))}
      <div id="rotate-wrap" hidden><label class="inline-check"><input type="checkbox" name="rotate" data-change="chore-form" ${rotating ? 'checked' : ''}> Rotate between roommates (round-robin)</label>
      <div id="rotation-wrap" hidden>${checkGroup('rotation', 'Who’s in the rotation?', rotating ? c.rotation : store.memberIds())}<p class="hint">Rotation order follows the household member order. You can still reassign any single week.</p></div></div>`,
    onSubmit: (d) => {
      const data = { title: d.title, notes: d.notes, assigneeId: d.assigneeId, due: d.due, recurrence: d.recurrence, rotate: d.recurrence === 'weekly' && 'rotate' in d, rotation: d.rotation || [] };
      const res = occ ? store.editChore(occ.id, data) : store.addChore(data);
      if (res.ok) toast(occ ? 'Chore updated.' : `Added “${data.title.trim()}”.`);
      return res;
    },
  });
  syncChoreForm(form);
}
function syncChoreForm(form) {
  const weekly = form.elements.recurrence.value === 'weekly';
  $('#rotate-wrap', form).hidden = !weekly;
  $('#rotation-wrap', form).hidden = !(weekly && form.elements.rotate.checked);
}
function openExpenseForm(exp, preset = {}) {
  const e = exp || {};
  const item = preset.item;
  const amt = e.amountCents ? (e.amountCents / 100).toFixed(2) : '';
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const purchase = !!item;
  const form = openModal({
    title: purchase ? `Mark “${item.name}” purchased` : exp ? 'Edit expense' : 'Add expense',
    submitLabel: purchase ? 'Save purchase & expense' : exp ? 'Save changes' : 'Add expense',
    extraActions: purchase ? '<button type="button" class="btn" data-action="purchase-only">Mark purchased, no expense</button>' : '',
    body: `${purchase ? '<p class="muted">Enter what you actually paid and who’s sharing it, and RoomSync will add the expense for you.</p>' : ''}<input type="hidden" name="token" value="${token}">
      ${field('description', 'What was it for?', input('description', e.description || (purchase ? item.name : ''), 'maxlength="80" required'))}
      <div class="row2">${field('amount', 'Amount (USD)', input('amount', amt, 'inputmode="decimal" placeholder="0.00" autocomplete="off" data-preview required'))}
      ${field('date', 'Date', input('date', e.date || today(), 'type="date" required'))}</div>
      ${field('payerId', 'Paid by', select('payerId', memberOpts(), e.payerId || (item && item.buyerId) || store.me()))}
      ${checkGroup('participantIds', 'Split equally between', e.participantIds || store.memberIds())}
      <div class="split-preview" id="split-preview" aria-live="polite"></div><p class="hint">Any leftover cent goes to the earliest roommate in the household order, so totals always add up exactly.</p>`,
    onSubmit: (d) => {
      const data = { description: d.description, amount: d.amount, date: d.date, payerId: d.payerId, participantIds: d.participantIds || [], token: d.token };
      let res;
      if (purchase) res = store.purchaseItem(item.id, { expense: data });
      else res = exp ? store.editExpense(exp.id, data) : store.addExpense(data);
      if (res.ok) toast(purchase ? `Purchased “${item.name}” and recorded the expense.` : exp ? 'Expense updated.' : 'Expense added.');
      return res;
    },
  });
  form._item = item;
  updateSplitPreview(form);
}
function updateSplitPreview(form) {
  const p = $('#split-preview', form); if (!p) return;
  const cents = L.parseMoney(form.elements.amount.value);
  const ids = store.memberIds().filter((id) => $$('input[name="participantIds[]"]:checked', form).some((c) => c.value === id));
  if (!cents || !ids.length) { p.textContent = 'Enter an amount and pick who’s sharing to see the split.'; return; }
  const sp = L.splitEqual(cents, ids);
  p.textContent = `Split ${plural(ids.length, 'way')}: ${ids.map((id) => `${name(id)} ${money(sp[id])}`).join(' · ')}`;
}
function openReimbForm(preset = {}) {
  const fromId = preset.from || store.me(), others = store.memberIds().filter((id) => id !== fromId);
  openModal({
    title: 'Record a payback', submitLabel: 'Record payback',
    body: `<p class="notice">This only records a payment you made outside RoomSync. It does not transfer money.</p><input type="hidden" name="token" value="${Date.now()}-${Math.random().toString(36).slice(2)}">
      <div class="row2" style="margin-top:12px">${field('fromId', 'Who paid', select('fromId', memberOpts(), fromId))}${field('toId', 'Paid to', select('toId', memberOpts(), preset.to || others[0]))}</div>
      <div class="row2">${field('amount', 'Amount (USD)', input('amount', preset.cents ? (preset.cents / 100).toFixed(2) : '', 'inputmode="decimal" placeholder="0.00" autocomplete="off"'))}${field('date', 'Date', input('date', today(), 'type="date"'))}</div>
      ${field('note', 'Note (optional)', input('note', '', 'maxlength="80" placeholder="e.g. Venmo, cash"'))}`,
    onSubmit: (d) => { const res = store.addReimbursement(d); if (res.ok) toast('Payback recorded. No money was moved by RoomSync.'); return res; },
  });
}
function openItemForm(item) {
  openModal({
    title: item ? 'Edit item' : 'Add shopping item', submitLabel: item ? 'Save changes' : 'Add item',
    body: `${field('name', 'Item', input('name', item ? item.name : '', 'maxlength="60" required'))}
      <div class="row2">${field('qty', 'Quantity', input('qty', item ? item.qty : '1', 'maxlength="20"'))}${field('buyerId', 'Who’s buying? (optional)', select('buyerId', [['', 'Unassigned — anyone can claim'], ...memberOpts()], item ? item.buyerId || '' : ''))}</div>
      ${field('notes', 'Notes (optional)', input('notes', item ? item.notes : '', 'maxlength="200" placeholder="Brand, size, store…"'))}`,
    onSubmit: (d) => { const res = item ? store.editItem(item.id, d) : store.addItem(d); if (res.ok) toast(item ? 'Item updated.' : 'Added to the shopping list.'); return res; },
  });
}
function openEventForm(ev, preset = {}) {
  const sd = ev ? L.dtDate(ev.start) : preset.date || today();
  const start = ev ? L.dtTime(ev.start) : '19:00', end = ev ? L.dtTime(ev.end) : '21:00';
  openModal({
    title: ev ? 'Edit event' : 'Add event', submitLabel: ev ? 'Save changes' : 'Add event',
    body: `${field('title', 'Title', input('title', ev ? ev.title : '', 'maxlength="80" required placeholder="e.g. Quiet study time"'))}
      ${field('category', 'Type', select('category', Object.entries(L.CATEGORIES).map(([k, v]) => [k, v.hint]), ev ? ev.category : preset.category || 'quiet'))}
      <div class="row2">${field('startDate', 'Starts', input('startDate', sd, 'type="date" required'))}${field('startTime', 'Start time', input('startTime', start, 'type="time" required'))}</div>
      <div class="row2">${field('endDate', 'Ends', input('endDate', ev ? L.dtDate(ev.end) : sd, 'type="date" required'))}${field('endTime', 'End time', input('endTime', end, 'type="time" required'))}</div>
      <p class="field-error" id="err-start" hidden></p><p class="field-error" id="err-end" hidden></p>
      ${field('notes', 'Notes (optional)', `<textarea id="f-notes" name="notes" maxlength="300">${esc(ev ? ev.notes : '')}</textarea>`)}`,
    onSubmit: (d) => { const res = ev ? store.editEvent(ev.id, d) : store.addEvent(d); if (res.ok) toast(ev ? 'Event updated. Roommates were notified in-app.' : 'Event added. Roommates were notified in-app.'); return res; },
  });
}
function viewEvent(id) {
  const ev = store.state.events.find((x) => x.id === id);
  if (!ev) return;
  const mine = ev.creatorId === store.me();
  openModal({
    title: ev.title,
    body: `<p><span class="ev cat-${ev.category}" style="display:inline-block;width:auto;cursor:default"><span aria-hidden="true">${CAT_GLYPH[ev.category]} </span>${L.CATEGORIES[ev.category].label}</span></p>
      <p><strong>${esc(L.describeEventTime(ev))}</strong><br><span class="muted">Added by ${esc(who(ev.creatorId))}</span></p>${ev.notes ? `<p>${esc(ev.notes)}</p>` : ''}
      ${ev.category === 'guest' ? '<p class="small muted">Guest events are a heads-up only. No approval needed.</p>' : ''}
      ${mine ? '' : `<p class="small muted">Only ${esc(name(ev.creatorId))} can edit or delete this event.</p>`}`,
    extraActions: mine ? `<button type="button" class="btn" data-action="edit-event" data-id="${ev.id}">Edit</button><button type="button" class="btn" data-action="delete-event" data-id="${ev.id}">Delete</button>` : '',
  });
}

// ---------- actions ----------
const byId = (list, id) => list.find((x) => x.id === id);
const actions = {
  'start-demo': () => { store.startDemo(); location.hash = '#/home'; toast('Demo household ready. You’re viewing as Maya.'); },
  'add-roommate': (d, el) => { const box = $('#others'); if (box.children.length >= 4) return toast('RoomSync supports up to 5 roommates.', { error: true }); const i = document.createElement('input'); i.type = 'text'; i.name = 'others[]'; i.maxLength = 30; i.placeholder = `Roommate ${box.children.length + 1}`; i.setAttribute('aria-label', `Roommate ${box.children.length + 1} name`); box.appendChild(i); i.focus(); if (box.children.length >= 4) el.disabled = true; },
  'close-modal': closeModal,
  'add-chore': () => openChoreForm(null),
  'edit-chore': (d) => openChoreForm(byId(store.state.occurrences, d.id)),
  complete: (d) => {
    const o = byId(store.state.occurrences, d.id); if (!o) return;
    if (store.completeChore(d.id).ok) toast(`Marked “${o.title}” complete.`, { action: 'Undo', onAction: () => { const r = store.undoComplete(d.id); toast(r.ok ? 'Back on the list.' : r.error, { error: !r.ok }); } });
  },
  'undo-complete': (d) => { const r = store.undoComplete(d.id); toast(r.ok ? 'Chore moved back to open.' : r.error, { error: !r.ok }); },
  'stats-week': (d) => { ui.statsWeek = Number(d.delta) === 0 ? L.startOfWeek(today()) : L.addDays(ui.statsWeek, Number(d.delta)); render(); },
  'cal-week': (d) => { ui.calWeek = Number(d.delta) === 0 ? L.startOfWeek(today()) : L.addDays(ui.calWeek, Number(d.delta)); render(); },
  'add-expense': () => openExpenseForm(null),
  'edit-expense': (d) => openExpenseForm(byId(store.state.expenses, d.id)),
  'delete-expense': (d) => { const e = byId(store.state.expenses, d.id); confirmDialog({ title: 'Delete this expense?', message: `“${esc(e.description)}” (${money(e.amountCents)}) will be removed and everyone’s balances will be recalculated.`, onConfirm: () => { store.deleteExpense(d.id); afterDelete(); } }); },
  'add-reimb': (d) => openReimbForm({ from: d.from, to: d.to, cents: d.cents ? Number(d.cents) : 0 }),
  'delete-reimb': (d) => confirmDialog({ title: 'Delete this recorded payback?', message: 'Balances will be recalculated. (No money moves either way — this only changes the record.)', onConfirm: () => { store.deleteReimbursement(d.id); afterDelete(); } }),
  'add-item': () => openItemForm(null),
  'edit-item': (d) => openItemForm(byId(store.state.shopping, d.id)),
  'delete-item': (d) => { const i = byId(store.state.shopping, d.id); confirmDialog({ title: 'Remove this item?', message: `Remove “${esc(i.name)}” from the shopping list?`, confirmLabel: 'Remove', onConfirm: () => { store.deleteItem(d.id); afterDelete(); } }); },
  claim: (d) => { const r = store.claimItem(d.id); toast(r.ok ? 'You’re buying this one.' : r.error || 'Could not claim.', { error: !r.ok }); },
  unclaim: (d) => { store.claimItem(d.id, false); },
  purchase: (d) => openExpenseForm(null, { item: byId(store.state.shopping, d.id) }),
  'purchase-only': () => { const form = $('form', modal); const item = form._item; if (!item) return; store.purchaseItem(item.id); closeModal(); toast(`Marked “${item.name}” purchased (no expense recorded).`); },
  'reopen-item': (d) => { store.reopenItem(d.id); },
  'add-event': () => openEventForm(null),
  'view-event': (d) => viewEvent(d.id),
  'edit-event': (d) => { closeModal(); openEventForm(byId(store.state.events, d.id)); },
  'delete-event': (d) => { const ev = byId(store.state.events, d.id); closeModal(); confirmDialog({ title: 'Delete this event?', message: `“${esc(ev.title)}” will be removed from the calendar and your roommates will be notified.`, onConfirm: () => { store.deleteEvent(d.id); afterDelete(); } }); },
  'open-notif': (d) => store.setRead(d.id, true),
  'toggle-read': (d) => { const n = byId(store.state.notifications, d.id); store.setRead(d.id, !n.read); },
  'read-all': () => store.markAllRead(),
  export: () => {
    const blob = new Blob([store.exportAnalytics()], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'roomsync-test-events.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  reset: () => confirmDialog({ title: 'Start over?', message: 'This permanently removes all RoomSync data from this browser.', confirmLabel: 'Delete everything', onConfirm: () => { store.reset(); location.hash = '#/home'; } }),
  'retry-load': () => { store.reset(); render(); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'A' && el.dataset.action !== 'open-notif') e.preventDefault();
  fn(el.dataset, el);
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.change === 'switch-user') { store.setCurrentUser(el.value); toast(`Now viewing as ${name(el.value)}.`); }
  else if (el.dataset.change === 'reassign') { const r = store.reassignChore(el.dataset.id, el.value); if (r.ok) toast(`Reassigned to ${name(el.value)}.`); }
  else if (el.dataset.change === 'chore-form') syncChoreForm(el.form);
  else if (el.dataset.change === 'pref') { const f = el.form; store.setPrefs({ reminders: f.elements.reminders.checked, leadDays: Number(f.elements.leadDays.value), updates: f.elements.updates.checked }); toast('Preferences saved.'); }
  else if (el.name === 'participantIds[]' && el.form) updateSplitPreview(el.form);
});
document.addEventListener('input', (e) => { if (e.target.hasAttribute && e.target.hasAttribute('data-preview')) updateSplitPreview(e.target.form); });

// ---------- shell & render ----------
const NAV = [['home', '#/home', 'Home', 'home'], ['chores', '#/chores/mine', 'Chores', 'chores'], ['money', '#/money/expenses', 'Expenses & Shopping', 'money'], ['calendar', '#/calendar', 'Calendar', 'calendar']];
function render() {
  const route = parseRoute();
  if (!store.state) { app.innerHTML = loadError ? viewLoadError() : viewWelcome(); return; }
  const [section, sub] = route.parts;
  let page;
  switch (section) {
    case 'chores': page = viewChores(['mine', 'all', 'done'].includes(sub) ? sub : 'mine'); break;
    case 'money': page = viewMoney(sub === 'shopping' ? 'shopping' : 'expenses'); break;
    case 'calendar': page = viewCalendar(); break;
    case 'notifications': page = viewNotifications(); break;
    case 'settings': page = viewSettings(); break;
    default: page = viewHome();
  }
  const key = section === 'notifications' || section === 'settings' ? '' : section || 'home';
  const unread = store.sel.unread();
  const navLinks = (cls) => NAV.map(([k, href, label, icon]) => `<a ${cls ? `class="${cls}"` : ''} href="${href}"${k === (key || 'home') && section !== 'notifications' && section !== 'settings' ? ' aria-current="page"' : ''}>${ic(icon)}<span>${label}</span></a>`).join('');
  const s = store.state;
  app.innerHTML = `<div class="shell">
    <aside class="sidebar"><a class="brand" href="#/home">${ic('home', 26)} RoomSync</a><nav aria-label="Primary">${navLinks('nav')}</nav><div class="side-foot">${esc(s.household.name)}<br>${s.mode === 'demo' ? 'Demo household' : 'Local household'}</div></aside>
    <div class="main-col">
      <header class="topbar"><a class="brand" href="#/home">${ic('home', 24)} RoomSync</a>
        <div class="switcher"><label for="switch-user">Viewing as</label><select id="switch-user" data-change="switch-user">${s.members.map((m) => `<option value="${m.id}"${m.id === s.currentUserId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        <a class="icon-link" href="#/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}"${section === 'notifications' ? ' aria-current="page"' : ''}>${ic('bell')}${unread ? `<span class="badge" aria-hidden="true">${unread > 9 ? '9+' : unread}</span>` : ''}</a>
        <a class="icon-link" href="#/settings" aria-label="Household and settings">${ic('gear')}</a></header>
      ${store.saveError ? '<div class="banner error" role="alert">Couldn’t save to this browser (storage may be full or blocked). Your latest changes will be lost if you close or refresh this page.</div>' : ''}
      <div class="banner" role="note"><strong>${s.mode === 'demo' ? 'Demo mode' : 'Local mode'}:</strong> data is saved only in this browser and does not sync between devices. Use “Viewing as” to preview each roommate’s view.</div>
      <main id="main" tabindex="-1">${page}</main></div>
    <nav class="bottomnav" aria-label="Primary">${navLinks('')}</nav></div>`;
  afterRender(route);
}
function viewLoadError() {
  return `<main id="main" class="welcome" tabindex="-1"><h1>We couldn’t read your saved data</h1><p class="lead">${esc(loadError)}</p><button class="btn danger" data-action="retry-load">Clear saved data and start fresh</button></main>`;
}
function afterRender(route) {
  const hash = location.hash;
  if (ui.handled === hash) return;
  ui.handled = hash;
  const id = route.query.id;
  if (!id) return;
  const el = document.getElementById(`occ-${id}`) || document.getElementById(`exp-${id}`) || document.getElementById(`ev-${id}`) || document.getElementById(`item-${id}`);
  if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); const d = $('details', el); if (d) d.open = true; }
  if (route.parts[0] === 'calendar' && store.state.events.some((x) => x.id === id)) viewEvent(id);
}
window.addEventListener('hashchange', () => { ui.handled = null; render(); const m = $('#main'); if (m && !parseRoute().query.id) { window.scrollTo(0, 0); } });

// ---------- start ----------
let loadError = null;
const res = store.load();
if (!res.ok) loadError = res.error;
store.subscribe(render);
window.addEventListener('storage', (e) => { if (e.key === 'roomsync.v1') { store.load(); render(); } });
setInterval(() => { if (store.state) store.runReminders(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && store.state) store.runReminders(); });
if (store.state) store.runReminders();
render();
window.__roomsync = store; // handy for debugging and automated checks
