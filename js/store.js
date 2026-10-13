// RoomSync data layer. Framework-free; storage is injected so it runs in the browser (localStorage)
// and in Node tests (in-memory). All data lives in ONE browser (no server) — see README.
import * as L from './logic.js';

export const STORAGE_KEY = 'roomsync.v1';
export const STARTER_CHORES = [
  { key: 'trash', title: 'Take out trash & recycling' },
  { key: 'kitchen', title: 'Clean kitchen' },
  { key: 'vacuum', title: 'Vacuum common areas' },
  { key: 'bathroom', title: 'Clean bathroom' },
];

export function createStore({ storage, now = () => new Date() } = {}) {
  let state = null;
  let counter = 0;
  let undoSlot = null;
  let saveError = null;
  let storageBroken = false;
  const subs = new Set();

  const today = () => L.toDateStr(now());
  const nowISO = () => now().toISOString();
  const nowLocal = () => L.toDateTimeStr(now());
  const uid = (p) => `${p}_${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const emit = () => subs.forEach((fn) => fn());

  // ---------- persistence ----------
  function load() {
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) { state = null; return { ok: true }; }
      const s = JSON.parse(raw);
      if (!s || s.version !== 1 || !s.household || !Array.isArray(s.members)) throw new Error('Saved data was not recognized.');
      state = s;
      return { ok: true };
    } catch (e) {
      state = null;
      if (e instanceof SyntaxError || /recognized/.test(e.message)) return { ok: false, error: e.message };
      storageBroken = true; saveError = e;
      return { ok: true };
    }
  }
  function save() {
    try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); saveError = null; return true; }
    catch (e) { saveError = e; return false; }
  }
  function commit() { generateReminders(); save(); emit(); }
  /** Run a mutation, then persist + notify. `undoable` snapshots state for a one-step "Undo". */
  function mutate(fn, undoable) {
    const before = undoable ? JSON.stringify(state) : null;
    const res = fn();
    undoSlot = undoable ? { label: undoable, before } : null;
    commit();
    return res;
  }

  // ---------- small helpers ----------
  const me = () => state.currentUserId;
  const memberIds = () => state.members.map((m) => m.id);
  const isMember = (id) => state.members.some((m) => m.id === id);
  const nameOf = (id) => (state.members.find((m) => m.id === id) || { name: 'Former roommate' }).name;
  const ordered = (ids) => memberIds().filter((id) => ids.includes(id)); // household order
  const prefsOf = (id) => ({ reminders: true, leadDays: 1, updates: true, ...(state.prefs[id] || {}) });
  const track = (name, props = {}) => {
    state.analytics.push({ t: nowISO(), name, userId: state.currentUserId, props });
    if (state.analytics.length > 2000) state.analytics.splice(0, state.analytics.length - 2000);
  };
  const logActivity = (verb, subject, link, ref) => {
    state.activity.unshift({ id: uid('act'), actorId: me(), verb, subject, link, ref: ref || null, ts: nowISO() });
    if (state.activity.length > 300) state.activity.length = 300;
  };
  const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');

  /** Create a notification for each user (never the actor). Dedupes on (user, key). */
  function notify(userIds, { type, title, body, link, key }, { reminder = false, includeActor = false } = {}) {
    for (const uidv of userIds) {
      if (!isMember(uidv) || (!includeActor && uidv === me())) continue;
      const p = prefsOf(uidv);
      if (reminder ? !p.reminders : !p.updates) continue;
      if (key && state.notifications.some((n) => n.userId === uidv && n.key === key)) continue;
      state.notifications.unshift({ id: uid('n'), userId: uidv, type, title, body: body || '', link: link || '#/home', key: key || null, read: false, createdAt: nowISO() });
    }
    if (state.notifications.length > 500) state.notifications.length = 500;
  }
  const dropReminders = (occId) => {
    state.notifications = state.notifications.filter((n) => !(n.key && (n.key === `due:${occId}` || n.key === `overdue:${occId}`) && !n.read));
  };

  /** In-app reminders only: evaluated while the app is open. Deduped by (user, key). */
  function generateReminders() {
    if (!state) return 0;
    const t = today();
    let created = 0;
    for (const occ of state.occurrences) {
      if (occ.doneAt || !isMember(occ.assigneeId)) continue;
      const p = prefsOf(occ.assigneeId);
      if (!p.reminders) continue;
      const days = L.diffDays(t, occ.due);
      let key = null, title = '';
      if (days < 0) { key = `overdue:${occ.id}`; title = `"${occ.title}" is overdue`; }
      else if (days <= p.leadDays) { key = `due:${occ.id}`; title = `"${occ.title}" is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : L.fmtDay(occ.due)}`; }
      if (!key) continue;
      if (state.notifications.some((n) => n.userId === occ.assigneeId && n.key === key)) continue;
      state.notifications.unshift({ id: uid('n'), userId: occ.assigneeId, type: days < 0 ? 'chore_overdue' : 'chore_due', title, body: 'Friendly reminder from RoomSync.', link: `#/chores/all?id=${occ.id}`, key, read: false, createdAt: nowISO() });
      created++;
    }
    return created;
  }

  // ---------- onboarding ----------
  function blank(mode, hhName, names) {
    const members = names.map((n) => ({ id: uid('u'), name: n }));
    return {
      version: 1, mode,
      household: { id: uid('hh'), name: hhName, createdAt: nowISO() },
      members, currentUserId: members[0].id,
      chores: [], occurrences: [], expenses: [], reimbursements: [], shopping: [], events: [],
      notifications: [], activity: [], prefs: {}, analytics: [],
    };
  }

  function createHousehold({ userName, householdName, others = [], starter = [] }) {
    const errors = {};
    const names = [trimmed(userName), ...others.map(trimmed).filter(Boolean)];
    if (!names[0]) errors.userName = 'Enter your name.';
    if (!trimmed(householdName)) errors.householdName = 'Give your household a name.';
    if (names.some((n) => n.length > 30)) errors.others = 'Names can be up to 30 characters.';
    else if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) errors.others = 'Each roommate needs a different name.';
    else if (names.length < 2) errors.others = 'Add at least one roommate.';
    else if (names.length > 5) errors.others = 'RoomSync supports up to 5 roommates.';
    if (Object.keys(errors).length) return { ok: false, errors };
    state = blank('local', trimmed(householdName), names);
    const t = today();
    STARTER_CHORES.filter((c) => starter.includes(c.key)).forEach((c, i) => {
      const rotation = memberIds();
      const choreId = uid('c');
      state.chores.push({ id: choreId, title: c.title, notes: '', recurrence: 'weekly', rotation, createdBy: me(), createdAt: nowISO() });
      state.occurrences.push({ id: uid('o'), choreId, title: c.title, notes: '', due: L.addDays(t, 1 + i), assigneeId: rotation[i % rotation.length], rotIdx: i % rotation.length, doneBy: null, doneAt: null, nextOccId: null });
    });
    track('household_created', { members: names.length, starterChores: starter.length });
    commit();
    return { ok: true };
  }

  function reset() {
    try { storage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    state = null; undoSlot = null; emit();
  }
  function setCurrentUser(id) {
    if (!isMember(id)) return;
    state.currentUserId = id; save(); emit();
  }

  // ---------- chores ----------
  function validateChore(d) {
    const e = {};
    const title = trimmed(d.title);
    if (!title) e.title = 'Give the chore a title.';
    else if (title.length > 80) e.title = 'Keep the title under 80 characters.';
    if (!isMember(d.assigneeId)) e.assigneeId = 'Choose who is responsible.';
    if (!L.isValidDate(d.due)) e.due = 'Choose a due date.';
    if (!['once', 'weekly'].includes(d.recurrence)) e.recurrence = 'Choose one-time or weekly.';
    const rot = d.recurrence === 'weekly' ? ordered(d.rotation || []) : [];
    if (d.rotate && d.recurrence === 'weekly' && rot.length < 2) e.rotation = 'Pick at least two roommates to rotate between.';
    if (trimmed(d.notes).length > 300) e.notes = 'Keep notes under 300 characters.';
    return { e, title, rotation: d.rotate ? rot : [] };
  }

  function addChore(d) {
    const { e, title, rotation } = validateChore(d);
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      const choreId = uid('c'), occId = uid('o');
      state.chores.push({ id: choreId, title, notes: trimmed(d.notes), recurrence: d.recurrence, rotation, createdBy: me(), createdAt: nowISO() });
      state.occurrences.push({ id: occId, choreId, title, notes: trimmed(d.notes), due: d.due, assigneeId: d.assigneeId, rotIdx: rotation.indexOf(d.assigneeId), doneBy: null, doneAt: null, nextOccId: null });
      track('chore_assigned', { assigneeId: d.assigneeId, recurrence: d.recurrence, rotating: rotation.length > 0 });
      logActivity('added chore', title, `#/chores/all?id=${occId}`);
      notify([d.assigneeId], { type: 'chore_assigned', title: `New chore for you: ${title}`, body: `${nameOf(me())} assigned this to you · ${L.relativeDue(d.due, today())}`, link: `#/chores/all?id=${occId}`, key: `assign:${occId}:${d.assigneeId}` });
      return { ok: true, id: occId };
    });
  }

  function editChore(occId, d) {
    const occ = state.occurrences.find((o) => o.id === occId);
    if (!occ || occ.doneAt) return { ok: false, errors: { _: 'This chore is no longer open.' } };
    const chore = state.chores.find((c) => c.id === occ.choreId);
    const { e, title, rotation } = validateChore(d);
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      const prevAssignee = occ.assigneeId;
      if (chore) {
        const rotChanged = chore.rotation.join() !== rotation.join();
        Object.assign(chore, { title, notes: trimmed(d.notes), recurrence: d.recurrence, rotation });
        if (rotChanged) occ.rotIdx = rotation.indexOf(d.assigneeId);
      }
      Object.assign(occ, { title, notes: trimmed(d.notes), due: d.due, assigneeId: d.assigneeId });
      // keep other open occurrences of this chore (none normally) in sync on title only
      logActivity('updated chore', title, `#/chores/all?id=${occ.id}`);
      if (prevAssignee !== d.assigneeId) {
        track('chore_assigned', { assigneeId: d.assigneeId, reassigned: true });
        notify([d.assigneeId], { type: 'chore_assigned', title: `Chore assigned to you: ${title}`, body: `${nameOf(me())} updated this chore · ${L.relativeDue(d.due, today())}`, link: `#/chores/all?id=${occ.id}`, key: `assign:${occ.id}:${d.assigneeId}` });
      }
      return { ok: true };
    });
  }

  function reassignChore(occId, assigneeId) {
    const occ = state.occurrences.find((o) => o.id === occId);
    if (!occ || occ.doneAt || !isMember(assigneeId) || occ.assigneeId === assigneeId) return { ok: false };
    return mutate(() => {
      occ.assigneeId = assigneeId;
      track('chore_assigned', { assigneeId, reassigned: true });
      logActivity('reassigned', `${occ.title} to ${nameOf(assigneeId)}`, `#/chores/all?id=${occ.id}`);
      notify([assigneeId], { type: 'chore_assigned', title: `Chore assigned to you: ${occ.title}`, body: `${nameOf(me())} reassigned this · ${L.relativeDue(occ.due, today())}`, link: `#/chores/all?id=${occ.id}`, key: `assign:${occ.id}:${assigneeId}` });
      return { ok: true };
    });
  }

  function completeChore(occId) {
    const occ = state.occurrences.find((o) => o.id === occId);
    if (!occ || occ.doneAt) return { ok: false }; // double-tap safe
    return mutate(() => {
      const t = today();
      occ.doneBy = me(); occ.doneAt = nowISO();
      dropReminders(occ.id);
      const chore = state.chores.find((c) => c.id === occ.choreId);
      let next = null;
      if (chore && chore.recurrence === 'weekly' && !occ.nextOccId) {
        const due = L.nextDue(occ.due, t);
        next = {
          id: uid('o'), choreId: chore.id, title: chore.title, notes: chore.notes, due,
          assigneeId: isMember(L.nextAssigneeId(chore, occ)) ? L.nextAssigneeId(chore, occ) : occ.assigneeId,
          rotIdx: L.nextRotIdx(chore, occ), doneBy: null, doneAt: null, nextOccId: null,
        };
        state.occurrences.push(next);
        occ.nextOccId = next.id;
      }
      track('chore_completed', { onTime: t <= occ.due, due: occ.due, completedAt: occ.doneAt, assigneeId: occ.assigneeId });
      logActivity('completed', occ.title, '#/chores/done', occ.id);
      if (next) notify([next.assigneeId], { type: 'chore_assigned', title: `You're up next: ${next.title}`, body: `Due ${L.fmtDay(next.due)} (weekly rotation)`, link: `#/chores/all?id=${next.id}`, key: `assign:${next.id}:${next.assigneeId}` });
      return { ok: true };
    });
  }

  function undoComplete(occId) {
    const occ = state.occurrences.find((o) => o.id === occId);
    if (!occ || !occ.doneAt) return { ok: false };
    const next = occ.nextOccId && state.occurrences.find((o) => o.id === occ.nextOccId);
    if (next && next.doneAt) return { ok: false, error: 'The next occurrence is already completed, so this one can’t be undone.' };
    return mutate(() => {
      if (next) {
        state.occurrences = state.occurrences.filter((o) => o.id !== next.id);
        state.notifications = state.notifications.filter((n) => !(n.key && n.key.includes(next.id)));
      }
      occ.doneBy = null; occ.doneAt = null; occ.nextOccId = null;
      state.activity = state.activity.filter((a) => !(a.ref === occ.id && a.verb === 'completed'));
      return { ok: true };
    });
  }

  function deleteChore(occId) {
    const occ = state.occurrences.find((o) => o.id === occId);
    if (!occ) return { ok: false };
    const title = occ.title;
    return mutate(() => {
      const open = state.occurrences.filter((o) => o.choreId === occ.choreId && !o.doneAt).map((o) => o.id);
      state.occurrences = state.occurrences.filter((o) => !open.includes(o.id));
      state.chores = state.chores.filter((c) => c.id !== occ.choreId);
      state.notifications = state.notifications.filter((n) => !(n.key && open.some((id) => n.key.includes(id))));
      logActivity('deleted chore', title, '#/chores/all');
      return { ok: true };
    }, `Deleted “${title}”`);
  }

  // ---------- expenses ----------
  function buildExpense(d) {
    const e = {};
    const description = trimmed(d.description);
    const cents = L.parseMoney(String(d.amount ?? ''));
    if (!description) e.description = 'Describe what this was for.';
    else if (description.length > 80) e.description = 'Keep the description under 80 characters.';
    if (cents === null) e.amount = 'Enter an amount greater than $0 (for example 24.50).';
    if (!L.isValidDate(d.date)) e.date = 'Choose a date.';
    if (!isMember(d.payerId)) e.payerId = 'Choose who paid.';
    const participantIds = ordered(d.participantIds || []);
    if (!participantIds.length) e.participantIds = 'Pick at least one person to split with.';
    if (Object.keys(e).length) return { e };
    return { e, description, cents, participantIds, splits: L.splitEqual(cents, participantIds) };
  }
  function insertExpense(b, d, extra = {}) {
    const exp = { id: uid('e'), description: b.description, amountCents: b.cents, date: d.date, payerId: d.payerId, participantIds: b.participantIds, splits: b.splits, createdBy: me(), createdAt: nowISO(), ...extra };
    state.expenses.push(exp);
    track('expense_created', { amountCents: b.cents, participants: b.participantIds.length, linkedToShopping: !!extra.shoppingItemId });
    logActivity('added expense', `${b.description} (${L.fmtMoney(b.cents)})`, `#/money/expenses?id=${exp.id}`);
    for (const pid of b.participantIds) {
      notify([pid], { type: 'expense', title: `New shared expense: ${b.description}`, body: `${nameOf(d.payerId)} paid ${L.fmtMoney(b.cents)} · your share ${L.fmtMoney(b.splits[pid])}`, link: `#/money/expenses?id=${exp.id}` });
    }
    return exp;
  }
  function addExpense(d) {
    const b = buildExpense(d);
    if (Object.keys(b.e).length) return { ok: false, errors: b.e };
    if (d.token && state.expenses.some((x) => x.token === d.token)) return { ok: true, duplicate: true };
    return mutate(() => ({ ok: true, id: insertExpense(b, d, d.token ? { token: d.token } : {}).id }));
  }
  function editExpense(id, d) {
    const exp = state.expenses.find((x) => x.id === id);
    if (!exp) return { ok: false, errors: { _: 'Expense not found.' } };
    const b = buildExpense(d);
    if (Object.keys(b.e).length) return { ok: false, errors: b.e };
    return mutate(() => {
      Object.assign(exp, { description: b.description, amountCents: b.cents, date: d.date, payerId: d.payerId, participantIds: b.participantIds, splits: b.splits, updatedAt: nowISO() });
      logActivity('edited expense', `${b.description} (${L.fmtMoney(b.cents)})`, `#/money/expenses?id=${exp.id}`);
      notify(b.participantIds, { type: 'expense', title: `Expense updated: ${b.description}`, body: `${nameOf(exp.payerId)} paid ${L.fmtMoney(b.cents)}`, link: `#/money/expenses?id=${exp.id}` });
      return { ok: true };
    });
  }
  function deleteExpense(id) {
    const exp = state.expenses.find((x) => x.id === id);
    if (!exp) return { ok: false };
    return mutate(() => {
      state.expenses = state.expenses.filter((x) => x.id !== id);
      state.shopping.forEach((s) => { if (s.expenseId === id) s.expenseId = null; });
      logActivity('deleted expense', exp.description, '#/money/expenses');
      return { ok: true };
    }, `Deleted expense “${exp.description}”`);
  }

  function addReimbursement(d) {
    const e = {};
    const cents = L.parseMoney(String(d.amount ?? ''));
    if (!isMember(d.fromId)) e.fromId = 'Choose who paid.';
    if (!isMember(d.toId)) e.toId = 'Choose who received it.';
    if (isMember(d.fromId) && d.fromId === d.toId) e.toId = 'Pick two different people.';
    if (cents === null) e.amount = 'Enter an amount greater than $0.';
    if (!L.isValidDate(d.date)) e.date = 'Choose a date.';
    if (Object.keys(e).length) return { ok: false, errors: e };
    if (d.token && state.reimbursements.some((x) => x.token === d.token)) return { ok: true, duplicate: true };
    return mutate(() => {
      const r = { id: uid('r'), fromId: d.fromId, toId: d.toId, amountCents: cents, date: d.date, note: trimmed(d.note), createdBy: me(), createdAt: nowISO(), ...(d.token ? { token: d.token } : {}) };
      state.reimbursements.push(r);
      logActivity('recorded a payback', `${nameOf(r.fromId)} → ${nameOf(r.toId)} ${L.fmtMoney(cents)}`, '#/money/expenses');
      notify([r.fromId, r.toId], { type: 'expense', title: `Payback recorded: ${nameOf(r.fromId)} → ${nameOf(r.toId)}`, body: `${L.fmtMoney(cents)} paid outside RoomSync`, link: '#/money/expenses' });
      return { ok: true };
    });
  }
  function deleteReimbursement(id) {
    const r = state.reimbursements.find((x) => x.id === id);
    if (!r) return { ok: false };
    return mutate(() => { state.reimbursements = state.reimbursements.filter((x) => x.id !== id); return { ok: true }; }, 'Deleted recorded payback');
  }

  // ---------- shopping ----------
  function validateItem(d) {
    const e = {};
    const name = trimmed(d.name);
    if (!name) e.name = 'What do you need?';
    else if (name.length > 60) e.name = 'Keep the name under 60 characters.';
    const qty = trimmed(d.qty) || '1';
    if (qty.length > 20) e.qty = 'Keep quantity short (for example 2 or 1 pack).';
    if (d.buyerId && !isMember(d.buyerId)) e.buyerId = 'Choose a roommate.';
    return { e, name, qty };
  }
  function addItem(d) {
    const { e, name, qty } = validateItem(d);
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      state.shopping.push({ id: uid('s'), name, qty, notes: trimmed(d.notes), buyerId: d.buyerId || null, status: 'needed', purchasedBy: null, purchasedAt: null, expenseId: null, createdBy: me(), createdAt: nowISO() });
      logActivity('added to shopping list', name, '#/money/shopping');
      return { ok: true };
    });
  }
  function editItem(id, d) {
    const item = state.shopping.find((s) => s.id === id);
    const { e, name, qty } = validateItem(d);
    if (!item) return { ok: false, errors: { _: 'Item not found.' } };
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => { Object.assign(item, { name, qty, notes: trimmed(d.notes), buyerId: d.buyerId || null }); return { ok: true }; });
  }
  function deleteItem(id) {
    const item = state.shopping.find((s) => s.id === id);
    if (!item) return { ok: false };
    return mutate(() => { state.shopping = state.shopping.filter((s) => s.id !== id); return { ok: true }; }, `Removed “${item.name}”`);
  }
  function claimItem(id, claim = true) {
    const item = state.shopping.find((s) => s.id === id);
    if (!item || item.status !== 'needed') return { ok: false };
    if (claim && item.buyerId && item.buyerId !== me()) return { ok: false, error: `${nameOf(item.buyerId)} already claimed this.` };
    return mutate(() => {
      item.buyerId = claim ? me() : null;
      if (claim) logActivity('claimed', `${item.name} to buy`, '#/money/shopping');
      return { ok: true };
    });
  }
  /** Mark purchased; optionally create the linked expense in the same atomic step. */
  function purchaseItem(id, { expense = null } = {}) {
    const item = state.shopping.find((s) => s.id === id);
    if (!item) return { ok: false, errors: { _: 'Item not found.' } };
    if (item.status === 'purchased') return { ok: true, duplicate: true }; // repeated click: no second expense
    let b = null;
    if (expense) {
      b = buildExpense(expense);
      if (Object.keys(b.e).length) return { ok: false, errors: b.e };
    }
    return mutate(() => {
      item.status = 'purchased'; item.purchasedAt = nowISO();
      item.purchasedBy = expense ? expense.payerId : me();
      if (expense) item.expenseId = insertExpense(b, expense, { shoppingItemId: item.id }).id;
      track('shopping_purchased', { withExpense: !!expense });
      logActivity('purchased', item.name, '#/money/shopping');
      return { ok: true };
    });
  }
  function reopenItem(id) {
    const item = state.shopping.find((s) => s.id === id);
    if (!item || item.status !== 'purchased' || item.expenseId) return { ok: false };
    return mutate(() => { Object.assign(item, { status: 'needed', purchasedBy: null, purchasedAt: null }); return { ok: true }; });
  }

  // ---------- events ----------
  function validateEvent(d) {
    const e = {};
    const title = trimmed(d.title);
    if (!title) e.title = 'Give the event a title.';
    else if (title.length > 80) e.title = 'Keep the title under 80 characters.';
    if (!L.CATEGORIES[d.category]) e.category = 'Choose a category.';
    const ok = L.isValidDate(d.startDate) && L.isValidTime(d.startTime) && L.isValidDate(d.endDate) && L.isValidTime(d.endTime);
    if (!ok) e.start = 'Enter valid start and end times.';
    const start = `${d.startDate}T${d.startTime}`, end = `${d.endDate}T${d.endTime}`;
    if (ok && end <= start) e.end = 'End time must be after the start time.';
    return { e, title, start, end };
  }
  function addEvent(d) {
    const { e, title, start, end } = validateEvent(d);
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      const ev = { id: uid('ev'), title, category: d.category, creatorId: me(), start, end, notes: trimmed(d.notes), createdAt: nowISO() };
      state.events.push(ev);
      track('calendar_event_created', { category: ev.category });
      logActivity('added to calendar', title, `#/calendar?id=${ev.id}`);
      notify(memberIds(), { type: 'event', title: `${nameOf(me())} added: ${title}`, body: `${L.CATEGORIES[ev.category].label} · ${L.describeEventTime(ev)}`, link: `#/calendar?id=${ev.id}` });
      return { ok: true, id: ev.id };
    });
  }
  function editEvent(id, d) {
    const ev = state.events.find((x) => x.id === id);
    if (!ev) return { ok: false, errors: { _: 'Event not found.' } };
    if (ev.creatorId !== me()) return { ok: false, errors: { _: `Only ${nameOf(ev.creatorId)} can edit this event.` } };
    const { e, title, start, end } = validateEvent(d);
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      Object.assign(ev, { title, category: d.category, start, end, notes: trimmed(d.notes) });
      logActivity('changed calendar event', title, `#/calendar?id=${ev.id}`);
      notify(memberIds(), { type: 'event', title: `${nameOf(me())} updated: ${title}`, body: L.describeEventTime(ev), link: `#/calendar?id=${ev.id}` });
      return { ok: true };
    });
  }
  function deleteEvent(id) {
    const ev = state.events.find((x) => x.id === id);
    if (!ev || ev.creatorId !== me()) return { ok: false };
    return mutate(() => {
      state.events = state.events.filter((x) => x.id !== id);
      logActivity('removed calendar event', ev.title, '#/calendar');
      notify(memberIds(), { type: 'event', title: `${nameOf(me())} removed: ${ev.title}`, body: L.describeEventTime(ev), link: '#/calendar' });
      return { ok: true };
    }, `Deleted event “${ev.title}”`);
  }

  // ---------- notifications & prefs ----------
  function setRead(id, read = true) {
    const n = state.notifications.find((x) => x.id === id);
    if (n && n.read !== read) { n.read = read; save(); emit(); }
  }
  function markAllRead() {
    state.notifications.forEach((n) => { if (n.userId === me()) n.read = true; });
    save(); emit();
  }
  function setPrefs(patch) {
    state.prefs[me()] = { ...prefsOf(me()), ...patch };
    commit();
  }

  // ---------- undo of last deletion ----------
  function undoLast() {
    if (!undoSlot) return false;
    const cur = state.currentUserId;
    state = JSON.parse(undoSlot.before);
    if (isMember(cur)) state.currentUserId = cur;
    undoSlot = null; save(); emit();
    return true;
  }

  // ---------- derived selectors (shared by dashboard and feature screens) ----------
  const byDue = (a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title);
  const sel = {
    pending: () => state.occurrences.filter((o) => !o.doneAt).sort(byDue),
    mine: () => sel.pending().filter((o) => o.assigneeId === me()),
    overdue: () => sel.pending().filter((o) => o.due < today()),
    done: () => state.occurrences.filter((o) => o.doneAt).sort((a, b) => b.doneAt.localeCompare(a.doneAt)),
    chore: (occ) => state.chores.find((c) => c.id === occ.choreId) || null,
    balances: () => L.computeBalances(memberIds(), state.expenses, state.reimbursements),
    settlements: () => L.suggestSettlements(sel.balances(), memberIds()),
    monthTotal: () => { const m = today().slice(0, 7); return state.expenses.filter((e) => e.date.startsWith(m)).reduce((s, e) => s + e.amountCents, 0); },
    needed: () => state.shopping.filter((s) => s.status === 'needed'),
    purchased: () => state.shopping.filter((s) => s.status === 'purchased').sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt)),
    upcomingEvents: (days = 30) => {
      const n = nowLocal(), lim = `${L.addDays(today(), days)}T23:59`;
      return state.events.filter((e) => e.end >= n && e.start <= lim).sort((a, b) => a.start.localeCompare(b.start));
    },
    eventsOn: (day) => state.events.filter((e) => L.eventOnDay(e, day)).sort((a, b) => a.start.localeCompare(b.start)),
    occsOn: (day) => state.occurrences.filter((o) => o.due === day).sort((a, b) => a.title.localeCompare(b.title)),
    weekStats: (weekStart) => {
      const end = L.addDays(weekStart, 6);
      const inWeek = state.occurrences.filter((o) => o.due >= weekStart && o.due <= end);
      return state.members.map((m) => ({
        id: m.id,
        completed: inWeek.filter((o) => o.doneAt && o.doneBy === m.id).length,
        pending: inWeek.filter((o) => !o.doneAt && o.assigneeId === m.id).length,
      }));
    },
    notifications: () => state.notifications.filter((n) => n.userId === me()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    unread: () => state.notifications.filter((n) => n.userId === me() && !n.read).length,
  };

  // ---------- demo household ----------
  function startDemo() {
    const names = ['Maya', 'Jordan', 'Priya', 'Sam'];
    state = blank('demo', 'Pecan Court Apt 204', names);
    const [maya, jordan, priya, sam] = state.members.map((m) => m.id);
    const t = today(), at = (n) => L.addDays(t, n);
    const iso = (n, h, m = 0) => { const d = L.parseDate(at(n)); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const lt = (n, h, m = 0) => `${at(n)}T${L.pad(h)}:${L.pad(m)}`;
    const all = [maya, jordan, priya, sam];
    const chore = (title, recurrence, rotation, notes = '') => { const c = { id: uid('c'), title, notes, recurrence, rotation, createdBy: maya, createdAt: iso(-20, 9) }; state.chores.push(c); return c; };
    const occ = (c, due, assigneeId, rotIdx, done = null) => {
      const o = { id: uid('o'), choreId: c.id, title: c.title, notes: c.notes, due, assigneeId, rotIdx, doneBy: done ? done.by : null, doneAt: done ? done.at : null, nextOccId: null };
      state.occurrences.push(o); return o;
    };
    // Trash: weekly, round-robin, Maya's turn today
    const trash = chore('Take out trash & recycling', 'weekly', all, 'Bins go to the curb by 8 PM on Tuesdays.');
    occ(trash, at(0), maya, 0);
    // Kitchen: overdue, Jordan
    const kitchen = chore('Deep-clean kitchen', 'weekly', all, 'Counters, stovetop, sink, and mop.');
    occ(kitchen, at(-2), jordan, 1);
    // Vacuum: completed by Sam, next occurrence generated for Maya
    const vac = chore('Vacuum common areas', 'weekly', [sam, maya, jordan, priya]);
    const v1 = occ(vac, at(-2), sam, 0, { by: sam, at: iso(-3, 15, 12) });
    const v2 = occ(vac, at(5), maya, 1);
    v1.nextOccId = v2.id;
    // Water plants: Maya, due in 3 days, no rotation
    const plants = chore('Water the plants', 'weekly', []);
    occ(plants, at(3), maya, -1);
    // One-time: bathroom restock for Priya
    const bath = chore('Restock bathroom supplies', 'once', []);
    occ(bath, at(4), priya, -1);

    // Expenses
    const mkExp = (description, cents, date, payerId, participantIds, extra = {}) => {
      const e = { id: uid('e'), description, amountCents: cents, date, payerId, participantIds, splits: L.splitEqual(cents, participantIds), createdBy: payerId, createdAt: iso(-1, 12), ...extra };
      state.expenses.push(e); return e;
    };
    const util = mkExp('Electric bill', 13837, at(-6), jordan, all);
    const supplies = mkExp('Cleaning supplies (Target)', 2743, at(-3), priya, all);
    state.reimbursements.push({ id: uid('r'), fromId: maya, toId: jordan, amountCents: 2000, date: at(-1), note: 'Paid back in cash', createdBy: maya, createdAt: iso(-1, 18) });

    // Shopping
    const item = (name, qty, notes = '', extra = {}) => state.shopping.push({ id: uid('s'), name, qty, notes, buyerId: null, status: 'needed', purchasedBy: null, purchasedAt: null, expenseId: null, createdBy: maya, createdAt: iso(-1, 10), ...extra });
    item('Dish soap', '1', 'Unscented if possible');
    item('Paper towels', '1 pack');
    item('Sponges & trash bags', '1', '', { status: 'purchased', purchasedBy: priya, purchasedAt: iso(-3, 16), expenseId: supplies.id });
    supplies.shoppingItemId = state.shopping[2].id;

    // Events
    const ev = (title, category, creatorId, start, end, notes = '') => state.events.push({ id: uid('ev'), title, category, creatorId, start, end, notes, createdAt: iso(-1, 9) });
    ev('Quiet study block (midterm review)', 'quiet', priya, lt(1, 19), lt(1, 22), 'Please keep the living room quiet.');
    ev('Jordan’s friend visiting', 'guest', jordan, lt(2, 18), lt(2, 21), 'Just FYI. They’ll be hanging out in the living room.');
    ev('Sam away for the weekend', 'away', sam, lt(4, 8), lt(6, 20));
    ev('Apartment dinner', 'plans', maya, lt(3, 19, 30), lt(3, 21, 30), 'Pasta night. Everyone welcome!');

    // Activity (newest first)
    const act = (actorId, verb, subject, link, n, h) => state.activity.push({ id: uid('act'), actorId, verb, subject, link, ref: null, ts: iso(n, h) });
    act(maya, 'recorded a payback', 'Maya → Jordan $20.00', '#/money/expenses', -1, 18);
    act(priya, 'added to calendar', 'Quiet study block (midterm review)', '#/calendar', -1, 11);
    act(priya, 'added expense', 'Cleaning supplies (Target) ($27.43)', '#/money/expenses', -3, 16);
    act(priya, 'purchased', 'Sponges & trash bags', '#/money/shopping', -3, 16);
    act(sam, 'completed', 'Vacuum common areas', '#/chores/done', -3, 15);
    act(jordan, 'added expense', 'Electric bill ($138.37)', '#/money/expenses', -6, 20);
    state.activity.forEach((a) => { if (a.verb === 'completed') a.ref = v1.id; });
    state.activity.sort((a, b) => b.ts.localeCompare(a.ts));

    // Notifications for Maya (reminders are generated live)
    const nt = (userId, type, title, body, link, h, read = false) => state.notifications.push({ id: uid('n'), userId, type, title, body, link, key: null, read, createdAt: iso(-1, h) });
    nt(maya, 'expense', 'Payback recorded: Maya → Jordan', '$20.00 paid outside RoomSync', '#/money/expenses', 18, true);
    nt(maya, 'event', 'Priya added: Quiet study block (midterm review)', `Quiet / study · ${L.fmtDay(at(1))}`, '#/calendar', 11);
    nt(maya, 'expense', 'New shared expense: Cleaning supplies (Target)', 'Priya paid $27.43 · your share $6.86', '#/money/expenses', 10, true);

    track('demo_started');
    commit();
  }

  return {
    load, save, reset, subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    get state() { return state; }, get saveError() { return saveError; }, get storageBroken() { return storageBroken; },
    get undoLabel() { return undoSlot ? undoSlot.label : null; },
    today, nowLocal, nameOf, me, memberIds, prefsOf, sel,
    createHousehold, startDemo, setCurrentUser,
    addChore, editChore, reassignChore, completeChore, undoComplete, deleteChore,
    addExpense, editExpense, deleteExpense, addReimbursement, deleteReimbursement,
    addItem, editItem, deleteItem, claimItem, purchaseItem, reopenItem,
    addEvent, editEvent, deleteEvent,
    setRead, markAllRead, setPrefs, undoLast, runReminders: () => { if (generateReminders()) { save(); emit(); } },
    exportAnalytics: () => JSON.stringify({ household: state.household.id, mode: state.mode, exportedAt: nowISO(), events: state.analytics, completions: state.occurrences.filter((o) => o.doneAt).map((o) => ({ title: o.title, due: o.due, doneAt: o.doneAt, doneBy: o.doneBy, assigneeId: o.assigneeId })) }, null, 2),
  };
}
