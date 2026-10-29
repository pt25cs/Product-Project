import * as L from './logic.js';
import { createStore, STARTER_CHORES } from './store.js';
import { $, $$, esc, plural, ic, toast, field, input, select, segmented, checkGroup, openModal, closeModal, initModal, confirmDialog, showErrors, formData, menu, initMenus } from './ui.js';
import { showCoachmark, endCoachmark, coachSeen, markCoachSeen, resetCoachmarks } from './tour.js';

// ---------- boot ----------
let storage;
try { storage = window.localStorage; storage.getItem('roomsync.probe'); } catch (e) {
  const m = new Map(); // storage blocked: keep working in memory (the store reports save failures)
  storage = { getItem: (k) => m.get(k) ?? null, setItem: () => { throw new Error('Storage unavailable'); }, removeItem: (k) => m.delete(k) };
}
const store = createStore({ storage });
const app = $('#app');

// Home dropdowns default: chores expanded (primary content), the rest collapsed to keep the home calm.
const ui = { statsWeek: null, calSel: null, calView: null, open: { chores: true }, welcome: null, handled: null, focusAfter: null };
let loadError = null;
const narrowMQ = window.matchMedia('(max-width: 859px)');
const narrow = () => narrowMQ.matches;

// ---------- small view helpers ----------
const name = (id) => store.nameOf(id);
const who = (id) => (id === store.me() ? 'You' : name(id));
const money = L.fmtMoney;
const today = () => store.today();
const avatar = (id) => `<span class="avatar" aria-hidden="true">${esc((name(id) || '?')[0])}</span>`;
const empty = (title, text, action = '') => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}${action}</div>`;
const sec = (id, title, body, { count, danger, icon, right = '' } = {}) => `<section class="sec" aria-labelledby="h-${id}"><div class="sec-head"><h2 id="h-${id}" class="${danger ? 'danger' : ''}">${icon ? ic(icon, 15) : ''}${esc(title)}${count != null ? `<span class="count">${count}</span>` : ''}</h2>${right}</div>${body}</section>`;
const addRow = (action, label, extra = '') => `<button type="button" class="add-row" data-action="${action}" ${extra}><span class="plus">${ic('plus', 18)}</span>${esc(label)}</button>`;
const disclosure = (key, title, body, { count, right = '' } = {}) => `<details class="disclosure sec" data-key="${key}"${ui.open[key] ? ' open' : ''}><summary><span class="disc-title">${title}${count != null ? `<span class="count">${count}</span>` : ''}</span><span class="disc-end">${right}<span class="chev">${ic('chevron', 18)}</span></span></summary><div class="disc-body">${body}</div></details>`;
function ago(iso) {
  const d = new Date(iso), mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${Math.floor(mins)} min ago`;
  const ds = L.toDateStr(d), t = L.toDateStr(new Date());
  if (ds === t) return `${Math.floor(mins / 60)} h ago`;
  if (L.diffDays(ds, t) === 1) return 'Yesterday';
  return L.fmtMonthDay(ds);
}
function dayBucket(iso) {
  const ds = L.toDateStr(new Date(iso)), diff = L.diffDays(ds, L.toDateStr(new Date()));
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier';
}
const CAT_ICON = { quiet: 'moon', away: 'away', guest: 'guest', plans: 'star' };
const catPill = (c) => `<span class="cat-pill cat-${c}">${ic(CAT_ICON[c], 14)}${esc(L.CATEGORIES[c].label)}</span>`;
function eventWhen(ev) {
  const t = today(), sd = L.dtDate(ev.start), ed = L.dtDate(ev.end);
  const dl = (d) => (d === t ? 'Today' : L.diffDays(t, d) === 1 ? 'Tomorrow' : L.fmtDay(d));
  if (sd !== ed) return `${dl(sd)} – ${dl(ed)}`;
  return `${dl(sd)} · ${L.fmtTime(L.dtTime(ev.start))}`;
}
const afterDelete = () => {
  if (store.undoLabel) toast(store.undoLabel, { action: 'Undo', onAction: () => { store.undoLast(); toast('Restored.'); } });
};
// Toast options that offer one-step undo for the just-resolved swap, when the store snapshotted one (2.11).
const afterSwap = () => (store.undoLabel ? { action: 'Undo', onAction: () => { store.undoLast(); toast('Swap undone.'); } } : {});
const memberOpts = () => store.state.members.map((m) => [m.id, m.id === store.me() ? `${m.name} (you)` : m.name]);

