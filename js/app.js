import * as L from './logic.js';
import { createStore, STARTER_CHORES } from './store.js';
import { $, $$, esc, plural, ic, toast, field, input, select, segmented, checkGroup, openModal, closeModal, initModal, confirmDialog, showErrors, formData, menu, initMenus } from './ui.js';

// ---------- boot ----------
let storage;
try { storage = window.localStorage; storage.getItem('roomsync.probe'); } catch (e) {
  const m = new Map(); // storage blocked: keep working in memory (the store reports save failures)
  storage = { getItem: (k) => m.get(k) ?? null, setItem: () => { throw new Error('Storage unavailable'); }, removeItem: (k) => m.delete(k) };
}
const store = createStore({ storage });
const app = $('#app');
const ui = { statsWeek: null, calWeek: null, calView: null, open: {}, welcome: null, handled: null };
let loadError = null;

// ---------- small view helpers ----------
const name = (id) => store.nameOf(id);
const who = (id) => (id === store.me() ? 'You' : name(id));
const money = L.fmtMoney;
const today = () => store.today();
const avatar = (id) => `<span class="avatar" aria-hidden="true">${esc((name(id) || '?')[0])}</span>`;
const chip = (kind, icon, text) => `<span class="chip ${kind}">${icon ? ic(icon, 14) : ''}${esc(text)}</span>`;
const empty = (title, text, action = '') => `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}${action}</div>`;
const card = (id, title, body, { link, count } = {}) => `<section class="card" aria-labelledby="h-${id}"><div class="card-head"><h2 id="h-${id}">${esc(title)}${count != null ? `<span class="count">${count}</span>` : ''}</h2>${link ? `<a href="${link[0]}">${esc(link[1])}</a>` : ''}</div><div class="card-body">${body}</div></section>`;
const disclosure = (key, title, body) => `<details class="disclosure" data-key="${key}"${ui.open[key] ? ' open' : ''}><summary><span>${title}</span><span class="chev">${ic('chevron', 18)}</span></summary><div class="disc-body">${body}</div></details>`;
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
function timeOnDay(ev, day, full) {
  const sd = L.dtDate(ev.start), ed = L.dtDate(ev.end);
  if (sd === day && ed === day) return full ? `${L.fmtTime(L.dtTime(ev.start))}–${L.fmtTime(L.dtTime(ev.end))}` : L.fmtTime(L.dtTime(ev.start));
  if (sd === day) return `From ${L.fmtTime(L.dtTime(ev.start))}`;
  if (ed === day) return `Until ${L.fmtTime(L.dtTime(ev.end))}`;
  return 'All day';
}