// ---------- routing ----------
function parseRoute() {
  const [path, qs = ''] = (location.hash.replace(/^#\/?/, '') || 'home').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}

// ---------- chore rows ----------
function dueMeta(o) {
  const d = L.diffDays(today(), o.due);
  if (d < 0) return `<span class="due overdue">${ic('alert', 13)}${plural(-d, 'day')} overdue</span>`;
  if (d === 0) return `<span class="due today">${ic('calendar', 13)}Today</span>`;
  if (d === 1) return `<span class="due">${ic('calendar', 13)}Tomorrow</span>`;
  return `<span class="due">${ic('calendar', 13)}${L.fmtDay(o.due)}</span>`;
}
// Swap options for an occurrence's "More actions" menu (Requirement 2): only for occurrences
// I currently own that are still open and not already tied to a pending swap.
function swapMenuItems(o) {
  if (o.assigneeId !== store.me() || o.doneAt) return [];
  const pending = store.state.swaps.some((s) => s.status === 'pending' && (s.occId === o.id || s.targetOccId === o.id));
  if (pending) return [];
  const items = [{ label: 'Ask someone to take this', icon: 'user', action: 'request-open-swap', data: { id: o.id } }];
  // A direct trade needs at least one open occurrence owned by another roommate to offer against.
  if (otherOpenOccs(o.id).length) items.push({ label: 'Offer a trade…', icon: 'repeat', action: 'offer-trade', data: { id: o.id } });
  return ['-', ...items];
}
// Open occurrences assigned to roommates other than me, excluding one occurrence id (my own).
function otherOpenOccs(exceptId) {
  const me = store.me();
  return store.state.occurrences.filter((x) => !x.doneAt && x.id !== exceptId && x.assigneeId !== me && store.state.members.some((m) => m.id === x.assigneeId));
}
function choreRow(o, { ctx = 'x', details = false, owner = false } = {}) {
  const mine = o.assigneeId === store.me();
  const c = store.sel.chore(o);
  const lead = mine
    ? `<button type="button" class="chk" role="checkbox" aria-checked="false" data-action="complete" data-id="${o.id}" aria-label="Complete: ${esc(o.title)}"><span class="box">${ic('check', 14)}</span></button>`
    : avatar(o.assigneeId);
  const items = [{ label: 'Edit chore', icon: 'edit', action: 'edit-chore', data: { id: o.id } }];
  if (!mine) items.push({ label: 'Mark done (I did it)', icon: 'check', action: 'complete', data: { id: o.id } }, { label: 'Reassign to me', icon: 'user', action: 'reassign-me', data: { id: o.id } });
  items.push(...swapMenuItems(o));
  items.push('-', { label: 'Delete chore', icon: 'trash', action: 'delete-chore', data: { id: o.id }, danger: true });
  const next = details && c && c.rotation.length ? `<span>Next: ${esc(who(L.nextAssigneeId(c, o)))}</span>` : '';
  return `<li class="row" id="occ-${o.id}"><div class="row-lead">${lead}</div><div class="row-main"><div class="row-title"><button type="button" class="title-btn" data-action="view-chore" data-id="${o.id}">${esc(o.title)}</button></div>
    <div class="row-meta">${dueMeta(o)}${c && c.recurrence === 'weekly' ? `<span>${ic('repeat', 13)}Weekly</span>` : ''}${next}</div>${details && o.notes ? `<div class="row-note">${esc(o.notes)}</div>` : ''}</div>
    <div class="row-side">${owner || !mine ? `<span class="owner">${avatar(o.assigneeId)}${esc(who(o.assigneeId))}</span>` : ''}${menu({ id: `${ctx}-${o.id}`, label: `More actions for ${o.title}`, items })}</div></li>`;
}
function doneRow(o) {
  const d = L.toDateStr(new Date(o.doneAt)), late = L.diffDays(o.due, d);
  const next = o.nextOccId && store.state.occurrences.find((x) => x.id === o.nextOccId);
  const canUndo = !next || !next.doneAt;
  return `<li class="row" id="occ-${o.id}"><div class="row-lead"><span class="box done" aria-hidden="true">${ic('check', 14)}</span></div>
    <div class="row-main"><div class="row-title done">${esc(o.title)}</div>
    <div class="row-meta"><span>${esc(who(o.doneBy))} · ${L.fmtStamp(o.doneAt)}</span>${late <= 0 ? `<span class="chip success">${ic('check', 12)}On time</span>` : `<span class="chip warning">${plural(late, 'day')} late</span>`}${o.assigneeId !== o.doneBy ? `<span>Assigned to ${esc(name(o.assigneeId))}</span>` : ''}</div></div>
    <div class="row-side">${canUndo ? `<button type="button" class="btn quiet sm" data-action="undo-complete" data-id="${o.id}" aria-label="Undo completing ${esc(o.title)}">${ic('undo', 16)}Undo</button>` : ''}</div></li>`;
}
function groupPending(list) {
  const t = today(), weekEnd = L.addDays(L.startOfWeek(t), 6);
  const g = [['Overdue', []], ['Today', []], ['Later this week', []], ['Next week and beyond', []]];
  for (const o of list) g[o.due < t ? 0 : o.due === t ? 1 : o.due <= weekEnd ? 2 : 3][1].push(o);
  return g.filter(([, v]) => v.length);
}
const choreSections = (groups, o) => groups.map(([label, items]) => sec(`g-${label.replace(/\W/g, '')}`, label, `<ul class="list">${items.map((x) => choreRow(x, o)).join('')}</ul>`, { count: items.length, danger: label === 'Overdue', icon: label === 'Overdue' ? 'alert' : null })).join('');

// ---------- shared pieces ----------
function balanceBlock({ full = false } = {}) {
  const me = store.me(), bal = store.sel.balances()[me] || 0;
  const mine = store.sel.settlements().filter((x) => x.from === me || x.to === me);
  const head = bal === 0 ? `<p class="balance-line settled">${ic('check', 20)}You’re settled up</p>` : bal < 0 ? `<p class="balance-line">You owe ${money(-bal)}</p>` : `<p class="balance-line">You’re owed ${money(bal)}</p>`;
  const lines = mine.map((x) => x.from === me
    ? `<li><span>Pay ${esc(name(x.to))} <strong class="money">${money(x.cents)}</strong></span><button type="button" class="btn sm" data-action="add-reimb" data-from="${x.from}" data-to="${x.to}" data-cents="${x.cents}">Record repayment</button></li>`
    : `<li><span>${esc(name(x.from))} owes you <strong class="money">${money(x.cents)}</strong></span></li>`).join('');
  return `${head}${lines ? `<ul class="pay-list">${lines}</ul>` : ''}<p class="hint">${full ? 'Record a payment you made outside RoomSync. RoomSync doesn’t move money.' : 'Based on recorded expenses and repayments.'}</p>`;
}
function eventRow(ev) {
  return `<li class="row"><div class="row-lead"><span class="ag-ic cat-${ev.category}">${ic(CAT_ICON[ev.category], 14)}</span></div><div class="row-main"><div class="row-title"><button type="button" class="title-btn" data-action="view-event" data-id="${ev.id}">${esc(ev.title)}</button></div><div class="row-meta"><span>${esc(eventWhen(ev))}</span></div></div></li>`;
}
// Remaining-budget line shown near the monthly spending total (Requirement 4.4). Display only,
// never blocks. Shows nothing special when no budget is set, but always offers a way to set/change it.
function budgetLine() {
  const b = store.sel.budgetStatus();
  if (!b.set) return `<p class="small muted" style="margin-top:4px">No shared monthly budget set. <button type="button" class="btn quiet sm" data-action="set-budget">Set a budget</button></p>`;
  const status = b.over
    ? `<span class="chip warning">${ic('alert', 12)}Over by ${money(-b.remainingCents)}</span>`
    : `<span class="chip success">${ic('check', 12)}${money(b.remainingCents)} left</span>`;
  return `<p class="small" style="margin-top:6px">Shared budget ${money(b.budgetCents)} · ${status} <button type="button" class="btn quiet sm" data-action="set-budget" aria-label="Change shared budget">Change</button></p>`;
}
// Non-blocking purchasing-rule hint for the shopping flow (Requirement 4.3). Surfaces preferred
// products / store preferences / budget status as informational guidance only — never blocks.
function shoppingHint() {
  const p = store.state.purchasing || {};
  const pp = (p.preferredProducts || []).map((x) => x.text);
  const sp = (p.storePreferences || []).map((x) => x.text);
  const b = store.sel.budgetStatus();
  const bits = [];
  if (pp.length) bits.push(`Preferred: ${pp.slice(0, 3).map(esc).join(', ')}${pp.length > 3 ? ` +${pp.length - 3} more` : ''}`);
  if (sp.length) bits.push(`Stores: ${sp.slice(0, 3).map(esc).join(', ')}${sp.length > 3 ? ` +${sp.length - 3} more` : ''}`);
  if (b.set) bits.push(b.over ? `Over the shared budget by ${money(-b.remainingCents)}` : `${money(b.remainingCents)} left in the shared budget`);
  if (!bits.length) return '';
  return `<div class="panel-soft" style="margin-bottom:12px"><p class="small"><strong>${ic('info', 14)}Purchasing rules</strong> ${bits.join(' · ')}</p><p class="hint" style="margin-top:4px">Guidance only — RoomSync never blocks a purchase. Manage these in <a href="#/settings">Settings</a>.</p></div>`;
}
function shopRowCompact(i) {
  return `<li class="row"><div class="row-main"><div class="row-title">${esc(i.name)} <span class="muted" style="font-weight:400">× ${esc(i.qty)}</span></div><div class="row-meta"><span>${i.buyerId ? `${esc(who(i.buyerId))} claimed` : 'Unclaimed'}</span></div></div></li>`;
}

// ---------- Home ----------
const PREVIEW = 3; // practical preview length for the available layout (not a research-derived number)
const moreLink = (n, shown, href, label) => (n > shown ? `<a class="more-link" href="${href}">${label}</a>` : '');
const moreText = (n, shown, what) => (n > shown ? `<p class="small muted" style="padding-top:8px">+ ${n - shown} more ${what}</p>` : '');
function viewHome() {
  const s = store.state, t = today(), me = store.me();
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const mine = store.sel.mine();
  const overdueMine = mine.filter((o) => o.due < t), dueToday = mine.filter((o) => o.due === t);
  const upcomingAll = mine.filter((o) => o.due > t), upcoming = upcomingAll.slice(0, PREVIEW);
  const others = store.sel.overdue().filter((o) => o.assigneeId !== me);
  const needed = store.sel.needed();
  const events = store.sel.upcomingEvents(14);
  const feed = s.activity.slice(0, 5);
  const list = (arr) => `<ul class="list">${arr.map((o) => choreRow(o, { ctx: 'h' })).join('')}</ul>`;
  const todayBody = dueToday.length ? list(dueToday)
    : `<div class="empty"><strong>${ic('check', 16)} You’re all caught up today</strong>${upcomingAll.length ? `Next up: ${esc(upcomingAll[0].title)}, ${L.fmtDay(upcomingAll[0].due)}.` : 'Nothing is assigned to you right now.'}</div>`;
  // Chores preview, grouped into one collapsible dropdown (Your chores + upcoming) that links to the full Chores section.
  const choresBody = `${sec('today', 'Your chores', todayBody + addRow('add-chore', 'Add chore'), { count: dueToday.length || null })}
      ${upcomingAll.length ? sec('up', 'Your upcoming chores', list(upcoming) + moreLink(upcomingAll.length, upcoming.length, '#/chores/mine', 'See all your chores'), { count: upcomingAll.length }) : ''}`;
  const mainCol = `<div data-o="1">${overdueMine.length ? sec('over', 'Overdue', list(overdueMine), { count: overdueMine.length, danger: true, icon: 'alert' }) : ''}
      ${disclosure('chores', 'Chores', choresBody, { count: dueToday.length || null, right: '<a href="#/chores">Open chores</a>' })}</div>
    ${others.length ? `<div data-o="2">${sec('others', 'Past due in the household', `<ul class="list">${others.slice(0, PREVIEW).map((o) => choreRow(o, { ctx: 'o', owner: true })).join('')}</ul>${moreLink(others.length, PREVIEW, '#/chores/all', 'See all chores')}`, { count: others.length })}</div>` : ''}
    <div data-o="6">${disclosure('activity', 'Recent activity', feed.length ? `<ul class="feed">${feed.map((a) => `<li><a href="${esc(a.link)}"><strong>${esc(who(a.actorId))}</strong> ${esc(L.displayCopy(a.verb))} ${esc(L.displayCopy(a.subject))}</a><time datetime="${a.ts}">${ago(a.ts)}</time></li>`).join('')}</ul>` : empty('No activity yet', 'Completed chores, purchases and changes show up here.'))}</div>`;
  const sideCol = `<div data-o="3">${disclosure('expenses', 'Expenses', balanceBlock(), { right: '<a href="#/money/expenses">Open expenses</a>' })}</div>
    <div data-o="4">${disclosure('plans', 'Household plans', events.length ? `<ul class="list">${events.slice(0, PREVIEW).map(eventRow).join('')}</ul>${moreText(events.length, PREVIEW, 'in the next 14 days')}` : empty('Nothing planned', 'Add quiet time, guests or plans so everyone knows.', '<br><button type="button" class="btn sm" data-action="add-event">Add event</button>'), { count: events.length || null, right: '<a href="#/calendar">Calendar</a>' })}</div>
    <div data-o="5">${disclosure('shopping', 'Shopping list', needed.length ? `<ul class="list">${needed.slice(0, PREVIEW).map(shopRowCompact).join('')}</ul>${moreText(needed.length, PREVIEW, 'needed')}` : empty('Nothing needed', 'Add something when the apartment runs low.', '<br><button type="button" class="btn sm" data-action="add-item">Add item</button>'), { count: needed.length || null, right: '<a href="#/money/shopping">Open list</a>' })}</div>`;
  return `<div class="page-head"><div><h1>Today</h1><p class="sub">${greet}, ${esc(name(me))} · ${L.fmtDay(t)}</p></div></div><div class="dash"><div class="dash-col">${mainCol}</div><div class="dash-col">${sideCol}</div></div>`;
}

// ---------- Swap requests (Requirement 2 UI) ----------
const occTitle = (id) => { const o = store.state.occurrences.find((x) => x.id === id); return o ? o.title : 'a chore'; };
function swapRequestsSection() {
  const incoming = store.sel.incomingSwaps(), open = store.sel.openSwaps(), outgoing = store.sel.outgoingSwaps();
  if (!incoming.length && !open.length && !outgoing.length) return '';
  const row = (lead, main, buttons) => `<li class="row"><div class="row-lead">${lead}</div><div class="row-main"><div class="row-title">${main}</div></div><div class="row-side">${buttons}</div></li>`;
  const btn = (action, id, label, cls = 'quiet') => `<button type="button" class="btn ${cls} sm" data-action="${action}" data-id="${id}" aria-label="${esc(label)}">${label}</button>`;
  const lines = [];
  // Direct proposals addressed to me: accept (swap) or decline (2.6/2.7).
  for (const s of incoming) lines.push(row(avatar(s.requesterId),
    `${esc(store.nameOf(s.requesterId))} offers <strong>${esc(occTitle(s.occId))}</strong> for your <strong>${esc(occTitle(s.targetOccId))}</strong>`,
    `<button type="button" class="btn primary sm" data-action="respond-direct-swap" data-id="${s.id}" data-accept="1" aria-label="Accept trade">Accept</button><button type="button" class="btn quiet sm" data-action="respond-direct-swap" data-id="${s.id}" data-accept="0" aria-label="Decline trade">Decline</button>`));
  // Open requests posted to the household that I can take (2.2).
  for (const s of open) lines.push(row(avatar(s.requesterId),
    `${esc(store.nameOf(s.requesterId))} is asking someone to take <strong>${esc(occTitle(s.occId))}</strong>`,
    btn('accept-open-swap', s.id, 'Take it', 'primary')));
  // My own pending requests/proposals: cancel (2.4).
  for (const s of outgoing) lines.push(row(ic('repeatSm', 18),
    s.kind === 'open'
      ? `You asked someone to take <strong>${esc(occTitle(s.occId))}</strong>`
      : `You offered <strong>${esc(occTitle(s.occId))}</strong> to ${esc(store.nameOf(s.addresseeId))} for <strong>${esc(occTitle(s.targetOccId))}</strong>`,
    btn('cancel-swap', s.id, 'Cancel')));
  return sec('swaps', 'Swap requests', `<ul class="list">${lines.join('')}</ul>`, { count: lines.length, icon: 'repeat' });
}

// ---------- Chores ----------
function viewChores(tab) {
  ui.statsWeek ||= L.startOfWeek(today());
  const stats = store.sel.weekStats(ui.statsWeek), wkEnd = L.addDays(ui.statsWeek, 6);
  const statsBody = `<div class="cal-title" style="margin-bottom:8px"><button type="button" class="icon-btn sm" data-action="stats-week" data-delta="-7" aria-label="Previous week">${ic('chevL', 18)}</button><strong style="color:var(--color-text)">${L.fmtMonthDay(ui.statsWeek)} – ${L.fmtMonthDay(wkEnd)}</strong><button type="button" class="icon-btn sm" data-action="stats-week" data-delta="7" aria-label="Next week">${ic('chevR', 18)}</button><button type="button" class="btn quiet sm" data-action="stats-week" data-delta="0">This week</button></div>
    <table><caption class="sr-only">Chores due this week, by roommate</caption><thead><tr><th scope="col">Roommate</th><th scope="col" class="num">Completed</th><th scope="col" class="num">Still open</th></tr></thead><tbody>
    ${stats.map((r) => `<tr><th scope="row">${avatar(r.id)} ${esc(name(r.id))}${r.id === store.me() ? ' (you)' : ''}</th><td class="num">${r.completed}</td><td class="num">${r.pending}</td></tr>`).join('')}</tbody></table>
    <p class="hint">Counts show what’s recorded for chores due that week. They aren’t a fairness score: chores differ in effort and schedules differ.</p>`;
  let body;
  if (tab === 'done') {
    const list = store.sel.done();
    body = sec('done', 'Completed', list.length ? `<ul class="list">${list.map(doneRow).join('')}</ul>` : empty('Nothing completed yet', 'Check off a chore and it appears here with who did it and when.'), { count: list.length || null });
  } else {
    const groups = groupPending(tab === 'mine' ? store.sel.mine() : store.sel.pending());
    body = (groups.length ? choreSections(groups, { ctx: tab, details: true, owner: tab === 'all' }) : empty(tab === 'mine' ? 'You have no open chores' : 'No open chores', 'Add a chore to give the household something to track.')) + `<div class="sec">${addRow('add-chore', 'Add chore')}</div>`;
  }
  const tabs = [['mine', 'Mine'], ['all', 'All chores'], ['done', 'Completed']];
  return `<div class="page-head"><h1>Chores</h1></div>
  <nav class="tabs" aria-label="Chore views">${tabs.map(([k, l]) => `<a href="#/chores/${k}"${tab === k ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>${swapRequestsSection()}${body}${disclosure('stats', 'Weekly counts by roommate', statsBody)}`;
}

// ---------- Expenses & shopping ----------
function viewMoney(tab) {
  const tabsNav = `<nav class="tabs" aria-label="Expenses and shopping"><a href="#/money/expenses"${tab === 'expenses' ? ' aria-current="page"' : ''}>Expenses</a><a href="#/money/shopping"${tab === 'shopping' ? ' aria-current="page"' : ''}>Shopping${store.sel.needed().length ? `<span class="count" style="margin-left:6px">${store.sel.needed().length}<span class="sr-only"> needed</span></span>` : ''}</a></nav>`;
  if (tab === 'shopping') {
    const needed = store.sel.needed(), bought = store.sel.purchased();
    const row = (i) => {
      const mine = i.buyerId === store.me();
      const items = [];
      if (i.buyerId) items.push({ label: mine ? 'Release claim' : `Take over from ${name(i.buyerId)}`, icon: 'user', action: mine ? 'unclaim' : 'takeover', data: { id: i.id } });
      items.push({ label: 'Edit item', icon: 'edit', action: 'edit-item', data: { id: i.id } }, '-', { label: 'Remove item', icon: 'trash', action: 'delete-item', data: { id: i.id }, danger: true });
      return `<li class="row" id="item-${i.id}"><div class="row-lead"><button type="button" class="chk" role="checkbox" aria-checked="false" data-action="purchase" data-id="${i.id}" aria-label="Purchased: ${esc(i.name)}"><span class="box">${ic('check', 14)}</span></button></div>
        <div class="row-main"><div class="row-title"><button type="button" class="title-btn" data-action="edit-item" data-id="${i.id}">${esc(i.name)}</button> <span class="muted" style="font-weight:400">× ${esc(i.qty)}</span></div>
        <div class="row-meta">${i.buyerId ? `<span>${avatar(i.buyerId)}${mine ? 'You’re' : esc(name(i.buyerId)) + ' is'} getting this</span>` : '<span>Unclaimed</span>'}</div>${i.notes ? `<div class="row-note">${esc(i.notes)}</div>` : ''}</div>
        <div class="row-side">${i.buyerId ? '' : `<button type="button" class="btn quiet sm" data-action="claim" data-id="${i.id}" aria-label="Claim ${esc(i.name)}">Claim</button>`}${menu({ id: `s-${i.id}`, label: `More actions for ${i.name}`, items })}</div></li>`;
    };
    const histRow = (i) => `<li class="row" id="item-${i.id}"><div class="row-lead"><span class="box done" aria-hidden="true">${ic('check', 14)}</span></div><div class="row-main"><div class="row-title done">${esc(i.name)} <span style="font-weight:400">× ${esc(i.qty)}</span></div><div class="row-meta"><span>Purchased by ${esc(who(i.purchasedBy))} · ${L.fmtStamp(i.purchasedAt)}</span>${i.expenseId ? `<a href="#/money/expenses?id=${i.expenseId}">See expense</a>` : ''}</div></div>
      <div class="row-side"><button type="button" class="btn quiet sm" data-action="add-again" data-id="${i.id}" aria-label="Add ${esc(i.name)} again">Add again</button>${i.expenseId ? '' : `<button type="button" class="btn quiet sm" data-action="reopen-item" data-id="${i.id}" aria-label="Move ${esc(i.name)} back to needed">Undo</button>`}</div></li>`;
    return `<div class="page-head"><h1>Expenses &amp; shopping</h1></div>${tabsNav}
      <form data-inline="add-item" class="quick-add" novalidate><div class="grow"><label class="sr-only" for="qa-name">Add an item</label><input type="text" id="qa-name" name="name" placeholder="Add an item" maxlength="60" autocomplete="off"><p class="field-error" id="qa-err" role="alert" hidden></p></div>
        <div class="qty"><label class="sr-only" for="qa-qty">Quantity</label><input type="text" id="qa-qty" name="qty" placeholder="Qty" maxlength="20" autocomplete="off"></div><button type="submit" class="btn primary">Add</button></form>
      ${shoppingHint()}
      ${sec('need', 'Needed', needed.length ? `<ul class="list">${needed.map(row).join('')}</ul>` : empty('Nothing needed right now', 'Type above to add something the apartment is running low on.'), { count: needed.length })}
      ${disclosure('bought', `Purchased <span class="count">${bought.length}</span>`, bought.length ? `<ul class="list">${bought.map(histRow).join('')}</ul>` : empty('Nothing purchased yet', 'Purchased items are kept here so you can add them again.'))}`;
  }
  const s = store.state, me = store.me(), bal = store.sel.balances();
  const owesSomeone = store.sel.settlements().some((x) => x.from === me); // the balance panel already offers a prefilled repayment
  const hist = [...s.expenses.map((e) => ({ k: 'e', d: e.date, c: e.createdAt, v: e })), ...s.reimbursements.map((r) => ({ k: 'r', d: r.date, c: r.createdAt, v: r }))].sort((a, b) => b.d.localeCompare(a.d) || b.c.localeCompare(a.c));
  const expRow = (e) => {
    const share = e.splits[me];
    const lines = e.participantIds.map((id) => `<li>${esc(name(id))}: ${money(e.splits[id])}${id === e.payerId ? ' (paid)' : ''}</li>`).join('');
    const extra = `<li>Split ${e.participantIds.length} ${e.participantIds.length === 1 ? 'way' : 'ways'} equally</li>${e.shoppingItemId ? '<li>Recorded from a shopping list purchase</li>' : ''}`;
    return `<li class="row" id="exp-${e.id}"><div class="row-lead">${avatar(e.payerId)}</div><div class="row-main"><div class="row-title">${esc(e.description)}</div>
      <div class="row-meta"><span>${esc(who(e.payerId))} paid · ${L.fmtDay(e.date)}</span></div>
      <details class="inline" data-key="exp-${e.id}"${ui.open[`exp-${e.id}`] ? ' open' : ''}><summary>Details</summary><ul>${extra}${lines}</ul></details></div>
      <div class="row-side"><div class="amount">${money(e.amountCents)}<small>${share !== undefined ? `Your share ${money(share)}` : 'Not in split'}</small></div>${menu({ id: `e-${e.id}`, label: `More actions for ${e.description}`, items: [{ label: 'Edit expense', icon: 'edit', action: 'edit-expense', data: { id: e.id } }, '-', { label: 'Delete expense', icon: 'trash', action: 'delete-expense', data: { id: e.id }, danger: true }] })}</div></li>`;
  };
  const reRow = (r) => `<li class="row"><div class="row-lead">${ic('repeatSm', 18)}</div><div class="row-main"><div class="row-title">${esc(who(r.fromId))} repaid ${esc(name(r.toId))}</div><div class="row-meta"><span>${L.fmtDay(r.date)}</span><span>Paid outside RoomSync</span>${r.note ? `<span>${esc(r.note)}</span>` : ''}</div></div>
    <div class="row-side"><div class="amount">${money(r.amountCents)}</div>${menu({ id: `r-${r.id}`, label: 'More actions for repayment', items: [{ label: 'Delete repayment', icon: 'trash', action: 'delete-reimb', data: { id: r.id }, danger: true }] })}</div></li>`;
  const balances = `<table><caption class="sr-only">Net balance by roommate</caption><thead><tr><th scope="col">Roommate</th><th scope="col" class="num">Balance</th></tr></thead><tbody>${s.members.map((m) => `<tr><th scope="row">${avatar(m.id)} ${esc(m.name)}${m.id === me ? ' (you)' : ''}</th><td class="num">${bal[m.id] > 0 ? `Is owed ${money(bal[m.id])}` : bal[m.id] < 0 ? `Owes ${money(-bal[m.id])}` : 'Settled up'}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="page-head"><h1>Expenses &amp; shopping</h1></div>${tabsNav}
    <div class="sec"><div class="panel-soft"><h2 style="margin-bottom:8px">Your balance</h2>${balanceBlock({ full: true })}</div></div>
    ${sec('hist', 'Expenses and repayments', (hist.length ? `<ul class="list">${hist.map((h) => (h.k === 'e' ? expRow(h.v) : reRow(h.v))).join('')}</ul>` : empty('No expenses yet', 'Add the first shared expense, like utilities or groceries.')) + addRow('add-expense', 'Add expense') + (owesSomeone ? '' : addRow('add-reimb', 'Record repayment')))}
    ${sec('tot', `Household spending in ${L.fmtMonth(today()).split(' ')[0]}`, `<p class="balance-line money" style="padding-top:12px">${money(store.sel.monthTotal())}</p>${budgetLine()}<p class="hint">Expenses dated this month. Repayments aren’t counted as spending.</p>`)}
    ${disclosure('balances', 'Everyone’s balance', balances)}`;
}

// ---------- Calendar ----------
function rangeLabel(ev, day) {
  const sd = L.dtDate(ev.start), ed = L.dtDate(ev.end);
  if (sd === day && ed === day) return `<span>${L.fmtTime(L.dtTime(ev.start))}</span><br><span class="muted">${L.fmtTime(L.dtTime(ev.end))}</span>`;
  if (sd === day) return `From<br>${L.fmtTime(L.dtTime(ev.start))}`;
  if (ed === day) return `Until<br>${L.fmtTime(L.dtTime(ev.end))}`;
  return 'All day';
}
function viewCalendar() {
  const t = today();
  ui.calSel ||= t;
  const sel = ui.calSel, view = ui.calView || (narrow() ? 'agenda' : 'week');
  const ws = L.startOfWeek(sel), days = Array.from({ length: 7 }, (_, i) => L.addDays(ws, i));
  const meta = (d) => ({ evs: store.sel.eventsOn(d), occs: store.sel.occsOn(d) });
  const bar = `<div class="cal-bar"><div class="cal-title"><h2>${L.fmtMonth(sel)}</h2><button type="button" class="icon-btn sm" data-action="cal-shift" data-delta="-7" aria-label="Previous week">${ic('chevL', 18)}</button><button type="button" class="icon-btn sm" data-action="cal-shift" data-delta="7" aria-label="Next week">${ic('chevR', 18)}</button><button type="button" class="btn quiet sm" data-action="cal-today">Today</button></div>
    <div class="cal-tools"><div class="seg" role="group" aria-label="Calendar view"><label><input type="radio" name="calview" value="agenda" data-action="cal-view" data-view="agenda"${view === 'agenda' ? ' checked' : ''}><span>Agenda</span></label><label><input type="radio" name="calview" value="week" data-action="cal-view" data-view="week"${view === 'week' ? ' checked' : ''}><span>Week</span></label></div><button type="button" class="btn primary" data-action="add-event">${ic('plus', 18)}Add event</button></div></div>`;
  let body;
  if (view === 'agenda') {
    const strip = `<div class="date-strip" role="group" aria-label="Week of ${L.fmtMonthDay(ws)}">${days.map((d) => {
      const { evs, occs } = meta(d), n = evs.length + occs.length;
      const cats = [...new Set(evs.map((e) => e.category))].slice(0, 3);
      const dots = cats.map((c) => `<i class="${c}"></i>`).join('') + (occs.length && cats.length < 3 ? '<i class="chore"></i>' : '');
      return `<button type="button" class="ds-day${d === t ? ' is-today' : ''}" data-action="cal-pick" data-date="${d}" aria-pressed="${d === sel}"${d === t ? ' aria-current="date"' : ''} aria-label="${L.fmtFull(d)}${d === t ? ', today' : ''}${n ? `, ${plural(n, 'item')}` : ''}"><span class="wd" aria-hidden="true">${L.fmtWeekday(d)}</span><span class="dn" aria-hidden="true">${parseInt(d.slice(8), 10)}</span><span class="dots" aria-hidden="true">${dots}</span></button>`;
    }).join('')}</div>`;
    const list = [];
    for (let i = 0; i < 14; i++) {
      const d = L.addDays(sel, i), m = meta(d);
      if (i === 0 || m.evs.length || m.occs.length) list.push({ d, ...m });
    }
    const label = (d) => (d === t ? 'Today' : L.diffDays(t, d) === 1 ? 'Tomorrow' : L.fmtWeekdayLong(d));
    const any = list.some((x) => x.evs.length || x.occs.length);
    const rows = list.map(({ d, evs, occs }) => `<section class="agenda-day" aria-labelledby="ag-${d}"><h3 id="ag-${d}" class="${d === t ? 'today' : ''}">${label(d)} <span class="d">${L.fmtDay(d)}</span></h3>
      ${evs.map((e) => `<button type="button" class="ag-row" data-action="view-event" data-id="${e.id}"><span class="ag-time">${rangeLabel(e, d)}</span><span class="ag-ic cat-${e.category}">${ic(CAT_ICON[e.category], 15)}</span><span><span class="ag-title">${esc(e.title)}</span><span class="ag-sub" style="display:block">${esc(L.CATEGORIES[e.category].label)} · ${esc(who(e.creatorId))}</span></span></button>`).join('')}
      ${occs.map((o) => `<button type="button" class="ag-row" data-action="view-chore" data-id="${o.id}"><span class="ag-time">Chore</span><span class="ag-ic chore">${ic('chores', 15)}</span><span><span class="ag-title${o.doneAt ? ' done' : ''}">${esc(o.title)}</span><span class="ag-sub" style="display:block">${esc(who(o.assigneeId))}${o.doneAt ? ' · Done' : ''}</span></span></button>`).join('')}
      ${!evs.length && !occs.length ? '<p class="small muted" style="padding:12px 0">Nothing planned</p>' : ''}</section>`).join('');
    const anchor = `<div class="ag-anchor"><span>Next 14 days · From <strong>${L.fmtMonthDay(sel)}</strong>${sel === t ? ' (today)' : ''}</span>${sel !== t ? '<button type="button" class="btn quiet sm" data-action="cal-today">Back to today</button>' : ''}<details class="inline" data-key="aghelp"${ui.open.aghelp ? ' open' : ''}><summary>How this works</summary><p>The agenda starts on the day you pick in the strip above and lists the next 14 days. Days with nothing planned are skipped.</p></details></div>`;
    body = `${strip}${anchor}${any ? rows : rows + empty('Nothing on the calendar', 'Add quiet time, guests, an away day or a household plan.', '<br><button type="button" class="btn sm" data-action="add-event">Add event</button>')}`;
  } else {
    body = `<div class="week">${days.map((d) => {
      const { evs, occs } = meta(d), none = !evs.length && !occs.length;
      return `<section class="wk-day${d === t ? ' today' : ''}${d < t ? ' past' : ''}" aria-label="${L.fmtFull(d)}"><button type="button" class="wk-head" data-action="cal-open-day" data-date="${d}" aria-label="Open ${L.fmtFull(d)} in agenda"><span>${L.fmtWeekday(d)}</span><span class="dn">${parseInt(d.slice(8), 10)}</span></button>
        ${evs.map((e) => `<button type="button" class="wk-item cat-${e.category}" data-action="view-event" data-id="${e.id}" title="${esc(e.title)}"><span class="t">${ic(CAT_ICON[e.category], 12)}${L.fmtTime(L.dtTime(e.start))}</span><span class="n">${esc(e.title)}</span></button>`).join('')}
        ${occs.map((o) => `<button type="button" class="wk-item chore${o.doneAt ? ' is-done' : ''}" data-action="view-chore" data-id="${o.id}" title="${esc(o.title)}"><span class="t">${ic('chores', 12)}${esc(who(o.assigneeId))}</span><span class="n">${esc(o.title)}</span></button>`).join('')}
        ${none ? '<span class="wk-none">Nothing planned</span>' : ''}</section>`;
    }).join('')}</div>`;
  }
  return `<div class="page-head"><h1>Calendar</h1></div>${bar}${body}<div class="legend" aria-label="Legend">${Object.keys(L.CATEGORIES).map(catPill).join('')}<span class="cat-pill" style="background:var(--color-surface-subtle);color:var(--color-text-secondary)">${ic('chores', 14)}Chore</span></div>`;
}

// ---------- Profile (Requirement 5) ----------
// A dedicated #/profile route (not a Settings section) so Profile earns its own per-tab
// coachmark (6.1). The current roommate's fields are editable (5.1); other roommates' profiles
// are read-only (5.2). An interim banner makes clear this is local-only, no account/sync (5.5).
const profileField = (label, value) => `<div><dt>${esc(label)}</dt><dd>${value ? esc(value) : '<span class="muted">Not set yet</span>'}</dd></div>`;
function otherProfileCard(m) {
  const p = m.profile || {};
  return `<section class="sec" aria-labelledby="pf-${m.id}"><div class="sec-head"><h3 id="pf-${m.id}">${avatar(m.id)} ${esc(m.name)}</h3></div>
    <dl class="details">${profileField('Dietary', p.dietary)}${profileField('Personal budget', p.budgetCents != null ? money(p.budgetCents) : '')}${profileField('Personal rules', p.rules)}</dl></section>`;
}
function viewProfile() {
  const me = store.me(), m = store.state.members.find((x) => x.id === me) || {};
  const p = m.profile || { dietary: '', budgetCents: null, rules: '' };
  const budgetVal = p.budgetCents != null ? (p.budgetCents / 100).toFixed(2) : '';
  const others = store.state.members.filter((x) => x.id !== me);
  const banner = `<div class="panel-soft" style="margin-bottom:16px"><p class="small"><strong>${ic('info', 14)}Local only — no account or sync yet</strong></p><p class="hint" style="margin-top:4px">This interim profile is saved in this browser on this device. There are no accounts, no sync, and no privacy guarantee. Real synced profiles come later.</p></div>`;
  const form = `<form data-inline="profile" novalidate style="padding-top:12px">
    <div class="field"><label for="f-dietary">Dietary restrictions / preferences <span class="opt">(optional)</span></label><textarea id="f-dietary" name="dietary" class="qa-notes" maxlength="300" placeholder="e.g. Vegetarian, no nuts">${esc(p.dietary)}</textarea><p class="field-error" id="err-dietary" hidden></p></div>
    ${field('budgetCents', 'Personal monthly budget (USD)', input('budgetCents', budgetVal, 'inputmode="decimal" placeholder="0.00" autocomplete="off"'), { optional: true, hint: 'Just for you. RoomSync shows this as information only and never blocks spending.' })}
    <div class="field"><label for="f-rules">Personal roommate rules <span class="opt">(optional)</span></label><textarea id="f-rules" name="rules" class="qa-notes" maxlength="300" placeholder="e.g. Please knock before coming into my room">${esc(p.rules)}</textarea><p class="field-error" id="err-rules" hidden></p></div>
    <button type="submit" class="btn primary">Save profile</button></form>`;
  const mine = sec('me-profile', `Your profile`, form, { icon: 'user' });
  const othersBlock = others.length
    ? sec('others-profile', 'Other roommates', others.map(otherProfileCard).join(''))
    : '';
  return `<div class="page-head profile-head"><div><h1>Profile</h1><p class="sub">for ${esc(m.name || 'you')}</p></div></div>${banner}${mine}${othersBlock}`;
}

// ---------- Notifications ----------
function viewNotifications() {
  const list = store.sel.notifications();
  const groups = ['Today', 'Yesterday', 'Earlier'].map((g) => [g, list.filter((n) => dayBucket(n.createdAt) === g)]).filter(([, v]) => v.length);
  const row = (n) => `<li class="notif ${n.read ? 'read' : 'unread'}"><span class="ndot" aria-hidden="true"></span>
    <a class="n-main" href="${esc(n.link)}" data-action="open-notif" data-id="${n.id}"><span class="sr-only">${n.read ? 'Read: ' : 'Unread: '}</span><div class="n-title">${esc(L.displayCopy(n.title))}</div>${n.body ? `<div class="n-body">${esc(L.displayCopy(n.body))}</div>` : ''}<time>${ago(n.createdAt)}</time></a>
    ${menu({ id: `n-${n.id}`, label: 'More actions for this notification', items: [{ label: n.read ? 'Mark as unread' : 'Mark as read', icon: 'check', action: 'toggle-read', data: { id: n.id } }] })}</li>`;
  const unread = list.filter((n) => !n.read).length;
  return `<div class="page-head"><div><h1>Notifications</h1><p class="sub">${unread ? `${unread} unread` : 'All caught up'} · for ${esc(name(store.me()))}</p></div><div class="head-actions"><button type="button" class="btn" data-action="read-all"${unread ? '' : ' disabled'}>Mark all read</button><a class="btn quiet" href="#/settings">Reminder settings</a></div></div>
    ${groups.length ? groups.map(([g, items]) => sec(`n-${g}`, g, `<ul class="list">${items.map(row).join('')}</ul>`)).join('') : empty('You’re all caught up', 'Assignments, due dates, new expenses and calendar changes show up here.')}
    <p class="small muted" style="margin-top:24px">Notifications are shown inside RoomSync only. Nothing is sent to phones or email.</p>`;
}

// ---------- Settings ----------
// Shared "House expectations" list (Requirement 3). Each item shows its text with a light
// who/when line and Edit/Remove controls; an "Add expectation" row opens a small modal.
function expectationsSection() {
  const list = store.state.expectations || [];
  const stamp = (e) => {
    const changed = e.updatedAt && e.updatedAt !== e.createdAt;
    const byId = changed ? e.updatedBy : e.createdBy;
    const verb = changed ? 'Updated' : 'Added';
    return byId ? `<div class="row-meta"><span>${verb} by ${esc(who(byId))}</span></div>` : '';
  };
  const row = (e) => `<li class="row" id="expect-${e.id}"><div class="row-main"><div class="row-title">${esc(e.text)}</div>${stamp(e)}</div>
    <div class="row-side"><button type="button" class="btn quiet sm" data-action="edit-expectation" data-id="${e.id}" aria-label="Edit expectation: ${esc(e.text)}">${ic('edit', 16)}Edit</button>${menu({ id: `exp-${e.id}`, label: `More actions for expectation: ${e.text}`, items: [{ label: 'Remove expectation', icon: 'trash', action: 'remove-expectation', data: { id: e.id }, danger: true }] })}</div></li>`;
  const body = (list.length ? `<ul class="list">${list.map(row).join('')}</ul>` : empty('No expectations yet', 'Agree on shared norms like “quiet after 11pm” or “dishes done same day”.')) + addRow('add-expectation', 'Add expectation');
  return sec('expect', 'House expectations', body, { count: list.length || null });
}
// Shared "Purchasing rules" block (Requirement 4): budget, preferred products, store preferences.
function purchasingRulesSection() {
  const p = store.state.purchasing || { budgetCents: null, preferredProducts: [], storePreferences: [] };
  const budget = p.budgetCents != null
    ? `<p style="padding-top:12px">Shared monthly budget: <strong class="money">${money(p.budgetCents)}</strong></p><p style="margin-top:8px"><button type="button" class="btn sm" data-action="set-budget">Change budget</button></p>`
    : `<p class="small muted" style="padding-top:12px">No shared budget set. Set one to track monthly spending against it.</p><p style="margin-top:8px"><button type="button" class="btn sm" data-action="set-budget">Set budget</button></p>`;
  const listBlock = (title, items, addAction, addLabel, removeAction, kind) => {
    const rows = items.length
      ? `<ul class="list">${items.map((it) => `<li class="row"><div class="row-main"><div class="row-title">${esc(it.text)}</div></div><div class="row-side"><button type="button" class="btn quiet sm" data-action="${removeAction}" data-id="${it.id}" aria-label="Remove ${kind}: ${esc(it.text)}">${ic('trash', 16)}Remove</button></div></li>`).join('')}</ul>`
      : `<p class="small muted" style="padding-top:8px">None yet.</p>`;
    return `<h3 style="margin-top:16px">${esc(title)}</h3>${rows}${addRow(addAction, addLabel)}`;
  };
  return sec('purchrules', 'Purchasing rules', `${budget}
    ${listBlock('Preferred products', p.preferredProducts || [], 'add-preferred-product', 'Add preferred product', 'remove-preferred-product', 'preferred product')}
    ${listBlock('Store preferences', p.storePreferences || [], 'add-store-preference', 'Add store preference', 'remove-store-preference', 'store preference')}
    <p class="hint">Shared buying standards. They appear as non-blocking guidance in the shopping flow — RoomSync never blocks spending.</p>`, { icon: 'cart' });
}
function viewSettings() {
  const s = store.state, p = store.prefsOf(store.me());
  const toggleRow = (nm, label, checked) => `<label class="inline-check"><input type="checkbox" name="${nm}" ${checked ? 'checked' : ''} data-change="pref"> ${label}</label>`;
  return `<div class="page-head"><h1>Settings</h1></div>
  ${sec('hh', 'Household', `<p style="padding-top:12px"><strong style="color:var(--color-text)">${esc(s.household.name)}</strong></p><p class="small muted">${s.members.map((m) => esc(m.name)).join(', ')}</p><p class="small" style="margin-top:8px">${s.mode === 'demo' ? 'This is a demo household with fictional roommates.' : 'Your household.'} Use <strong>Viewing as</strong> to switch between roommates.</p>`)}
  ${expectationsSection()}
  ${purchasingRulesSection()}
  ${sec('pref', `Reminders for ${name(store.me())}`, `<form data-inline="prefs" style="padding-top:12px">${toggleRow('reminders', 'Remind me when my chores are due soon or overdue', p.reminders)}
    <div class="field" style="max-width:320px;margin-top:8px"><label for="f-leadDays">Remind me</label>${select('leadDays', [[0, 'On the day it’s due'], [1, '1 day before'], [2, '2 days before']], p.leadDays, 'data-change="pref"')}</div>
    ${toggleRow('updates', 'Tell me about assignments, shared expenses and calendar changes', p.updates)}</form><p class="hint">Reminders appear in RoomSync’s notification list while the app is open. Background push, email and text messages aren’t part of this version.</p>`)}
  ${sec('channels', `Notification channels for ${name(store.me())}`, `<form data-inline="channels" style="padding-top:12px">
    <label class="inline-check"><input type="checkbox" name="inApp" checked disabled data-change="pref-channels"> In-app notifications <span class="muted">(always on)</span></label>
    <label class="inline-check"><input type="checkbox" name="push" ${p.channels.push ? 'checked' : ''} data-change="pref-channels"> Push notifications <span class="muted">(coming soon)</span></label>
    <label class="inline-check"><input type="checkbox" name="sms" ${p.channels.sms ? 'checked' : ''} data-change="pref-channels"> Text messages / SMS <span class="muted">(coming soon)</span></label></form><p class="hint">Only in-app delivery works in this version. Your push and text message choices are saved for a future update but don’t send anything yet.</p>`)}
  ${disclosure('proto', 'About this prototype', `<ul class="small" style="margin:0;padding-left:18px"><li>Data is saved in this browser on this device. It doesn’t sync to other devices.</li><li>There are no accounts or invite codes. “Viewing as” switches between the roommates stored here.</li><li>Notifications are in-app only.</li><li>Repayments update RoomSync’s records. RoomSync never moves money.</li></ul>`)}
  ${sec('guide', 'Getting started', `<p class="small" style="padding-top:12px">New here, or showing someone else around? Show the getting-started tips again — each tab’s quick tip reappears the next time you open it.</p><p style="margin-top:12px"><button type="button" class="btn" data-action="replay-tour">${ic('info', 16)}Show the getting-started tips again</button></p>`)}
  ${sec('res', 'Research tools', `<p class="small" style="padding-top:12px">RoomSync logs basic usage events on this device only (household created, chores assigned and completed, expenses, purchases, calendar events, tutorial progress). Nothing is uploaded. ${plural(s.analytics.length, 'event')} recorded.</p><p style="margin-top:12px"><button type="button" class="btn" data-action="export">Download events (JSON)</button></p>`)}
  ${sec('danger', 'Danger zone', `<p class="small" style="padding-top:12px">${s.mode === 'demo' ? 'Resets the demo and returns to the welcome screen.' : 'Permanently deletes this household’s data from this browser.'}</p><p style="margin-top:12px"><button type="button" class="btn danger-outline" data-action="reset">${s.mode === 'demo' ? 'Reset demo' : 'Delete all data'}</button></p>`, { danger: true })}`;
}

// ---------- Welcome ----------
const roommateRow = (i) => `<div class="roommate-row"><input type="text" name="others[]" aria-label="Roommate ${i} name" maxlength="30" placeholder="Roommate ${i}">${i > 1 ? `<button type="button" class="icon-btn" data-action="remove-roommate" aria-label="Remove roommate ${i}">${ic('x')}</button>` : '<span aria-hidden="true"></span>'}</div>`;
function viewWelcome() {
  const create = ui.welcome === 'create';
  return `<main id="main" class="welcome" tabindex="-1"><div><span class="logo">${ic('home', 22)}</span></div>
  <div><h1>Know what needs to happen, without chasing your roommates.</h1><p class="lead">Chores, shared expenses, shopping and plans in one place.</p></div>
  <div class="choices"><button type="button" class="choice primary" data-action="start-demo"><span><strong>Try the demo</strong><span class="d">Four sample roommates, ready to explore</span></span></button>
  ${create ? '' : `<button type="button" class="choice" data-action="show-create"><span><strong>Create your household</strong><span class="d">Name your place and add your roommates</span></span></button>`}</div>
  ${create ? `<section class="create-form" aria-labelledby="h-create"><div class="sec-head" style="border:0"><h2 id="h-create">Create your household</h2><button type="button" class="btn quiet sm" data-action="hide-create">Cancel</button></div>
    <form data-inline="create" novalidate><div class="form-alert" id="form-alert" role="alert" hidden></div>
    ${field('userName', 'Your name', input('userName', '', 'autocomplete="given-name" maxlength="30"'))}
    ${field('householdName', 'Household name', input('householdName', '', 'maxlength="40" placeholder="e.g. Elm Street 3B"'))}
    <fieldset id="grp-others"><legend>Roommates</legend><div id="others">${[1, 2].map(roommateRow).join('')}</div><p class="field-error" id="err-others" hidden></p><button type="button" class="btn sm" data-action="add-roommate" id="add-roommate">${ic('plus', 16)}Add roommate</button><p class="hint">Up to 5 people including you.</p></fieldset>
    <fieldset><legend>Starter chores <span class="opt">(optional)</span></legend><div class="checks">${STARTER_CHORES.map((c) => `<label><input type="checkbox" name="starter[]" value="${c.key}"> ${esc(c.title)}</label>`).join('')}</div><p class="hint">Weekly, rotating between everyone.</p></fieldset>
    <button type="submit" class="btn primary" style="width:100%">Create household</button></form></section>` : ''}
  <details class="disclosure"><summary><span>${ic('info', 16)} Saved on this device</span><span class="chev">${ic('chevron', 18)}</span></summary><div class="disc-body"><p class="small">This is a prototype. Your household is stored in this browser only: it doesn’t sync to other phones or laptops, and there are no accounts or invite codes yet. Notifications appear inside the app.</p></div></details></main>`;
}
function handleInlineForm(form) {
  const kind = form.dataset.inline;
  if (kind === 'create') {
    const d = formData(form);
    const res = store.createHousehold({ userName: d.userName, householdName: d.householdName, others: d.others || [], starter: d.starter || [] });
    if (!res.ok) return showErrors(form, res.errors);
    ui.welcome = null; location.hash = '#/home';
    toast(`Welcome to ${store.state.household.name}.`);
  } else if (kind === 'add-item') {
    const d = formData(form), err = $('#qa-err', form);
    if (!String(d.name || '').trim()) { err.textContent = 'Type an item name to add it.'; err.hidden = false; $('#qa-name', form).setAttribute('aria-invalid', 'true'); $('#qa-name', form).focus(); return; }
    ui.focusAfter = '#qa-name';
    const res = store.addItem({ name: d.name, qty: d.qty });
    if (!res.ok) { ui.focusAfter = null; err.textContent = Object.values(res.errors)[0]; err.hidden = false; return; }
    toast(`Added ${d.name.trim()}.`);
  } else if (kind === 'profile') {
    // Save the current roommate's interim profile (Requirement 5.1); validation errors surface inline.
    const d = formData(form);
    const res = store.updateProfile({ dietary: d.dietary, budgetCents: d.budgetCents, rules: d.rules });
    if (!res.ok) return showErrors(form, res.errors);
    toast('Profile saved.');
  }
}

// ---------- Dialogs ----------
function openChoreForm(occ) {
  const c = occ && store.sel.chore(occ), rotating = !!(c && c.rotation.length);
  const form = openModal({
    title: occ ? 'Edit chore' : 'Add chore', submitLabel: occ ? 'Save changes' : 'Add chore',
    body: `<div class="field" style="margin-bottom:4px"><label class="sr-only" for="f-title">Chore</label><input type="text" id="f-title" name="title" class="qa-title" value="${esc(occ ? occ.title : '')}" placeholder="Chore name" maxlength="80" autocomplete="off" aria-required="true"><p class="field-error" id="err-title" hidden></p></div>
      <div class="field"><label class="sr-only" for="f-notes">Notes (optional)</label><textarea id="f-notes" name="notes" class="qa-notes" maxlength="300" placeholder="Notes (optional)">${esc(occ ? occ.notes : '')}</textarea></div>
      <div class="row2 stack-sm">${field('assigneeId', 'Assigned to', select('assigneeId', memberOpts(), occ ? occ.assigneeId : store.me()))}${field('due', 'Due date', `<input type="date" id="f-due" name="due" value="${occ ? occ.due : today()}">`)}</div>
      <div class="field"><label id="rec-l">Repeats</label>${segmented('recurrence', [['once', 'One time'], ['weekly', 'Weekly']], c ? c.recurrence : 'once', 'data-change="chore-form"')}</div>
      <div id="rotate-wrap" hidden><label class="inline-check"><input type="checkbox" name="rotate" data-change="chore-form" ${rotating ? 'checked' : ''}> Rotate between roommates</label>
      <div id="rotation-wrap" hidden>${checkGroup('rotation', 'Who’s in the rotation?', store.state.members, rotating ? c.rotation : store.memberIds())}<p class="hint">Each week goes to the next person in household order. You can reassign any single week.</p>
      <label class="inline-check"><input type="checkbox" name="autoRotate" data-change="chore-form" ${c && c.autoRotate ? 'checked' : ''}> Advance automatically each cycle</label>
      <div id="cycle-wrap" hidden>${field('cycleDays', 'Cycle length', select('cycleDays', [[7, 'Weekly (7 days)'], [14, 'Every 2 weeks (14 days)'], [30, 'Monthly (30 days)']], c && c.cycleDays ? c.cycleDays : 7))}<p class="hint">When on, whose turn it is advances on this schedule even if a turn is skipped. A manual reassignment or swap wins that cycle; the rotation resumes the next one.</p></div></div></div>`,
    onSubmit: (d) => {
      const data = { title: d.title, notes: d.notes, assigneeId: d.assigneeId, due: d.due, recurrence: d.recurrence, rotate: d.recurrence === 'weekly' && 'rotate' in d, rotation: d.rotation || [], autoRotate: d.recurrence === 'weekly' && 'rotate' in d && 'autoRotate' in d, cycleDays: d.cycleDays };
      const res = occ ? store.editChore(occ.id, data) : store.addChore(data);
      if (res.ok) toast(occ ? 'Chore updated.' : `Added ${data.title.trim()}.`);
      return res;
    },
  });
  syncChoreForm(form);
}
function syncChoreForm(form) {
  const weekly = form.elements.recurrence.value === 'weekly';
  const rotating = weekly && form.elements.rotate.checked;
  $('#rotate-wrap', form).hidden = !weekly;
  $('#rotation-wrap', form).hidden = !rotating;
  // Auto-rotation only applies once a weekly chore rotates; its cycle-length control follows the checkbox.
  $('#cycle-wrap', form).hidden = !(rotating && form.elements.autoRotate.checked);
}
function expenseFields(e, { description = '', payerId } = {}) {
  const amt = e.amountCents ? (e.amountCents / 100).toFixed(2) : '';
  return `${field('description', 'What was it for?', input('description', e.description || description, 'maxlength="80" autocomplete="off"'))}
    <div class="row2 stack-sm">${field('amount', 'Amount (USD)', input('amount', amt, 'inputmode="decimal" placeholder="0.00" autocomplete="off" data-preview'))}${field('date', 'Date', `<input type="date" id="f-date" name="date" value="${e.date || today()}">`)}</div>
    ${field('payerId', 'Paid by', select('payerId', memberOpts(), e.payerId || payerId || store.me()))}
    ${checkGroup('participantIds', 'Split equally between', store.state.members, e.participantIds || store.memberIds())}
    <div class="split-preview" id="split-preview" aria-live="polite"></div>
    <details class="inline" style="margin-top:8px"><summary>How rounding works</summary><ul><li>Shares are calculated in whole cents.</li><li>Any leftover cents go one each to the earliest roommates in household order, so the shares always add up to the total.</li></ul></details>`;
}
const expenseData = (d) => ({ description: d.description, amount: d.amount, date: d.date, payerId: d.payerId, participantIds: d.participantIds || [], token: d.token });
const tokenInput = () => `<input type="hidden" name="token" value="${Date.now()}-${Math.random().toString(36).slice(2)}">`;
function openExpenseForm(exp) {
  const form = openModal({
    title: exp ? 'Edit expense' : 'Add expense', submitLabel: exp ? 'Save changes' : 'Add expense',
    body: `${tokenInput()}${expenseFields(exp || {})}`,
    onSubmit: (d) => { const res = exp ? store.editExpense(exp.id, expenseData(d)) : store.addExpense(expenseData(d)); if (res.ok) toast(exp ? 'Expense updated.' : 'Expense added.'); return res; },
  });
  updateSplitPreview(form);
}
function openPurchaseForm(item) {
  const form = openModal({
    title: `Purchased: ${item.name}`, submitLabel: 'Save purchase and expense',
    body: `${shoppingHint()}${tokenInput()}<div class="field"><label>What would you like to record?</label>${segmented('mode', [['cost', 'Purchase and shared cost'], ['none', 'Purchase only']], 'cost', 'data-change="purchase-form"')}</div>
      <div id="expense-fields">${expenseFields({}, { description: item.name, payerId: item.buyerId })}</div><p class="hint" id="no-expense-hint" hidden>No expense will be created. You can still add one later from Expenses.</p>`,
    onSubmit: (d) => {
      const withExpense = d.mode !== 'none';
      const res = store.purchaseItem(item.id, withExpense ? { expense: expenseData(d) } : {});
      if (res.ok) toast(withExpense ? `Purchased ${item.name} and recorded the expense.` : `Marked ${item.name} purchased. No expense recorded.`);
      return res;
    },
  });
  updateSplitPreview(form);
}
function updateSplitPreview(form) {
  const p = $('#split-preview', form); if (!p) return;
  const cents = L.parseMoney(form.elements.amount.value);
  const ids = store.memberIds().filter((id) => $$('input[name="participantIds[]"]:checked', form).some((c) => c.value === id));
  if (!cents || !ids.length) { p.textContent = 'Enter an amount to see each person’s share.'; return; }
  const sp = L.splitEqual(cents, ids);
  p.textContent = `Split ${ids.length} ${ids.length === 1 ? 'way' : 'ways'}: ${ids.map((id) => `${name(id)} ${money(sp[id])}`).join(' · ')}`;
}
function openReimbForm(preset = {}) {
  const fromId = preset.from || store.me(), others = store.memberIds().filter((id) => id !== fromId);
  openModal({
    title: 'Record repayment', submitLabel: 'Record repayment',
    body: `<p class="small" style="margin-bottom:16px">Record a payment you made outside RoomSync. RoomSync doesn’t move money.</p>${tokenInput()}
      <div class="row2 stack-sm">${field('fromId', 'Who paid', select('fromId', memberOpts(), fromId))}${field('toId', 'Paid to', select('toId', memberOpts(), preset.to || others[0]))}</div>
      <div class="row2 stack-sm">${field('amount', 'Amount (USD)', input('amount', preset.cents ? (preset.cents / 100).toFixed(2) : '', 'inputmode="decimal" placeholder="0.00" autocomplete="off"'))}${field('date', 'Date', `<input type="date" id="f-date" name="date" value="${today()}">`)}</div>
      ${field('note', 'Note', input('note', '', 'maxlength="80" placeholder="e.g. Venmo, cash"'), { optional: true })}`,
    onSubmit: (d) => { const res = store.addReimbursement(d); if (res.ok) toast('Repayment recorded. No money was moved by RoomSync.'); return res; },
  });
}
function openItemForm(item) {
  openModal({
    title: item ? 'Edit item' : 'Add shopping item', submitLabel: item ? 'Save changes' : 'Add item',
    body: `${field('name', 'Item', input('name', item ? item.name : '', 'maxlength="60" autocomplete="off"'))}
      <div class="row2 stack-sm">${field('qty', 'Quantity', input('qty', item ? item.qty : '1', 'maxlength="20"'))}${field('buyerId', 'Who’s buying?', select('buyerId', [['', 'Unclaimed'], ...memberOpts()], item ? item.buyerId || '' : ''), { optional: true })}</div>
      ${field('notes', 'Notes', input('notes', item ? item.notes : '', 'maxlength="200" placeholder="Brand, size, store…"'), { optional: true })}`,
    onSubmit: (d) => { const res = item ? store.editItem(item.id, d) : store.addItem(d); if (res.ok) toast(item ? 'Item updated.' : 'Added to the shopping list.'); return res; },
  });
}
function openEventForm(ev, preset = {}) {
  const sd = ev ? L.dtDate(ev.start) : preset.date || today(), ed = ev ? L.dtDate(ev.end) : sd;
  const dt = (n, v) => `<input type="date" id="f-${n}" name="${n}" value="${v}">`, tm = (n, v) => `<input type="time" id="f-${n}" name="${n}" value="${v}">`;
  openModal({
    title: ev ? 'Edit event' : 'Add event', submitLabel: ev ? 'Save changes' : 'Add event',
    body: `<div class="field" style="margin-bottom:4px"><label class="sr-only" for="f-title">Title</label><input type="text" id="f-title" name="title" class="qa-title" value="${esc(ev ? ev.title : '')}" placeholder="Event title, e.g. Quiet study time" maxlength="80" autocomplete="off"><p class="field-error" id="err-title" hidden></p></div>
      <div class="field"><label class="sr-only" for="f-notes">Notes (optional)</label><textarea id="f-notes" name="notes" class="qa-notes" maxlength="300" placeholder="Notes (optional)">${esc(ev ? ev.notes : '')}</textarea></div>
      ${field('category', 'Type', select('category', Object.entries(L.CATEGORIES).map(([k, v]) => [k, v.hint]), ev ? ev.category : 'quiet'))}
      <div class="row2 stack-sm">${field('startDate', 'Starts', dt('startDate', sd))}${field('startTime', 'Start time', tm('startTime', ev ? L.dtTime(ev.start) : '19:00'))}</div>
      <div class="row2 stack-sm">${field('endDate', 'Ends', dt('endDate', ed))}${field('endTime', 'End time', tm('endTime', ev ? L.dtTime(ev.end) : '21:00'))}</div>`,
    onSubmit: (d) => {
      const res = ev ? store.editEvent(ev.id, d) : store.addEvent(d);
      if (res.ok) toast(ev ? 'Event updated.' : 'Event added. Roommates see it in their notifications.');
      else if (res.errors) { const e = res.errors; res.errors = { ...e, ...(e.start ? { startDate: e.start } : {}), ...(e.end ? { endDate: e.end } : {}) }; delete res.errors.start; delete res.errors.end; }
      return res;
    },
  });
}
// Direct-trade picker: pick one of another roommate's open occurrences to trade mine against (2.5).
function openTradeForm(occId) {
  const mineOcc = byId(store.state.occurrences, occId);
  if (!mineOcc) return;
  const options = otherOpenOccs(occId);
  if (!options.length) { toast('No one else has an open chore to trade right now.', { error: true }); return; }
  const opts = options.map((o) => [o.id, `${o.title} — ${name(o.assigneeId)} · ${L.fmtDay(o.due)}`]);
  openModal({
    title: 'Offer a trade',
    submitLabel: 'Send offer',
    body: `<p class="small" style="margin-bottom:16px">Offer your <strong>${esc(mineOcc.title)}</strong> in exchange for a roommate’s chore. They’ll get a request to accept or decline.</p>
      ${field('targetOccId', 'Trade for', select('targetOccId', opts, opts[0][0]))}`,
    onSubmit: (d) => {
      const res = store.proposeDirectSwap(occId, d.targetOccId);
      if (res.ok) toast('Trade offer sent.');
      return res.ok ? res : { ok: false, error: res.error };
    },
  });
}
// Add/edit a shared house expectation via a small textarea modal (Requirement 3).
function openExpectationForm(exp) {
  openModal({
    title: exp ? 'Edit expectation' : 'Add expectation', submitLabel: exp ? 'Save changes' : 'Add expectation',
    body: `<div class="field"><label class="sr-only" for="f-text">Expectation</label><textarea id="f-text" name="text" class="qa-notes" maxlength="300" placeholder="e.g. Quiet after 11pm on weeknights" aria-required="true">${esc(exp ? exp.text : '')}</textarea><p class="field-error" id="err-text" hidden></p></div>`,
    onSubmit: (d) => {
      const res = exp ? store.editExpectation(exp.id, d.text) : store.addExpectation(d.text);
      if (res.ok) toast(exp ? 'Expectation updated.' : 'Expectation added.');
      else return { ok: false, errors: { text: res.error } };
      return res;
    },
  });
}
// Set or change the shared monthly purchasing budget (Requirement 4.1). Empty value clears it.
function openBudgetForm() {
  const cents = store.state.purchasing && store.state.purchasing.budgetCents;
  openModal({
    title: 'Shared monthly budget', submitLabel: 'Save budget',
    body: `<p class="small" style="margin-bottom:16px">A shared monthly spending guide. RoomSync shows remaining budget as information only — it never blocks spending. Leave blank to clear it.</p>
      ${field('amount', 'Monthly budget (USD)', input('amount', cents != null ? (cents / 100).toFixed(2) : '', 'inputmode="decimal" placeholder="0.00" autocomplete="off"'), { optional: true })}`,
    onSubmit: (d) => {
      const res = store.setPurchasingBudget(d.amount);
      if (res.ok) toast(res.cleared ? 'Shared budget cleared.' : `Shared budget set to ${money(res.budgetCents)}.`);
      else return { ok: false, errors: { amount: res.error } };
      return res;
    },
  });
}
// Add a shared preferred product or store preference (Requirement 4.2). `kind` selects the store fn + copy.
function openPurchasingItemForm(kind) {
  const cfg = kind === 'store'
    ? { title: 'Add store preference', label: 'Store preference', placeholder: 'e.g. Costco for bulk paper goods', add: (t) => store.addStorePreference(t), done: 'Store preference added.' }
    : { title: 'Add preferred product', label: 'Preferred product', placeholder: 'e.g. Seventh Generation dish soap', add: (t) => store.addPreferredProduct(t), done: 'Preferred product added.' };
  openModal({
    title: cfg.title, submitLabel: 'Add',
    body: `${field('text', cfg.label, input('text', '', `maxlength="300" autocomplete="off" placeholder="${esc(cfg.placeholder)}"`))}`,
    onSubmit: (d) => {
      const res = cfg.add(d.text);
      if (res.ok) toast(cfg.done);
      else return { ok: false, errors: { text: res.error } };
      return res;
    },
  });
}
const detailRow = (icon, k, v) => `<div><dt>${ic(icon, 16)}${k}</dt><dd>${v}</dd></div>`;
function viewChore(id) {
  const o = store.state.occurrences.find((x) => x.id === id);
  if (!o) return;
  const c = store.sel.chore(o), mine = o.assigneeId === store.me();
  const rows = [detailRow('user', 'Assigned to', mine ? 'You' : esc(name(o.assigneeId)))];
  rows.push(o.doneAt ? detailRow('check', 'Completed', `${esc(who(o.doneBy))} · ${L.fmtStamp(o.doneAt)}`) : detailRow('calendar', 'Due', `${L.fmtFull(o.due)} ${dueMeta(o)}`));
  if (c && c.recurrence === 'weekly') rows.push(detailRow('repeat', 'Repeats', 'Every week'));
  if (c && c.autoRotate) rows.push(detailRow('repeat', 'Auto-rotates', `Every ${plural(c.cycleDays || 7, 'day')}`));
  if (c && c.rotation.length && !o.doneAt) rows.push(detailRow('user', 'Next in rotation', esc(who(c.autoRotate ? L.rotationAssignee(c, L.addDays(o.due, c.cycleDays || 7)) : L.nextAssigneeId(c, o)))));
  const canSwap = mine && !o.doneAt && !store.state.swaps.some((s) => s.status === 'pending' && (s.occId === o.id || s.targetOccId === o.id));
  const swapButtons = canSwap ? `<button type="button" class="btn" data-action="request-open-swap" data-id="${o.id}">Ask someone to take this</button>${otherOpenOccs(o.id).length ? `<button type="button" class="btn" data-action="offer-trade" data-id="${o.id}">Offer a trade…</button>` : ''}` : '';
  openModal({
    title: o.title,
    body: `<dl class="details">${rows.join('')}</dl>${o.notes ? `<div class="details-notes"><h3>Notes</h3><p>${esc(o.notes)}</p></div>` : ''}`,
    footerExtra: o.doneAt ? '' : `${swapButtons}<button type="button" class="btn" data-action="edit-chore-from-details" data-id="${o.id}">Edit</button><button type="button" class="btn primary" data-action="complete-from-details" data-id="${o.id}">Mark complete</button>`,
  });
}
function viewEvent(id) {
  const ev = store.state.events.find((x) => x.id === id);
  if (!ev) return;
  const mine = ev.creatorId === store.me();
  openModal({
    title: ev.title,
    body: `<dl class="details">${detailRow('calendar', 'When', esc(L.describeEventTime(ev)))}${detailRow('star', 'Type', catPill(ev.category))}${detailRow('user', 'Added by', esc(who(ev.creatorId)))}</dl>${ev.notes ? `<div class="details-notes"><h3>Notes</h3><p>${esc(ev.notes)}</p></div>` : ''}
      ${ev.category === 'guest' ? '<p class="small muted" style="margin-top:12px">Guest events are a heads-up only. No approval needed.</p>' : ''}${mine ? '' : `<p class="small muted" style="margin-top:12px">Only ${esc(name(ev.creatorId))} can edit or delete this event.</p>`}`,
    footerExtra: mine ? `<button type="button" class="btn danger-outline" data-action="delete-event" data-id="${ev.id}">Delete</button><button type="button" class="btn" data-action="edit-event" data-id="${ev.id}">Edit</button>` : '',
  });
}

// ---------- actions ----------
const byId = (list, id) => list.find((x) => x.id === id);
const actions = {
  'start-demo': () => { store.startDemo(); ui.welcome = null; location.hash = '#/home'; toast('Demo ready. You’re viewing as Maya.'); },
  'show-create': () => { ui.welcome = 'create'; render(); $('#f-userName')?.focus(); },
  'hide-create': () => { ui.welcome = null; render(); },
  'add-roommate': (d, el) => { const box = $('#others'); const n = box.children.length + 1; if (n > 4) return; box.insertAdjacentHTML('beforeend', roommateRow(n)); $$('input', box).at(-1).focus(); if (n >= 4) el.disabled = true; },
  'remove-roommate': (d, el) => { el.closest('.roommate-row').remove(); $$('.roommate-row', $('#others')).forEach((r, i) => { const inp = $('input', r); inp.placeholder = `Roommate ${i + 1}`; inp.setAttribute('aria-label', `Roommate ${i + 1} name`); }); $('#add-roommate').disabled = false; $('#add-roommate').focus(); },
  'close-modal': closeModal,
  'add-chore': () => openChoreForm(null),
  'edit-chore': (d) => openChoreForm(byId(store.state.occurrences, d.id)),
  'view-chore': (d) => viewChore(d.id),
  'edit-chore-from-details': (d) => { closeModal(); openChoreForm(byId(store.state.occurrences, d.id)); },
  'complete-from-details': (d) => { closeModal(); actions.complete(d); }, // same completion path, toast and Undo as the checkbox
  complete: (d) => {
    const o = byId(store.state.occurrences, d.id); if (!o) return;
    if (store.completeChore(d.id).ok) toast(`Completed ${o.title}.`, { action: 'Undo', onAction: () => { const r = store.undoComplete(d.id); toast(r.ok ? `${o.title} is open again.` : r.error, { error: !r.ok }); } });
  },
  'undo-complete': (d) => { const r = store.undoComplete(d.id); toast(r.ok ? 'Chore is open again.' : r.error, { error: !r.ok }); },
  'reassign-me': (d) => { const o = byId(store.state.occurrences, d.id); if (store.reassignChore(d.id, store.me()).ok) toast(`${o.title} is now assigned to you.`); },
  // ---- chore swaps (Requirement 2) ----
  'request-open-swap': (d) => { closeModal(); const o = byId(store.state.occurrences, d.id); const r = store.requestOpenSwap(d.id); toast(r.ok ? `Asked the household to take ${o.title}.` : r.error, { error: !r.ok }); },
  'offer-trade': (d) => { closeModal(); openTradeForm(d.id); },
  'cancel-swap': (d) => { const r = store.cancelSwap(d.id); toast(r.ok ? 'Request cancelled.' : r.error, { error: !r.ok }); },
  'accept-open-swap': (d) => { const r = store.acceptOpenSwap(d.id); toast(r.ok ? 'You took this chore.' : r.error, { error: !r.ok, ...(r.ok ? afterSwap() : {}) }); },
  'respond-direct-swap': (d) => {
    const accept = d.accept === '1';
    const r = store.respondDirectSwap(d.id, accept);
    if (!r.ok) return toast(r.error, { error: true });
    if (accept) toast('Trade accepted. Both chores swapped.', afterSwap());
    else toast('Trade declined. Both chores stay as they were.');
  },
  'delete-chore': (d) => { const o = byId(store.state.occurrences, d.id); confirmDialog({ title: 'Delete this chore?', message: `<strong>${esc(o.title)}</strong> and its upcoming occurrences will be removed. Completed history is kept.`, confirmLabel: 'Delete chore', onConfirm: () => { store.deleteChore(d.id); afterDelete(); } }); },
  'stats-week': (d) => { ui.statsWeek = Number(d.delta) === 0 ? L.startOfWeek(today()) : L.addDays(ui.statsWeek, Number(d.delta)); render(); },
  'cal-shift': (d) => { ui.calSel = L.addDays(ui.calSel || today(), Number(d.delta)); render(); },
  'cal-today': () => { ui.calSel = today(); render(); },
  'cal-pick': (d) => { ui.calSel = d.date; render(); },
  'cal-open-day': (d) => { ui.calSel = d.date; ui.calView = 'agenda'; render(); },
  'cal-view': (d) => { ui.calView = d.view; render(); },
  'add-expense': () => openExpenseForm(null),
  'edit-expense': (d) => openExpenseForm(byId(store.state.expenses, d.id)),
  'delete-expense': (d) => { const e = byId(store.state.expenses, d.id); confirmDialog({ title: 'Delete this expense?', message: `<strong>${esc(e.description)}</strong> (${money(e.amountCents)}) will be removed and balances recalculated.`, confirmLabel: 'Delete expense', onConfirm: () => { store.deleteExpense(d.id); afterDelete(); } }); },
  'add-reimb': (d) => openReimbForm({ from: d.from, to: d.to, cents: d.cents ? Number(d.cents) : 0 }),
  'delete-reimb': (d) => confirmDialog({ title: 'Delete this repayment?', message: 'Balances will be recalculated. RoomSync never moved any money, so this only changes the record.', confirmLabel: 'Delete repayment', onConfirm: () => { store.deleteReimbursement(d.id); afterDelete(); } }),
  'add-item': () => openItemForm(null),
  'edit-item': (d) => openItemForm(byId(store.state.shopping, d.id)),
  'delete-item': (d) => { const i = byId(store.state.shopping, d.id); confirmDialog({ title: 'Remove this item?', message: `Remove <strong>${esc(i.name)}</strong> from the shopping list?`, confirmLabel: 'Remove item', onConfirm: () => { store.deleteItem(d.id); afterDelete(); } }); },
  claim: (d) => { const r = store.claimItem(d.id); toast(r.ok ? 'You’re getting this one.' : r.error || 'Could not claim.', { error: !r.ok }); },
  unclaim: (d) => { store.claimItem(d.id, false); },
  takeover: (d) => { const i = byId(store.state.shopping, d.id); if (store.takeOverItem(d.id).ok) toast(`You’re now getting ${i.name}.`); },
  purchase: (d) => openPurchaseForm(byId(store.state.shopping, d.id)),
  'reopen-item': (d) => { store.reopenItem(d.id); },
  'add-again': (d) => { const i = byId(store.state.shopping, d.id); const r = store.addItemAgain(d.id); toast(r.duplicate ? `${i.name} is already on the list.` : `Added ${i.name} to the list again.`); },
  'add-event': () => openEventForm(null, { date: ui.calSel }),
  'view-event': (d) => viewEvent(d.id),
  'edit-event': (d) => { closeModal(); openEventForm(byId(store.state.events, d.id)); },
  'delete-event': (d) => { const ev = byId(store.state.events, d.id); closeModal(); confirmDialog({ title: 'Delete this event?', message: `<strong>${esc(ev.title)}</strong> will be removed from the calendar and your roommates will be notified.`, confirmLabel: 'Delete event', onConfirm: () => { store.deleteEvent(d.id); afterDelete(); } }); },
  // ---- shared house expectations (Requirement 3) ----
  'add-expectation': () => openExpectationForm(null),
  'edit-expectation': (d) => openExpectationForm(byId(store.state.expectations, d.id)),
  'remove-expectation': (d) => { const e = byId(store.state.expectations, d.id); if (!e) return; confirmDialog({ title: 'Remove this expectation?', message: `Remove <strong>${esc(e.text)}</strong> from the shared list?`, confirmLabel: 'Remove expectation', onConfirm: () => { store.removeExpectation(d.id); afterDelete(); } }); },
  // ---- shared purchasing rules (Requirement 4) ----
  'set-budget': () => openBudgetForm(),
  'add-preferred-product': () => openPurchasingItemForm('product'),
  'add-store-preference': () => openPurchasingItemForm('store'),
  'remove-preferred-product': (d) => { const it = byId(store.state.purchasing.preferredProducts, d.id); if (!it) return; confirmDialog({ title: 'Remove this preferred product?', message: `Remove <strong>${esc(it.text)}</strong>?`, confirmLabel: 'Remove', onConfirm: () => { store.removePreferredProduct(d.id); afterDelete(); } }); },
  'remove-store-preference': (d) => { const it = byId(store.state.purchasing.storePreferences, d.id); if (!it) return; confirmDialog({ title: 'Remove this store preference?', message: `Remove <strong>${esc(it.text)}</strong>?`, confirmLabel: 'Remove', onConfirm: () => { store.removeStorePreference(d.id); afterDelete(); } }); },
  'open-notif': (d) => store.setRead(d.id, true),
  'toggle-read': (d) => { const n = byId(store.state.notifications, d.id); store.setRead(d.id, !n.read); },
  'read-all': () => store.markAllRead(),
  export: () => {
    const blob = new Blob([store.exportAnalytics()], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'roomsync-test-events.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'replay-tour': () => { resetCoachmarks(storage); toast('Getting-started tips will show again as you visit each tab.'); },
  reset: () => confirmDialog({ title: store.state.mode === 'demo' ? 'Reset the demo?' : 'Delete all data?', message: 'This permanently removes this household’s data from this browser.', confirmLabel: 'Delete everything', onConfirm: () => { resetCoachmarks(storage); store.reset(); ui.welcome = null; location.hash = '#/home'; } }),
  'retry-load': () => { store.reset(); render(); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled || el.type === 'radio') return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'A' && el.dataset.action !== 'open-notif') e.preventDefault();
  fn(el.dataset, el);
});
document.addEventListener('change', (e) => {
  const el = e.target, k = el.dataset.change;
  if (el.dataset.action === 'cal-view') return actions['cal-view'](el.dataset);
  if (k === 'switch-user') { store.setCurrentUser(el.value); toast(`Now viewing as ${name(el.value)}.`); }
  else if (k === 'chore-form') syncChoreForm(el.form);
  else if (k === 'purchase-form') { const on = el.value !== 'none'; $('#expense-fields', el.form).hidden = !on; $('#no-expense-hint', el.form).hidden = on; $('[data-submit]', el.form).textContent = on ? 'Save purchase and expense' : 'Mark purchased'; }
  else if (k === 'pref') { const f = el.form; store.setPrefs({ reminders: f.elements.reminders.checked, leadDays: Number(f.elements.leadDays.value), updates: f.elements.updates.checked }); toast('Preferences saved.'); }
  else if (k === 'pref-channels') { const f = el.form; store.setPrefs({ channels: { inApp: true, push: f.elements.push.checked, sms: f.elements.sms.checked } }); toast('Notification channels saved.'); }
  else if (el.name === 'participantIds[]' && el.form) updateSplitPreview(el.form);
});
document.addEventListener('input', (e) => { if (e.target.hasAttribute?.('data-preview')) updateSplitPreview(e.target.form); });
document.addEventListener('toggle', (e) => { const k = e.target.dataset?.key; if (k) ui.open[k] = e.target.open; }, true);
// A link in a disclosure summary should navigate without toggling the dropdown open/closed.
// Native <details> toggles when the summary is clicked; preventDefault cancels that toggle,
// so we navigate manually via the link's hash to keep the dropdown state unchanged.
document.addEventListener('click', (e) => {
  const a = e.target.closest('summary a[href]');
  if (!a) return;
  e.preventDefault();
  const href = a.getAttribute('href');
  if (href && href[0] === '#') location.hash = href.slice(1);
}, false);
document.addEventListener('submit', (e) => { const f = e.target; if (f.dataset.inline) { e.preventDefault(); handleInlineForm(f); } });

// ---------- shell & render ----------
const NAV = [['home', '#/home', 'Home', 'home', 'Home'], ['chores', '#/chores/mine', 'Chores', 'chores', 'Chores'], ['money', '#/money/expenses', 'Expenses & Shopping', 'money', 'Expenses & Shopping'], ['calendar', '#/calendar', 'Calendar', 'calendar', 'Calendar'], ['profile', '#/profile', 'Profile', 'user', 'Profile']];
const TITLES = { home: 'Home', chores: 'Chores', money: 'Expenses & Shopping', calendar: 'Calendar', profile: 'Profile', notifications: 'Notifications', settings: 'Settings' };
const ADD_ITEMS = [{ label: 'Chore', icon: 'chores', action: 'add-chore' }, { label: 'Expense', icon: 'money', action: 'add-expense' }, { label: 'Shopping item', icon: 'cart', action: 'add-item' }, { label: 'Event', icon: 'calendar', action: 'add-event' }];
// Selector that identifies the focused control across re-renders: every data-* attribute, so e.g. the Friday date button
// is found again instead of the first cal-pick button (Monday).
function focusSig(el) {
  const keys = Object.keys(el.dataset).filter((k) => k !== 'menuToggle');
  if (el.dataset.action || keys.length) return `${el.tagName.toLowerCase()}${keys.map((k) => `[data-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(el.dataset[k])}"]`).join('')}`;
  return el.id ? `#${CSS.escape(el.id)}` : null;
}
function render() {
  const route = parseRoute();
  const a = document.activeElement;
  const sig = a && app.contains(a) ? focusSig(a) : null;
  if (!store.state) { app.innerHTML = loadError ? viewLoadError() : viewWelcome(); document.title = 'RoomSync'; return; }
  const [section, sub] = route.parts;
  let page;
  switch (section) {
    case 'chores': page = viewChores(['mine', 'all', 'done'].includes(sub) ? sub : 'mine'); break;
    case 'money': page = viewMoney(sub === 'shopping' ? 'shopping' : 'expenses'); break;
    case 'calendar': page = viewCalendar(); break;
    case 'profile': page = viewProfile(); break;
    case 'notifications': page = viewNotifications(); break;
    case 'settings': page = viewSettings(); break;
    default: page = viewHome();
  }
  const key = TITLES[section] ? section : 'home';
  const unread = store.sel.unread(), s = store.state, isNarrow = narrow();
  const navLinks = (side) => NAV.map(([k, href, label, icon, short]) => `<a ${side ? 'class="nav"' : ''} href="${href}"${k === key ? ' aria-current="page"' : ''} aria-label="${esc(label)}">${ic(icon, side ? 20 : 22)}<span aria-hidden="true">${side ? label : short}</span></a>`).join('');
  const bell = `<a class="icon-link" href="#/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}"${key === 'notifications' ? ' aria-current="page"' : ''}>${ic('bell', 20)}${unread ? `<span class="badge-count" aria-hidden="true">${unread > 9 ? '9+' : unread}</span>` : ''}</a>`;
  const gear = `<a class="icon-link" href="#/settings" aria-label="Settings"${key === 'settings' ? ' aria-current="page"' : ''}>${ic('gear', 20)}</a>`;
  const household = `<a class="household" href="#/home" title="${esc(s.household.name)}" aria-label="${esc(s.household.name)}, home"><span class="logo">${ic('home', 16)}</span><span class="t">${esc(s.household.name)}</span></a>`;
  const viewerSelect = (label) => `<label for="switch-user">${label}</label><select id="switch-user" data-change="switch-user">${s.members.map((m) => `<option value="${m.id}"${m.id === s.currentUserId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>`;
  const modeName = s.mode === 'demo' ? 'Demo' : 'Local';
  // Phones: the roommate switcher lives inside the demo controls so the header stays quiet; the chip still names who you are viewing as.
  const status = `<div class="statusbar"><details class="status"><summary>${ic('info', 14)}<span class="dot" aria-hidden="true"></span>${isNarrow ? `${modeName} · Viewing as ${esc(name(s.currentUserId))}` : `${modeName} · Saved on this device`}</summary><div class="panel"><strong style="color:var(--color-text)">${s.mode === 'demo' ? 'Demo household' : 'Local household'} · ${esc(s.household.name)}</strong>
    ${isNarrow ? `<div class="panel-viewer">${viewerSelect('Viewing as')}<p class="hint">Preview each roommate’s view. This isn’t a login.</p></div>` : ''}
    <ul><li>Saved on this device only. It doesn’t sync to other devices.</li><li>${isNarrow ? 'Switching roommates previews their chores and balance.' : '“Viewing as” previews each roommate. There are no accounts yet.'}</li><li>Notifications show inside RoomSync only.</li></ul></div></details></div>`;
  const sidebar = `<aside class="sidebar" aria-label="Sidebar"><div class="side-head">${household}</div>
    <div class="side-viewer"><label for="switch-user">Viewing as</label><div class="side-tools"><select id="switch-user" data-change="switch-user">${s.members.map((m) => `<option value="${m.id}"${m.id === s.currentUserId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>${bell}${gear}</div></div>
    ${menu({ id: 'add-side', label: 'Add to household', icon: 'plus', text: 'Add', cls: 'nav-add', items: ADD_ITEMS })}
    <nav aria-label="Primary">${navLinks(true)}</nav><div class="side-foot">${status}</div></aside>`;
  const topbar = `<header class="topbar">${household}${bell}${gear}</header>`;
  app.innerHTML = `<div class="shell">${isNarrow ? '' : sidebar}
    <div class="main-col">${isNarrow ? topbar : ''}
      ${store.saveError ? `<div class="banner-error" role="alert">Couldn’t save to this browser (storage may be full or blocked). Recent changes will be lost if you close or refresh this page.</div>` : ''}
      <main id="main" tabindex="-1" class="${key === 'home' || key === 'calendar' ? 'wide' : ''}">${isNarrow ? status : ''}${page}</main></div>
    ${isNarrow ? `<nav class="bottomnav" aria-label="Primary">${navLinks(false)}${menu({ id: 'add-fab', label: 'Add', icon: 'plus', cls: 'fab', wrap: 'fab-wrap', items: ADD_ITEMS })}</nav>` : ''}</div>`;
  document.title = `${TITLES[key]} · RoomSync`;
  afterRender(route, sig);
}
function viewLoadError() {
  return `<main id="main" class="welcome" tabindex="-1"><h1>We couldn’t read your saved data</h1><p class="lead">${esc(loadError)}</p><button type="button" class="btn danger" data-action="retry-load">Clear saved data and start fresh</button></main>`;
}
function afterRender(route, sig) {
  const hash = location.hash;
  if (ui.handled !== hash) {
    ui.handled = hash;
    const id = route.query.id;
    if (id) {
      const el = document.getElementById(`occ-${id}`) || document.getElementById(`exp-${id}`) || document.getElementById(`item-${id}`);
      if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); const d = $('details', el); if (d) d.open = true; }
      if (route.parts[0] === 'calendar' && store.state.events.some((x) => x.id === id)) viewEvent(id);
      return;
    }
  }
  if (ui.focusAfter) { const t = $(ui.focusAfter, app); ui.focusAfter = null; if (t) { t.focus(); return; } }
  const target = sig && $(sig, app);
  if (target) target.focus({ preventScroll: true });
  else if (!app.contains(document.activeElement) && !$('#modal').open) $('#main')?.focus({ preventScroll: true });
  maybeCoach(route);
}
// Per-tab onboarding: the first time a household member opens a tab, show its coachmark once (6.1/6.2),
// tracking seen-state independently per tab (6.3). Storage failures are swallowed inside tour.js (6.6).
const COACH_TABS = { home: 'home', chores: 'chores', money: 'money', calendar: 'calendar', profile: 'profile' };
function maybeCoach(route) {
  if (!store.state) return;
  const tab = COACH_TABS[route.parts[0]] || 'home';
  if (coachSeen(storage, tab)) return;
  showCoachmark({ tab, storage, track: (name, props) => store.trackEvent(name, props), onEnd: () => render() });
  markCoachSeen(storage, tab);
}
window.addEventListener('hashchange', () => { endCoachmark(); ui.handled = null; render(); if (!parseRoute().query.id) { window.scrollTo(0, 0); $('#main')?.focus({ preventScroll: true }); } });
narrowMQ.addEventListener('change', () => { if (store.state) render(); });

// ---------- start ----------
initModal();
initMenus();
const res = store.load();
if (!res.ok) loadError = res.error;
store.subscribe(render);
window.addEventListener('storage', (e) => { if (e.key === 'roomsync.v1') { store.load(); render(); } });
setInterval(() => { if (store.state) store.runReminders(); }, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && store.state) store.runReminders(); });
if (store.state) store.runReminders();
render();
window.__roomsync = store; // handy for debugging and automated checks