// ---------- routing ----------
function parseRoute() {
  const [path, qs = ''] = (location.hash.replace(/^#\/?/, '') || 'home').split('?');
  return { parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(qs)) };
}
const afterDelete = () => {
  if (store.undoLabel) toast(store.undoLabel, { action: 'Undo', onAction: () => { store.undoLast(); toast('Restored.'); } });
};

// ---------- chore rows ----------
function dueChip(o) {
  const d = L.diffDays(today(), o.due);
  if (d < 0) return chip('danger', 'alert', `${plural(-d, 'day')} overdue`);
  if (d === 0) return chip('warning', 'clock', 'Due today');
  if (d === 1) return chip('', 'clock', 'Due tomorrow');
  return chip('', 'clock', `Due ${L.fmtDay(o.due)}`);
}
function choreRow(o, { ctx = 'x', details = false, showOwner = true, check = true } = {}) {
  const mine = o.assigneeId === store.me();
  const c = store.sel.chore(o);
  const lead = mine && check
    ? `<button type="button" class="checkbox" role="checkbox" aria-checked="false" data-action="complete" data-id="${o.id}" aria-label="Complete: ${esc(o.title)}"><span class="box">${ic('check', 16)}</span></button>`
    : `<span class="lead-slot">${avatar(o.assigneeId)}</span>`;
  const items = [{ label: 'Edit chore', icon: 'edit', action: 'edit-chore', data: { id: o.id } }];
  if (!mine) items.push({ label: 'Mark done (I did it)', icon: 'check', action: 'complete', data: { id: o.id } }, { label: 'Reassign to me', icon: 'user', action: 'reassign-me', data: { id: o.id } });
  items.push('-', { label: 'Delete chore', icon: 'trash', action: 'delete-chore', data: { id: o.id }, danger: true });
  const next = details && c && c.rotation.length ? `<span>Next: ${esc(who(L.nextAssigneeId(c, o)))}</span>` : '';
  return `<li class="row" id="occ-${o.id}">${lead}<div class="row-main"><div class="row-title">${esc(o.title)}</div>
    <div class="row-meta">${dueChip(o)}${showOwner ? `<span>${mine ? 'You' : esc(name(o.assigneeId))}</span>` : ''}${c && c.recurrence === 'weekly' ? `<span>${ic('repeat', 14)}Weekly</span>` : ''}${next}</div>
    ${details && o.notes ? `<div class="row-note">${esc(o.notes)}</div>` : ''}</div>
    <div class="row-side">${menu({ id: `${ctx}-${o.id}`, label: `More actions for ${o.title}`, items })}</div></li>`;
}
function doneRow(o) {
  const d = L.toDateStr(new Date(o.doneAt)), late = L.diffDays(o.due, d);
  const next = o.nextOccId && store.state.occurrences.find((x) => x.id === o.nextOccId);
  const canUndo = !next || !next.doneAt;
  return `<li class="row" id="occ-${o.id}"><span class="lead-slot"><span class="box done" aria-hidden="true">${ic('check', 16)}</span></span>
    <div class="row-main"><div class="row-title done-title">${esc(o.title)}</div>
    <div class="row-meta"><span>${esc(who(o.doneBy))} · ${L.fmtStamp(o.doneAt)}</span>${late <= 0 ? chip('success', 'check', 'On time') : chip('warning', 'clock', `${plural(late, 'day')} late`)}${o.assigneeId !== o.doneBy ? `<span>Assigned to ${esc(name(o.assigneeId))}</span>` : ''}</div></div>
    <div class="row-side">${canUndo ? `<button type="button" class="btn quiet sm" data-action="undo-complete" data-id="${o.id}" aria-label="Undo completing ${esc(o.title)}">${ic('undo', 16)}Undo</button>` : ''}</div></li>`;
}
function groupPending(list) {
  const t = today(), weekEnd = L.addDays(L.startOfWeek(t), 6);
  const g = [['Overdue', []], ['Today', []], ['Later this week', []], ['Next week and beyond', []]];
  for (const o of list) g[o.due < t ? 0 : o.due === t ? 1 : o.due <= weekEnd ? 2 : 3][1].push(o);
  return g.filter(([, v]) => v.length);
}
const groupLabel = (label, n) => `<div class="group-label${label === 'Overdue' ? ' danger' : ''}">${label === 'Overdue' ? ic('alert', 14) : ''}${esc(label)}<span class="count">${n}</span></div>`;

// ---------- shared pieces ----------
function balanceSummary({ full = false } = {}) {
  const me = store.me(), bal = store.sel.balances()[me] || 0;
  const mine = store.sel.settlements().filter((x) => x.from === me || x.to === me);
  const head = bal === 0 ? `<p class="balance-line settled">${ic('check', 20)}You’re settled up</p>`
    : bal < 0 ? `<p class="balance-line">You owe ${money(-bal)}</p>` : `<p class="balance-line">You’re owed ${money(bal)}</p>`;
  const lines = mine.map((x) => x.from === me
    ? `<li><span>Pay ${esc(name(x.to))} <strong class="money">${money(x.cents)}</strong></span><button type="button" class="btn sm" data-action="add-reimb" data-from="${x.from}" data-to="${x.to}" data-cents="${x.cents}">Record repayment</button></li>`
    : `<li><span>${esc(name(x.from))} owes you <strong class="money">${money(x.cents)}</strong></span></li>`).join('');
  return `${head}${lines ? `<ul class="pay-list">${lines}</ul>` : ''}${full ? '' : '<p class="hint">Based on recorded expenses and repayments.</p>'}`;
}
function shopRowCompact(i) {
  return `<li class="row"><div class="row-main"><div class="row-title">${esc(i.name)} <span class="muted" style="font-weight:400">× ${esc(i.qty)}</span></div>
    <div class="row-meta">${i.buyerId ? `<span>${avatar(i.buyerId)}${esc(who(i.buyerId))} claimed</span>` : '<span>Unclaimed</span>'}</div></div></li>`;
}
function eventRowButton(ev) {
  return `<li class="row"><button type="button" class="cal-item cat-${ev.category}" data-action="view-event" data-id="${ev.id}" style="margin:0"><span class="t">${ic(CAT_ICON[ev.category], 14)}${esc(eventWhen(ev))}</span><span class="n">${esc(ev.title)}</span></button></li>`;
}

// ---------- Home ----------
function viewHome() {
  const s = store.state, t = today(), me = store.me();
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const mine = store.sel.mine();
  const overdueMine = mine.filter((o) => o.due < t), dueToday = mine.filter((o) => o.due === t);
  const upcoming = mine.filter((o) => o.due > t).slice(0, 4);
  const others = store.sel.overdue().filter((o) => o.assigneeId !== me);
  const needed = store.sel.needed();
  const events = store.sel.upcomingEvents(14).slice(0, 4);
  const feed = s.activity.slice(0, 6);
  const list = (arr) => `<ul class="list">${arr.map((o) => choreRow(o, { ctx: 'h', showOwner: false })).join('')}</ul>`;

  let chores = '';
  if (overdueMine.length) chores += groupLabel('Overdue', overdueMine.length) + list(overdueMine);
  if (dueToday.length) chores += groupLabel('Today', dueToday.length) + list(dueToday);
  if (!overdueMine.length && !dueToday.length) chores += `<div class="empty" style="padding-block:16px"><strong>${ic('check', 18)} You’re all caught up today</strong>${upcoming.length ? `Next up: ${esc(upcoming[0].title)}, ${L.fmtDay(upcoming[0].due)}.` : 'Nothing is assigned to you right now.'}</div>`;
  if (upcoming.length) chores += groupLabel('Upcoming', upcoming.length) + list(upcoming);

  const addMenu = menu({ id: 'add', label: 'Add to household', icon: 'plus', text: 'Add', cls: 'btn primary', items: [
    { label: 'Chore', icon: 'chores', action: 'add-chore' }, { label: 'Expense', icon: 'money', action: 'add-expense' },
    { label: 'Shopping item', icon: 'cart', action: 'add-item' }, { label: 'Event', icon: 'calendar', action: 'add-event' }] });

  return `<div class="page-head"><div><h1>${greet}, ${esc(name(me))}</h1><p class="sub">${L.fmtDay(t)} · ${esc(s.household.name)}</p></div><div class="head-actions">${addMenu}</div></div>
  <div class="dash">
    <div class="dash-col">
      <div data-o="1">${card('mine', 'Your chores', chores, { link: ['#/chores/mine', 'All your chores'] })}</div>
      ${others.length ? `<div data-o="5">${card('others', 'Needs attention in the household', `<ul class="list">${others.map((o) => `<li class="row" id="occ-${o.id}"><span class="lead-slot">${avatar(o.assigneeId)}</span><div class="row-main"><div class="row-title"><a href="#/chores/all?id=${o.id}">${esc(o.title)}</a></div><div class="row-meta">${dueChip(o)}<span>${esc(name(o.assigneeId))}</span></div></div></li>`).join('')}</ul>`, { link: ['#/chores/all', 'All chores'] })}</div>` : ''}
      <div data-o="6">${card('act', 'Recent activity', feed.length ? `<ul class="list feed">${feed.map((a) => `<li><a href="${esc(a.link)}"><strong>${esc(who(a.actorId))}</strong> ${esc(a.verb)} ${esc(a.subject)}</a><time datetime="${a.ts}">${ago(a.ts)}</time></li>`).join('')}</ul>` : empty('No activity yet', 'Completed chores, purchases and changes show up here.'))}</div>
    </div>
    <div class="dash-col">
      <div data-o="2">${card('bal', 'Your balance', balanceSummary(), { link: ['#/money/expenses', 'Expenses'] })}</div>
      <div data-o="3">${card('ev', 'Coming up', events.length ? `<ul class="list">${events.map(eventRowButton).join('')}</ul>` : empty('Nothing planned', 'Add quiet time, guests or plans so everyone knows.', '<br><button type="button" class="btn sm" data-action="add-event">Add event</button>'), { link: ['#/calendar', 'Calendar'] })}</div>
      <div data-o="4">${card('shop', 'Shopping list', needed.length ? `<ul class="list">${needed.slice(0, 4).map(shopRowCompact).join('')}</ul>${needed.length > 4 ? `<p class="small muted">+ ${needed.length - 4} more</p>` : ''}` : empty('Nothing needed', 'Add something when the apartment runs low.', '<br><button type="button" class="btn sm" data-action="add-item">Add item</button>'), { link: ['#/money/shopping', 'Open list'], count: needed.length || null })}</div>
    </div>
  </div>`;
}

// ---------- Chores ----------
function viewChores(tab) {
  ui.statsWeek ||= L.startOfWeek(today());
  const stats = store.sel.weekStats(ui.statsWeek), wkEnd = L.addDays(ui.statsWeek, 6);
  const statsBody = `<div class="weeknav" style="margin-bottom:8px"><button type="button" class="icon-btn" data-action="stats-week" data-delta="-7" aria-label="Previous week">${ic('arrowL')}</button><strong>${L.fmtMonthDay(ui.statsWeek)} – ${L.fmtMonthDay(wkEnd)}</strong><button type="button" class="icon-btn" data-action="stats-week" data-delta="7" aria-label="Next week">${ic('arrowR')}</button><button type="button" class="btn quiet sm" data-action="stats-week" data-delta="0">This week</button></div>
    <table><caption class="sr-only">Chores due this week, by roommate</caption><thead><tr><th scope="col">Roommate</th><th scope="col" class="num">Completed</th><th scope="col" class="num">Still open</th></tr></thead><tbody>
    ${stats.map((r) => `<tr><th scope="row">${avatar(r.id)} ${esc(name(r.id))}${r.id === store.me() ? ' (you)' : ''}</th><td class="num">${r.completed}</td><td class="num">${r.pending}</td></tr>`).join('')}</tbody></table>
    <p class="hint">Counts show what’s recorded for chores due that week. They aren’t a fairness score: chores differ in effort and schedules differ.</p>`;
  let body;
  if (tab === 'done') {
    const list = store.sel.done();
    body = card('done', 'Completed', list.length ? `<ul class="list">${list.map(doneRow).join('')}</ul>` : empty('Nothing completed yet', 'Check off a chore and it appears here with who did it and when.'), { count: list.length || null });
  } else {
    const list = tab === 'mine' ? store.sel.mine() : store.sel.pending();
    const groups = groupPending(list);
    body = groups.length ? groups.map(([label, items]) => card(`g-${label.replace(/\W/g, '')}`, label, `<ul class="list">${items.map((o) => choreRow(o, { ctx: tab, details: true, showOwner: tab === 'all' })).join('')}</ul>`, { count: items.length })).join('')
      : card('none', tab === 'mine' ? 'Your chores' : 'Chores', empty(tab === 'mine' ? 'You have no open chores' : 'No open chores', 'Add a chore to give the household something to track.', '<br><button type="button" class="btn primary sm" data-action="add-chore">Add chore</button>'));
  }
  return `<div class="page-head"><div><h1>Chores</h1></div><div class="head-actions"><button type="button" class="btn primary" data-action="add-chore">${ic('plus', 18)}Add chore</button></div></div>
  <nav class="tabs" aria-label="Chore views"><a href="#/chores/mine"${tab === 'mine' ? ' aria-current="page"' : ''}>Mine</a><a href="#/chores/all"${tab === 'all' ? ' aria-current="page"' : ''}>All chores</a><a href="#/chores/done"${tab === 'done' ? ' aria-current="page"' : ''}>Completed</a></nav>
  ${body}${disclosure('stats', 'Weekly counts by roommate', statsBody)}`;
}

// ---------- Expenses & shopping ----------
function viewMoney(tab) {
  const tabsNav = `<nav class="tabs" aria-label="Expenses and shopping"><a href="#/money/expenses"${tab === 'expenses' ? ' aria-current="page"' : ''}>Expenses</a><a href="#/money/shopping"${tab === 'shopping' ? ' aria-current="page"' : ''}>Shopping</a></nav>`;
  if (tab === 'shopping') {
    const needed = store.sel.needed(), bought = store.sel.purchased();
    const row = (i) => {
      const mine = i.buyerId === store.me();
      const primary = !i.buyerId ? `<button type="button" class="btn sm" data-action="claim" data-id="${i.id}" aria-label="Claim ${esc(i.name)}">Claim</button>`
        : `<button type="button" class="btn sm${mine ? ' primary' : ''}" data-action="purchase" data-id="${i.id}" aria-label="Mark ${esc(i.name)} purchased">Purchased</button>`;
      const items = [];
      if (!i.buyerId) items.push({ label: 'Mark purchased', icon: 'check', action: 'purchase', data: { id: i.id } });
      else items.push({ label: mine ? 'Release claim' : `Take over from ${name(i.buyerId)}`, icon: 'user', action: mine ? 'unclaim' : 'takeover', data: { id: i.id } });
      items.push({ label: 'Edit item', icon: 'edit', action: 'edit-item', data: { id: i.id } }, '-', { label: 'Remove item', icon: 'trash', action: 'delete-item', data: { id: i.id }, danger: true });
      return `<li class="row" id="item-${i.id}"><div class="row-main"><div class="row-title">${esc(i.name)} <span class="muted" style="font-weight:400">× ${esc(i.qty)}</span></div>
        <div class="row-meta">${i.buyerId ? `<span>${avatar(i.buyerId)}${esc(who(i.buyerId))} ${i.buyerId === store.me() ? 'are' : 'is'} getting this</span>` : '<span>Unclaimed</span>'}</div>${i.notes ? `<div class="row-note">${esc(i.notes)}</div>` : ''}</div>
        <div class="row-side">${primary}${menu({ id: `s-${i.id}`, label: `More actions for ${i.name}`, items })}</div></li>`;
    };
    const hist = bought.length ? `<ul class="list">${bought.map((i) => `<li class="row" id="item-${i.id}"><div class="row-main"><div class="row-title done-title">${esc(i.name)} <span class="muted" style="font-weight:400">× ${esc(i.qty)}</span></div><div class="row-meta"><span>${esc(who(i.purchasedBy))} · ${L.fmtStamp(i.purchasedAt)}</span>${i.expenseId ? `<a href="#/money/expenses?id=${i.expenseId}">See expense</a>` : '<span>No expense recorded</span>'}</div></div>
      <div class="row-side">${i.expenseId ? '' : `<button type="button" class="btn quiet sm" data-action="reopen-item" data-id="${i.id}" aria-label="Move ${esc(i.name)} back to needed">Needed again</button>`}</div></li>`).join('')}</ul>` : empty('Nothing purchased yet', 'Purchased items are kept here.');
    return `<div class="page-head"><div><h1>Expenses &amp; shopping</h1></div><div class="head-actions"><button type="button" class="btn primary" data-action="add-item">${ic('plus', 18)}Add item</button></div></div>${tabsNav}
      ${card('need', 'Needed', needed.length ? `<ul class="list">${needed.map(row).join('')}</ul>` : empty('Nothing needed right now', 'Add an item when something runs low.', '<br><button type="button" class="btn primary sm" data-action="add-item">Add item</button>'), { count: needed.length })}
      ${disclosure('bought', `Purchased history <span class="count">${bought.length}</span>`, hist)}`;
  }
  const s = store.state, me = store.me(), bal = store.sel.balances();
  const hist = [...s.expenses.map((e) => ({ k: 'e', d: e.date, c: e.createdAt, v: e })), ...s.reimbursements.map((r) => ({ k: 'r', d: r.date, c: r.createdAt, v: r }))].sort((a, b) => b.d.localeCompare(a.d) || b.c.localeCompare(a.c));
  const expRow = (e) => {
    const share = e.splits[me];
    const lines = e.participantIds.map((id) => `<li>${esc(name(id))}: ${money(e.splits[id])}${id === e.payerId ? ' (paid)' : ''}</li>`).join('');
    return `<li class="row" id="exp-${e.id}" style="align-items:flex-start"><div class="row-main"><div class="row-title">${esc(e.description)}</div>
      <div class="row-meta"><span>${esc(who(e.payerId))} paid</span><span>${L.fmtDay(e.date)}</span><span>Split ${e.participantIds.length} ${e.participantIds.length === 1 ? 'way' : 'ways'}</span>${e.shoppingItemId ? chip('', 'cart', 'From shopping list') : ''}</div>
      <details class="inline"><summary>Split details</summary><ul>${lines}</ul></details></div>
      <div class="row-side"><div class="amount">${money(e.amountCents)}<small>${share !== undefined ? `Your share ${money(share)}` : 'Not in split'}</small></div>${menu({ id: `e-${e.id}`, label: `More actions for ${e.description}`, items: [{ label: 'Edit expense', icon: 'edit', action: 'edit-expense', data: { id: e.id } }, '-', { label: 'Delete expense', icon: 'trash', action: 'delete-expense', data: { id: e.id }, danger: true }] })}</div></li>`;
  };
  const reRow = (r) => `<li class="row"><span class="lead-slot">${ic('repeat', 18)}</span><div class="row-main"><div class="row-title">${esc(who(r.fromId))} repaid ${esc(name(r.toId))}</div><div class="row-meta"><span>${L.fmtDay(r.date)}</span><span>Paid outside RoomSync</span>${r.note ? `<span>${esc(r.note)}</span>` : ''}</div></div>
    <div class="row-side"><div class="amount">${money(r.amountCents)}</div>${menu({ id: `r-${r.id}`, label: 'More actions for repayment', items: [{ label: 'Delete repayment', icon: 'trash', action: 'delete-reimb', data: { id: r.id }, danger: true }] })}</div></li>`;
  const balances = `<table><caption class="sr-only">Net balance by roommate</caption><thead><tr><th scope="col">Roommate</th><th scope="col" class="num">Balance</th></tr></thead><tbody>${s.members.map((m) => `<tr><th scope="row">${avatar(m.id)} ${esc(m.name)}${m.id === me ? ' (you)' : ''}</th><td class="num">${bal[m.id] > 0 ? `Is owed ${money(bal[m.id])}` : bal[m.id] < 0 ? `Owes ${money(-bal[m.id])}` : 'Settled up'}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="page-head"><div><h1>Expenses &amp; shopping</h1></div><div class="head-actions"><button type="button" class="btn" data-action="add-reimb">Record repayment</button><button type="button" class="btn primary" data-action="add-expense">${ic('plus', 18)}Add expense</button></div></div>${tabsNav}
    ${card('bal', 'Your balance', balanceSummary({ full: true }) + '<p class="hint">Record a payment you made outside RoomSync. RoomSync doesn’t move money.</p>')}
    ${card('hist', 'Expenses and repayments', hist.length ? `<ul class="list">${hist.map((h) => (h.k === 'e' ? expRow(h.v) : reRow(h.v))).join('')}</ul>` : empty('No expenses yet', 'Add the first shared expense, like utilities or groceries.', '<br><button type="button" class="btn primary sm" data-action="add-expense">Add expense</button>'))}
    ${card('tot', `Household spending in ${L.fmtMonth(today()).split(' ')[0]}`, `<p class="balance-line money">${money(store.sel.monthTotal())}</p><p class="hint">Expenses dated this month. Repayments aren’t counted as spending.</p>`)}
    ${disclosure('balances', 'Everyone’s balance', balances)}`;
}

// ---------- Calendar ----------
const isNarrow = () => window.matchMedia('(max-width: 899px)').matches;
function calEvent(ev, day, full) {
  return `<button type="button" class="cal-item cat-${ev.category}" data-action="view-event" data-id="${ev.id}" id="ev-${ev.id}-${day}"><span class="t">${ic(CAT_ICON[ev.category], 13)}${esc(timeOnDay(ev, day, full))}${full ? ` · ${esc(L.CATEGORIES[ev.category].label)}` : ''}</span><span class="n">${esc(ev.title)}</span>${full ? `<span class="t" style="font-weight:400">${esc(who(ev.creatorId))}</span>` : ''}</button>`;
}
function calChore(o, full = false) {
  return `<a class="cal-item chore${o.doneAt ? ' is-done' : ''}" href="#/chores/${o.doneAt ? 'done' : 'all'}?id=${o.id}"><span class="t">${ic('chores', 13)}${full ? 'Chore · ' : ''}${esc(who(o.assigneeId))}${o.doneAt ? ' · done' : ''}</span><span class="n">${esc(o.title)}</span></a>`;
}
function viewCalendar() {
  ui.calWeek ||= L.startOfWeek(today());
  const view = ui.calView || (isNarrow() ? 'agenda' : 'week');
  const t = today();
  const toggle = `<div class="seg" role="group" aria-label="Calendar view"><label><input type="radio" name="calview" value="agenda" data-action="cal-view" data-view="agenda"${view === 'agenda' ? ' checked' : ''}><span>${ic('list', 16)}&nbsp;Agenda</span></label><label><input type="radio" name="calview" value="week" data-action="cal-view" data-view="week"${view === 'week' ? ' checked' : ''}><span>${ic('calendar', 16)}&nbsp;Week</span></label></div>`;
  let body;
  if (view === 'agenda') {
    const days = [];
    for (let i = 0; i < 21; i++) {
      const d = L.addDays(t, i), evs = store.sel.eventsOn(d), occs = store.sel.occsOn(d);
      if (i === 0 || evs.length || occs.length) days.push({ d, evs, occs });
    }
    const has = days.some((x) => x.evs.length || x.occs.length);
    body = `<section class="card" aria-labelledby="h-ag"><div class="card-head"><h2 id="h-ag">Today and upcoming</h2></div><div class="card-body">${has ? days.map(({ d, evs, occs }) => `<div class="agenda-day"><div class="agenda-date"><strong>${d === t ? 'Today' : L.diffDays(t, d) === 1 ? 'Tomorrow' : L.fmtWeekday(d)}</strong>${L.fmtMonthDay(d)}</div><div class="agenda-items">${evs.map((e) => calEvent(e, d, true)).join('')}${occs.map((o) => calChore(o, true)).join('')}${!evs.length && !occs.length ? '<p class="small muted">Nothing planned</p>' : ''}</div></div>`).join('')
      : empty('Nothing on the calendar', 'Add quiet time, guests, an away day or a household plan.', '<br><button type="button" class="btn primary sm" data-action="add-event">Add event</button>')}</div></section>`;
  } else {
    const days = Array.from({ length: 7 }, (_, i) => L.addDays(ui.calWeek, i));
    body = `<div class="weeknav"><button type="button" class="icon-btn" data-action="cal-week" data-delta="-7" aria-label="Previous week">${ic('arrowL')}</button><strong>${L.fmtMonthDay(days[0])} – ${L.fmtMonthDay(days[6])}</strong><button type="button" class="icon-btn" data-action="cal-week" data-delta="7" aria-label="Next week">${ic('arrowR')}</button><button type="button" class="btn quiet sm" data-action="cal-week" data-delta="0">Today</button></div>
      <div class="week">${days.map((d) => {
        const evs = store.sel.eventsOn(d), occs = store.sel.occsOn(d), none = !evs.length && !occs.length;
        return `<section class="day${d === t ? ' today' : ''}${d < t ? ' past' : ''}${none ? ' empty-day' : ''}" aria-label="${L.fmtDay(d)}"><h3><span>${L.fmtWeekday(d)}${d === t ? ' · Today' : ''}</span><span class="dnum">${parseInt(d.slice(8), 10)}</span></h3>${evs.map((e) => calEvent(e, d, false)).join('')}${occs.map(calChore).join('')}${none ? '<p class="none">Nothing planned</p>' : ''}</section>`;
      }).join('')}</div>`;
  }
  return `<div class="page-head"><div><h1>Calendar</h1></div><div class="head-actions"><button type="button" class="btn primary" data-action="add-event">${ic('plus', 18)}Add event</button></div></div>
    <div class="cal-tools">${toggle}<div class="legend" aria-label="Legend">${Object.keys(L.CATEGORIES).map(catPill).join('')}<span class="chip">${ic('chores', 14)}Chore</span></div></div>${body}`;
}

// ---------- Notifications ----------
function viewNotifications() {
  const list = store.sel.notifications();
  const groups = ['Today', 'Yesterday', 'Earlier'].map((g) => [g, list.filter((n) => dayBucket(n.createdAt) === g)]).filter(([, v]) => v.length);
  const row = (n) => `<li class="notif ${n.read ? 'read' : 'unread'}"><span class="ndot" aria-hidden="true"></span>
    <a class="n-main" href="${esc(n.link)}" data-action="open-notif" data-id="${n.id}"><span class="sr-only">${n.read ? 'Read: ' : 'Unread: '}</span><div class="n-title">${esc(n.title)}</div>${n.body ? `<div class="n-body">${esc(n.body)}</div>` : ''}<time>${ago(n.createdAt)}</time></a>
    ${menu({ id: `n-${n.id}`, label: 'More actions for this notification', items: [{ label: n.read ? 'Mark as unread' : 'Mark as read', icon: 'check', action: 'toggle-read', data: { id: n.id } }] })}</li>`;
  const unread = list.filter((n) => !n.read).length;
  return `<div class="page-head"><div><h1>Notifications</h1><p class="sub">${unread ? `${unread} unread` : 'All caught up'} · for ${esc(name(store.me()))}</p></div><div class="head-actions"><button type="button" class="btn" data-action="read-all"${unread ? '' : ' disabled'}>Mark all read</button><a class="btn quiet" href="#/settings">Reminder settings</a></div></div>
    ${groups.length ? groups.map(([g, items]) => card(`n-${g}`, g, `<ul class="list">${items.map(row).join('')}</ul>`)).join('') : card('n-none', 'Notifications', empty('You’re all caught up', 'Assignments, due dates, new expenses and calendar changes show up here.'))}
    <p class="small muted">Notifications are shown inside RoomSync only. Nothing is sent to phones or email.</p>`;
}

// ---------- Settings ----------
function viewSettings() {
  const s = store.state, p = store.prefsOf(store.me());
  const toggleRow = (nm, label, checked) => `<label class="inline-check"><input type="checkbox" name="${nm}" ${checked ? 'checked' : ''} data-change="pref"> ${label}</label>`;
  return `<div class="page-head"><div><h1>Settings</h1></div></div>
  ${card('hh', 'Household', `<p><strong style="color:var(--color-text)">${esc(s.household.name)}</strong></p><p class="muted small" style="margin-top:4px">${s.members.map((m) => esc(m.name)).join(', ')}</p><p class="small" style="margin-top:12px">${s.mode === 'demo' ? 'This is a demo household with fictional roommates.' : 'Your household.'} Use <strong>Viewing as</strong> in the header to switch between roommates.</p>`)}
  ${card('pref', `Reminders for ${name(store.me())}`, `<form data-inline="prefs">${toggleRow('reminders', 'Remind me when my chores are due soon or overdue', p.reminders)}
    <div class="field" style="max-width:320px;margin-top:8px"><label for="f-leadDays">Remind me</label>${select('leadDays', [[0, 'On the day it’s due'], [1, '1 day before'], [2, '2 days before']], p.leadDays, 'data-change="pref"')}</div>
    ${toggleRow('updates', 'Tell me about assignments, shared expenses and calendar changes', p.updates)}</form><p class="hint">Reminders appear in RoomSync’s notification list while the app is open. Background push, email and text messages aren’t part of this version.</p>`)}
  ${disclosure('proto', 'About this prototype', `<ul class="small" style="margin:0;padding-left:18px"><li>Data is saved in this browser on this device. It doesn’t sync to other devices.</li><li>There are no accounts or invite codes. “Viewing as” switches between the roommates stored here.</li><li>Notifications are in-app only.</li><li>Repayments update RoomSync’s records. RoomSync never moves money.</li></ul>`)}
  ${card('res', 'Research tools', `<p class="small">RoomSync logs basic usage events on this device only (household created, chores assigned and completed, expenses, purchases, calendar events). Nothing is uploaded. ${plural(s.analytics.length, 'event')} recorded.</p><p style="margin-top:12px"><button type="button" class="btn" data-action="export">Download events (JSON)</button></p>`)}
  <section class="card" aria-labelledby="h-danger" style="border-color:var(--color-danger)"><div class="card-head"><h2 id="h-danger" style="color:var(--color-danger)">Danger zone</h2></div><div class="card-body"><p class="small">${s.mode === 'demo' ? 'Resets the demo and returns to the welcome screen.' : 'Permanently deletes this household’s data from this browser.'}</p><p style="margin-top:12px"><button type="button" class="btn danger-outline" data-action="reset">${s.mode === 'demo' ? 'Reset demo' : 'Delete all data'}</button></p></div></section>`;
}

// ---------- Welcome ----------
function viewWelcome() {
  const create = ui.welcome === 'create';
  const rows = [1, 2].map((i) => roommateRow(i)).join('');
  return `<main id="main" class="welcome" tabindex="-1"><div><span class="logo">${ic('home', 22)}</span></div>
  <div><h1>Know what needs to happen, without chasing your roommates.</h1><p class="lead" style="margin-top:8px">Chores, shared expenses, shopping and plans in one place.</p></div>
  <div class="choices"><button type="button" class="choice primary" data-action="start-demo"><span><strong>Try the demo</strong><span class="d">Four sample roommates, ready to explore</span></span></button>
  ${create ? '' : `<button type="button" class="choice" data-action="show-create"><span><strong>Create your household</strong><span class="d">Name your place and add your roommates</span></span></button>`}</div>
  ${create ? `<section class="card" aria-labelledby="h-create"><div class="card-head"><h2 id="h-create">Create your household</h2><button type="button" class="btn quiet sm" data-action="hide-create">Cancel</button></div><div class="card-body">
    <form data-inline="create" novalidate><div class="form-alert" id="form-alert" role="alert" hidden></div>
    ${field('userName', 'Your name', input('userName', '', 'autocomplete="given-name" maxlength="30"'))}
    ${field('householdName', 'Household name', input('householdName', '', 'maxlength="40" placeholder="e.g. Elm Street 3B"'))}
    <fieldset id="grp-others"><legend>Roommates</legend><div id="others">${rows}</div><p class="field-error" id="err-others" hidden></p><button type="button" class="btn sm" data-action="add-roommate" id="add-roommate">${ic('plus', 16)}Add roommate</button><p class="hint">Up to 5 people including you.</p></fieldset>
    <fieldset><legend>Starter chores <span class="opt">(optional)</span></legend><div class="checks">${STARTER_CHORES.map((c) => `<label><input type="checkbox" name="starter[]" value="${c.key}"> ${esc(c.title)}</label>`).join('')}</div><p class="hint">Weekly, rotating between everyone.</p></fieldset>
    <button type="submit" class="btn primary" style="width:100%">Create household</button></form></div></section>` : ''}
  <details class="disclosure"><summary><span>${ic('info', 16)} Saved on this device</span><span class="chev">${ic('chevron', 18)}</span></summary><div class="disc-body"><p class="small">This is a prototype. Your household is stored in this browser only: it doesn’t sync to other phones or laptops, and there are no accounts or invite codes yet. Notifications appear inside the app.</p></div></details></main>`;
}
const roommateRow = (i) => `<div class="roommate-row"><input type="text" name="others[]" aria-label="Roommate ${i} name" maxlength="30" placeholder="Roommate ${i}">${i > 1 ? `<button type="button" class="icon-btn" data-action="remove-roommate" aria-label="Remove roommate ${i}">${ic('x')}</button>` : '<span aria-hidden="true"></span>'}</div>`;
function handleInlineForm(form) {
  if (form.dataset.inline === 'create') {
    const d = formData(form);
    const res = store.createHousehold({ userName: d.userName, householdName: d.householdName, others: d.others || [], starter: d.starter || [] });
    if (!res.ok) return showErrors(form, res.errors);
    ui.welcome = null; location.hash = '#/home';
    toast(`Welcome to ${store.state.household.name}.`);
  }
}

// ---------- Dialog forms ----------
function openChoreForm(occ) {
  const c = occ && store.sel.chore(occ), rotating = !!(c && c.rotation.length);
  const form = openModal({
    title: occ ? 'Edit chore' : 'Add chore', submitLabel: occ ? 'Save changes' : 'Add chore',
    body: `${field('title', 'Chore', input('title', occ ? occ.title : '', 'maxlength="80" aria-required="true" autocomplete="off"'))}
      <div class="row2 stack-sm">${field('assigneeId', 'Assigned to', select('assigneeId', memberOpts(), occ ? occ.assigneeId : store.me()))}${field('due', 'Due date', `<input type="date" id="f-due" name="due" value="${occ ? occ.due : today()}">`)}</div>
      <div class="field"><label id="rec-l">Repeats</label>${segmented('recurrence', [['once', 'One time'], ['weekly', 'Weekly']], c ? c.recurrence : 'once', 'data-change="chore-form"')}</div>
      <div id="rotate-wrap" hidden><label class="inline-check"><input type="checkbox" name="rotate" data-change="chore-form" ${rotating ? 'checked' : ''}> Rotate between roommates</label>
      <div id="rotation-wrap" hidden>${checkGroup('rotation', 'Who’s in the rotation?', store.state.members, rotating ? c.rotation : store.memberIds())}<p class="hint">Each week goes to the next person in household order. You can reassign any single week.</p></div></div>
      ${field('notes', 'Notes', `<textarea id="f-notes" name="notes" maxlength="300">${esc(occ ? occ.notes : '')}</textarea>`, { optional: true })}`,
    onSubmit: (d) => {
      const data = { title: d.title, notes: d.notes, assigneeId: d.assigneeId, due: d.due, recurrence: d.recurrence, rotate: d.recurrence === 'weekly' && 'rotate' in d, rotation: d.rotation || [] };
      const res = occ ? store.editChore(occ.id, data) : store.addChore(data);
      if (res.ok) toast(occ ? 'Chore updated.' : `Added ${data.title.trim()}.`);
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
const memberOpts = () => store.state.members.map((m) => [m.id, m.id === store.me() ? `${m.name} (you)` : m.name]);
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
function openExpenseForm(exp) {
  const form = openModal({
    title: exp ? 'Edit expense' : 'Add expense', submitLabel: exp ? 'Save changes' : 'Add expense',
    body: `<input type="hidden" name="token" value="${Date.now()}-${Math.random().toString(36).slice(2)}">${expenseFields(exp || {})}`,
    onSubmit: (d) => { const res = exp ? store.editExpense(exp.id, expenseData(d)) : store.addExpense(expenseData(d)); if (res.ok) toast(exp ? 'Expense updated.' : 'Expense added.'); return res; },
  });
  updateSplitPreview(form);
}
function openPurchaseForm(item) {
  const form = openModal({
    title: `Mark “${item.name}” purchased`, submitLabel: 'Save purchase and expense',
    body: `<input type="hidden" name="token" value="${Date.now()}-${Math.random().toString(36).slice(2)}">
      <label class="inline-check"><input type="checkbox" name="recordExpense" checked data-change="purchase-form"> Split the cost with roommates</label>
      <div id="expense-fields">${expenseFields({}, { description: item.name, payerId: item.buyerId })}</div>`,
    onSubmit: (d) => {
      const withExpense = 'recordExpense' in d;
      const res = store.purchaseItem(item.id, withExpense ? { expense: expenseData(d) } : {});
      if (res.ok) toast(withExpense ? `Purchased ${item.name} and recorded the expense.` : `Marked ${item.name} purchased.`);
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
    body: `<p class="small" style="margin-bottom:16px">Record a payment you made outside RoomSync. RoomSync doesn’t move money.</p><input type="hidden" name="token" value="${Date.now()}-${Math.random().toString(36).slice(2)}">
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
function openEventForm(ev) {
  const sd = ev ? L.dtDate(ev.start) : today(), ed = ev ? L.dtDate(ev.end) : sd;
  const dt = (n, v) => `<input type="date" id="f-${n}" name="${n}" value="${v}">`, tm = (n, v) => `<input type="time" id="f-${n}" name="${n}" value="${v}">`;
  openModal({
    title: ev ? 'Edit event' : 'Add event', submitLabel: ev ? 'Save changes' : 'Add event',
    body: `${field('title', 'Title', input('title', ev ? ev.title : '', 'maxlength="80" placeholder="e.g. Quiet study time" autocomplete="off"'))}
      ${field('category', 'Type', select('category', Object.entries(L.CATEGORIES).map(([k, v]) => [k, v.hint]), ev ? ev.category : 'quiet'))}
      <div class="row2 stack-sm">${field('startDate', 'Starts', dt('startDate', sd))}${field('startTime', 'Start time', tm('startTime', ev ? L.dtTime(ev.start) : '19:00'))}</div>
      <div class="row2 stack-sm">${field('endDate', 'Ends', dt('endDate', ed))}${field('endTime', 'End time', tm('endTime', ev ? L.dtTime(ev.end) : '21:00'))}</div>
      ${field('notes', 'Notes', `<textarea id="f-notes" name="notes" maxlength="300">${esc(ev ? ev.notes : '')}</textarea>`, { optional: true })}`,
    onSubmit: (d) => {
      const res = ev ? store.editEvent(ev.id, d) : store.addEvent(d);
      if (res.ok) toast(ev ? 'Event updated.' : 'Event added. Roommates see it in their notifications.');
      else if (res.errors) { const e = res.errors; res.errors = { ...e, ...(e.start ? { startDate: e.start } : {}), ...(e.end ? { endDate: e.end } : {}) }; delete res.errors.start; delete res.errors.end; }
      return res;
    },
  });
}
function viewEvent(id) {
  const ev = store.state.events.find((x) => x.id === id);
  if (!ev) return;
  const mine = ev.creatorId === store.me();
  openModal({
    title: ev.title,
    body: `<p>${catPill(ev.category)}</p><p style="margin-top:12px"><strong style="color:var(--color-text)">${esc(L.describeEventTime(ev))}</strong><br><span class="small">Added by ${esc(who(ev.creatorId))}</span></p>${ev.notes ? `<p style="margin-top:12px">${esc(ev.notes)}</p>` : ''}
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
  complete: (d) => {
    const o = byId(store.state.occurrences, d.id); if (!o) return;
    if (store.completeChore(d.id).ok) toast(`Completed ${o.title}.`, { action: 'Undo', onAction: () => { const r = store.undoComplete(d.id); toast(r.ok ? `${o.title} is open again.` : r.error, { error: !r.ok }); } });
  },
  'undo-complete': (d) => { const r = store.undoComplete(d.id); toast(r.ok ? 'Chore is open again.' : r.error, { error: !r.ok }); },
  'reassign-me': (d) => { const o = byId(store.state.occurrences, d.id); if (store.reassignChore(d.id, store.me()).ok) toast(`${o.title} is now assigned to you.`); },
  'delete-chore': (d) => { const o = byId(store.state.occurrences, d.id); confirmDialog({ title: 'Delete this chore?', message: `<strong>${esc(o.title)}</strong> and its upcoming occurrences will be removed. Completed history is kept.`, confirmLabel: 'Delete chore', onConfirm: () => { store.deleteChore(d.id); afterDelete(); } }); },
  'stats-week': (d) => { ui.statsWeek = Number(d.delta) === 0 ? L.startOfWeek(today()) : L.addDays(ui.statsWeek, Number(d.delta)); render(); },
  'cal-week': (d) => { ui.calWeek = Number(d.delta) === 0 ? L.startOfWeek(today()) : L.addDays(ui.calWeek, Number(d.delta)); render(); },
  'cal-view': (d) => { ui.calView = d.view; render(); },
  'add-expense': () => openExpenseForm(null),
  'edit-expense': (d) => openExpenseForm(byId(store.state.expenses, d.id)),
  'delete-expense': (d) => { const e = byId(store.state.expenses, d.id); confirmDialog({ title: 'Delete this expense?', message: `<strong>${esc(e.description)}</strong> (${money(e.amountCents)}) will be removed and balances recalculated.`, confirmLabel: 'Delete expense', onConfirm: () => { store.deleteExpense(d.id); afterDelete(); } }); },
  'add-reimb': (d) => openReimbForm({ from: d.from, to: d.to, cents: d.cents ? Number(d.cents) : 0 }),
  'delete-reimb': () => {}, // replaced below (needs the id)
  'add-item': () => openItemForm(null),
  'edit-item': (d) => openItemForm(byId(store.state.shopping, d.id)),
  'delete-item': (d) => { const i = byId(store.state.shopping, d.id); confirmDialog({ title: 'Remove this item?', message: `Remove <strong>${esc(i.name)}</strong> from the shopping list?`, confirmLabel: 'Remove item', onConfirm: () => { store.deleteItem(d.id); afterDelete(); } }); },
  claim: (d) => { const r = store.claimItem(d.id); toast(r.ok ? 'You’re getting this one.' : r.error || 'Could not claim.', { error: !r.ok }); },
  unclaim: (d) => { store.claimItem(d.id, false); },
  takeover: (d) => { const i = byId(store.state.shopping, d.id); store.claimItem(d.id, false); store.claimItem(d.id, true); toast(`You’re now getting ${i.name}.`); },
  purchase: (d) => openPurchaseForm(byId(store.state.shopping, d.id)),
  'reopen-item': (d) => { store.reopenItem(d.id); },
  'add-event': () => openEventForm(null),
  'view-event': (d) => viewEvent(d.id),
  'edit-event': (d) => { closeModal(); openEventForm(byId(store.state.events, d.id)); },
  'delete-event': (d) => { const ev = byId(store.state.events, d.id); closeModal(); confirmDialog({ title: 'Delete this event?', message: `<strong>${esc(ev.title)}</strong> will be removed from the calendar and your roommates will be notified.`, confirmLabel: 'Delete event', onConfirm: () => { store.deleteEvent(d.id); afterDelete(); } }); },
  'open-notif': (d) => store.setRead(d.id, true),
  'toggle-read': (d) => { const n = byId(store.state.notifications, d.id); store.setRead(d.id, !n.read); },
  'read-all': () => store.markAllRead(),
  export: () => {
    const blob = new Blob([store.exportAnalytics()], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'roomsync-test-events.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  reset: () => confirmDialog({ title: store.state.mode === 'demo' ? 'Reset the demo?' : 'Delete all data?', message: 'This permanently removes this household’s data from this browser.', confirmLabel: 'Delete everything', onConfirm: () => { store.reset(); ui.welcome = null; location.hash = '#/home'; } }),
  'retry-load': () => { store.reset(); render(); },
};
actions['delete-reimb'] = (d) => confirmDialog({ title: 'Delete this repayment?', message: 'Balances will be recalculated. RoomSync never moved any money, so this only changes the record.', confirmLabel: 'Delete repayment', onConfirm: () => { store.deleteReimbursement(d.id); afterDelete(); } });

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
  else if (k === 'purchase-form') { const on = el.checked; $('#expense-fields', el.form).hidden = !on; $('[data-submit]', el.form).textContent = on ? 'Save purchase and expense' : 'Mark purchased'; }
  else if (k === 'pref') { const f = el.form; store.setPrefs({ reminders: f.elements.reminders.checked, leadDays: Number(f.elements.leadDays.value), updates: f.elements.updates.checked }); toast('Preferences saved.'); }
  else if (el.name === 'participantIds[]' && el.form) updateSplitPreview(el.form);
});
document.addEventListener('input', (e) => { if (e.target.hasAttribute?.('data-preview')) updateSplitPreview(e.target.form); });
document.addEventListener('toggle', (e) => { const k = e.target.dataset?.key; if (k) ui.open[k] = e.target.open; }, true);
document.addEventListener('submit', (e) => { const f = e.target; if (f.dataset.inline) { e.preventDefault(); handleInlineForm(f); } });

// ---------- shell & render ----------
const NAV = [['home', '#/home', 'Home', 'home', 'Home', 'Home'], ['chores', '#/chores/mine', 'Chores', 'chores', 'Chores', 'Chores'], ['money', '#/money/expenses', 'Expenses & Shopping', 'money', 'Expenses & Shopping', 'Expenses'], ['calendar', '#/calendar', 'Calendar', 'calendar', 'Calendar', 'Calendar']];
const TITLES = { home: 'Home', chores: 'Chores', money: 'Expenses & Shopping', calendar: 'Calendar', notifications: 'Notifications', settings: 'Settings' };
function render() {
  const route = parseRoute();
  const a = document.activeElement;
  const sig = a && app.contains(a) ? (a.dataset.action ? `[data-action="${a.dataset.action}"]${a.dataset.id ? `[data-id="${a.dataset.id}"]` : ''}` : a.id ? `#${a.id}` : null) : null;
  if (!store.state) { app.innerHTML = loadError ? viewLoadError() : viewWelcome(); document.title = 'RoomSync'; return; }
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
  const key = TITLES[section] ? section : 'home';
  const unread = store.sel.unread(), s = store.state;
  const navLinks = (side) => NAV.map(([k, href, label, icon, , short]) => `<a ${side ? 'class="nav"' : ''} href="${href}"${k === key ? ' aria-current="page"' : ''} aria-label="${esc(label)}">${ic(icon, 22)}${side ? `<span>${label}</span>` : `<span aria-hidden="true">${short}</span>`}</a>`).join('');
  const modeLabel = s.mode === 'demo' ? 'Demo' : 'Local';
  app.innerHTML = `<div class="shell">
    <aside class="sidebar"><a class="brand" href="#/home"><span class="logo">${ic('home', 18)}</span>RoomSync</a><nav aria-label="Primary">${navLinks(true)}</nav><div class="side-foot"><strong>${esc(s.household.name)}</strong>${s.members.length} roommates</div></aside>
    <div class="main-col">
      <header class="topbar"><a class="brand" href="#/home"><span class="logo">${ic('home', 16)}</span><span>${esc(s.household.name)}</span></a>
        <div class="viewer"><label class="viewer-label" for="switch-user">Viewing as</label>${avatar(s.currentUserId)}<select id="switch-user" data-change="switch-user">${s.members.map((m) => `<option value="${m.id}"${m.id === s.currentUserId ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
        <a class="icon-link" href="#/notifications" aria-label="Notifications${unread ? `, ${unread} unread` : ''}"${key === 'notifications' ? ' aria-current="page"' : ''}>${ic('bell', 22)}${unread ? `<span class="badge-count" aria-hidden="true">${unread > 9 ? '9+' : unread}</span>` : ''}</a>
        <a class="icon-link" href="#/settings" aria-label="Settings"${key === 'settings' ? ' aria-current="page"' : ''}>${ic('gear', 22)}</a></header>
      ${store.saveError ? `<div class="banner-error" role="alert">Couldn’t save to this browser (storage may be full or blocked). Recent changes will be lost if you close or refresh this page.</div>` : ''}
      <main id="main" tabindex="-1">
        <div class="statusbar"><details class="status"><summary>${ic('info', 14)}<span class="dot" aria-hidden="true"></span>${modeLabel} · Saved on this device</summary><div class="panel"><strong style="color:var(--color-text)">${s.mode === 'demo' ? 'Demo household' : 'Local household'}</strong><ul><li>Everything is stored in this browser. It doesn’t sync to other devices.</li><li>“Viewing as” previews each roommate. There are no accounts yet.</li><li>Notifications show inside RoomSync only.</li></ul></div></details></div>
        ${page}</main></div>
    <nav class="bottomnav" aria-label="Primary">${navLinks(false)}</nav></div>`;
  document.title = `${TITLES[key]} · RoomSync`;
  afterRender(route, sig);
}
function viewLoadError() {
  return `<main id="main" class="welcome" tabindex="-1"><h1>We couldn’t read your saved data</h1><p class="lead">${esc(loadError)}</p><button type="button" class="btn danger" data-action="retry-load">Clear saved data and start fresh</button></main>`;
}
function afterRender(route, sig) {
  const hash = location.hash;
  const fresh = ui.handled !== hash;
  if (fresh) {
    ui.handled = hash;
    const id = route.query.id;
    if (id) {
      const el = document.getElementById(`occ-${id}`) || document.getElementById(`exp-${id}`) || document.getElementById(`item-${id}`);
      if (el) { el.classList.add('flash'); el.scrollIntoView({ block: 'center' }); const d = $('details', el); if (d) d.open = true; }
      if (route.parts[0] === 'calendar' && store.state.events.some((x) => x.id === id)) viewEvent(id);
      return;
    }
  }
  const target = sig && $(sig, app);
  if (target) target.focus({ preventScroll: true });
  else if (!app.contains(document.activeElement) && !$('#modal').open) $('#main')?.focus({ preventScroll: true });
}
window.addEventListener('hashchange', () => { ui.handled = null; render(); if (!parseRoute().query.id) { window.scrollTo(0, 0); $('#main')?.focus({ preventScroll: true }); } });

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
