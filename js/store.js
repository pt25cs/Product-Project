// Kasa data layer. Framework-free; storage is injected so it runs in the browser (localStorage)
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
      state = normalize(s);
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

  // Default shapes for fields added after v1 shipped. Reused by blank() and normalize() so
  // new households and pre-existing saves end up with identical structure.
  const defaultProfile = () => ({ dietary: '', budgetCents: null, rules: '' });
  const defaultPurchasing = () => ({ budgetCents: null, preferredProducts: [], storePreferences: [] });

  /**
   * Fill in fields introduced after the v1 format shipped, without bumping `version`.
   * Older saves (and the demo/new households) all pass through here so the rest of the store
   * can assume the new collections and per-entity fields always exist. Pure-ish: mutates and
   * returns the passed object.
   */
  function normalize(s) {
    if (!s) return s;
    if (!Array.isArray(s.swaps)) s.swaps = [];
    if (!Array.isArray(s.expectations)) s.expectations = [];
    if (!s.purchasing || typeof s.purchasing !== 'object') s.purchasing = defaultPurchasing();
    else {
      if (!('budgetCents' in s.purchasing)) s.purchasing.budgetCents = null;
      if (!Array.isArray(s.purchasing.preferredProducts)) s.purchasing.preferredProducts = [];
      if (!Array.isArray(s.purchasing.storePreferences)) s.purchasing.storePreferences = [];
    }
    for (const m of s.members) {
      m.profile = { ...defaultProfile(), ...(m.profile || {}) };
    }
    for (const c of s.chores) {
      if (!('autoRotate' in c)) c.autoRotate = false;
      if (!('anchorDate' in c)) c.anchorDate = null;
      if (!('cycleDays' in c)) c.cycleDays = 7;
    }
    for (const o of s.occurrences) {
      if (!('manualOverride' in o)) o.manualOverride = false;
    }
    return s;
  }
  function commit() { advanceRotations(today()); generateReminders(); save(); emit(); }
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
  const prefsOf = (id) => {
    const p = state.prefs[id] || {};
    // `channels` is a seam for roadmap Phase 3 (push/SMS). Only `inApp` affects behavior now.
    return { reminders: true, leadDays: 1, updates: true, ...p, channels: { inApp: true, push: false, sms: false, ...(p.channels || {}) } };
  };
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
    state.notifications = state.notifications.filter((n) => !(n.key && (n.key === `due:${occId}` || n.key === `overdue:${occId}`)));
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
      let key = null, title = '', body = '';
      if (days < 0) { key = `overdue:${occ.id}`; title = `${occ.title} was due ${L.fmtDay(occ.due)}.`; body = 'Still open and assigned to you.'; }
      else if (days <= p.leadDays) { key = `due:${occ.id}`; title = `${occ.title} is due ${days === 0 ? 'today' : days === 1 ? 'tomorrow' : L.fmtDay(occ.due)}.`; body = 'Assigned to you.'; }
      if (!key) continue;
      if (state.notifications.some((n) => n.userId === occ.assigneeId && n.key === key)) continue;
      state.notifications.unshift({ id: uid('n'), userId: occ.assigneeId, type: days < 0 ? 'chore_overdue' : 'chore_due', title, body, link: `#/chores/all?id=${occ.id}`, key, read: false, createdAt: nowISO() });
      created++;
    }
    return created;
  }

  /**
   * Schedule-driven rotation (Requirement 1). For each auto-rotating chore with a real rotation,
   * ensure the current cycle's occurrence exists and is assigned to the deterministic
   * `rotationAssignee`, honoring the no-backlog rule via `currentCycleDue`. Runs inside `commit()`
   * (and the 60s/visibilitychange reminder hooks) so whose-turn-it-is advances on schedule even
   * when a prior turn was never completed (1.2) and without creating past-dated backlog (1.3).
   *
   * Priority rules:
   *  - A `manualOverride` occurrence for the current cycle keeps its assignee; rotation resumes
   *    next cycle (1.4). A completed occurrence is likewise left alone (don't resurrect it).
   *  - When a fresh occurrence is created, notify only the new assignee with a stable
   *    `rotate:<occId>:<assignee>` key (deduped), never the previous assignee (1.6).
   *
   * Mutates `state` directly (like `generateReminders`) — it must NOT call `commit()`/`mutate()`
   * or it would recurse. Returns the number of occurrences created so callers can decide to persist.
   */
  function advanceRotations(t) {
    if (!state) return 0;
    let created = 0;
    for (const chore of state.chores) {
      if (!chore.autoRotate) continue;
      const rot = Array.isArray(chore.rotation) ? chore.rotation.filter(isMember) : [];
      if (rot.length < 2) continue; // single-assignee / no rotation: unchanged (1.5)
      const due = L.currentCycleDue(chore, t);
      const assignee = L.rotationAssignee(chore, due);
      if (!isMember(assignee)) continue;
      // The occurrence that represents the current cycle for this chore (matched by due date).
      const occ = state.occurrences.find((o) => o.choreId === chore.id && o.due === due);
      if (occ) {
        if (occ.doneAt || occ.manualOverride) continue; // completed / override: leave as-is (1.4)
        if (occ.assigneeId !== assignee) {
          occ.assigneeId = assignee;
          occ.rotIdx = rot.indexOf(assignee);
          dropReminders(occ.id);
          notify([assignee], { type: 'chore_assigned', title: `It's your turn: ${chore.title}.`, body: `Due ${L.fmtDay(due)}`, link: `#/chores/all?id=${occ.id}`, key: `rotate:${occ.id}:${assignee}` }, { includeActor: true });
        }
        continue;
      }
      // No occurrence yet for this cycle: create exactly one (no backlog for skipped cycles — 1.3).
      const occId = uid('o');
      state.occurrences.push({ id: occId, choreId: chore.id, title: chore.title, notes: chore.notes || '', due, assigneeId: assignee, rotIdx: rot.indexOf(assignee), doneBy: null, doneAt: null, nextOccId: null, manualOverride: false });
      notify([assignee], { type: 'chore_assigned', title: `It's your turn: ${chore.title}.`, body: `Due ${L.fmtDay(due)}`, link: `#/chores/all?id=${occId}`, key: `rotate:${occId}:${assignee}` }, { includeActor: true });
      created++;
    }
    return created;
  }

  // ---------- onboarding ----------
  function blank(mode, hhName, names) {
    const members = names.map((n) => ({ id: uid('u'), name: n, profile: defaultProfile() }));
    return normalize({
      version: 1, mode,
      household: { id: uid('hh'), name: hhName, createdAt: nowISO() },
      members, currentUserId: members[0].id,
      chores: [], occurrences: [], expenses: [], reimbursements: [], shopping: [], events: [],
      notifications: [], activity: [], prefs: {}, analytics: [],
      swaps: [], expectations: [], purchasing: defaultPurchasing(),
    });
  }

  function createHousehold({ userName, householdName, others = [], starter = [] }) {
    const errors = {};
    const names = [trimmed(userName), ...others.map(trimmed).filter(Boolean)];
    if (!names[0]) errors.userName = 'Enter your name.';
    if (!trimmed(householdName)) errors.householdName = 'Give your household a name.';
    if (names.some((n) => n.length > 30)) errors.others = 'Names can be up to 30 characters.';
    else if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) errors.others = 'Each roommate needs a different name.';
    else if (names.length < 2) errors.others = 'Add at least one roommate.';
    else if (names.length > 5) errors.others = 'Kasa supports up to 5 roommates.';
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
    const rotation = d.rotate ? rot : [];
    // Auto-rotation is only meaningful for a weekly chore that actually rotates (2+ roommates).
    const autoRotate = !!d.autoRotate && d.recurrence === 'weekly' && rotation.length >= 2;
    let cycleDays = 7;
    if (autoRotate && d.cycleDays != null && d.cycleDays !== '') {
      const n = Math.trunc(Number(d.cycleDays));
      if (!Number.isFinite(n) || n < 1 || n > 365) e.cycleDays = 'Choose a cycle length between 1 and 365 days.';
      else cycleDays = n;
    }
    return { e, title, rotation, autoRotate, cycleDays };
  }

  function addChore(d) {
    const { e, title, rotation, autoRotate, cycleDays } = validateChore(d);
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      const choreId = uid('c'), occId = uid('o');
      // Auto-rotating chores anchor their cadence on this first due date so `rotationAssignee`
      // treats the creating assignee as the start of the rotation (cycle 0).
      const anchorDate = autoRotate ? d.due : null;
      state.chores.push({ id: choreId, title, notes: trimmed(d.notes), recurrence: d.recurrence, rotation, autoRotate, anchorDate, cycleDays, startIdx: autoRotate ? rotation.indexOf(d.assigneeId) : 0, createdBy: me(), createdAt: nowISO() });
      state.occurrences.push({ id: occId, choreId, title, notes: trimmed(d.notes), due: d.due, assigneeId: d.assigneeId, rotIdx: rotation.indexOf(d.assigneeId), doneBy: null, doneAt: null, nextOccId: null, manualOverride: false });
      track('chore_assigned', { assigneeId: d.assigneeId, recurrence: d.recurrence, rotating: rotation.length > 0 });
      logActivity('added the chore', title, `#/chores/all?id=${occId}`);
      notify([d.assigneeId], { type: 'chore_assigned', title: `${nameOf(me())} assigned you ${title}.`, body: L.relativeDue(d.due, today()), link: `#/chores/all?id=${occId}`, key: `assign:${occId}:${d.assigneeId}` });
      return { ok: true, id: occId };
    });
  }

  function editChore(occId, d) {
    const occ = state.occurrences.find((o) => o.id === occId);
    if (!occ || occ.doneAt) return { ok: false, errors: { _: 'This chore is no longer open.' } };
    const chore = state.chores.find((c) => c.id === occ.choreId);
    const { e, title, rotation, autoRotate, cycleDays } = validateChore(d);
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      const prevAssignee = occ.assigneeId;
      if (chore) {
        const rotChanged = chore.rotation.join() !== rotation.join();
        Object.assign(chore, { title, notes: trimmed(d.notes), recurrence: d.recurrence, rotation });
        if (rotChanged) occ.rotIdx = rotation.indexOf(d.assigneeId);
        // (Re)establish auto-rotation metadata. Anchor on this occurrence's due date and treat the
        // chosen assignee as the start of the rotation so the current cycle maps to them.
        chore.autoRotate = autoRotate;
        chore.cycleDays = cycleDays;
        if (autoRotate) {
          if (!chore.anchorDate || !L.isValidDate(chore.anchorDate) || rotChanged) chore.anchorDate = d.due;
          chore.startIdx = rotation.indexOf(d.assigneeId);
        }
      }
      Object.assign(occ, { title, notes: trimmed(d.notes), due: d.due, assigneeId: d.assigneeId });
      // keep other open occurrences of this chore (none normally) in sync on title only
      logActivity('updated the chore', title, `#/chores/all?id=${occ.id}`);
      if (prevAssignee !== d.assigneeId) {
        track('chore_assigned', { assigneeId: d.assigneeId, reassigned: true });
        notify([d.assigneeId], { type: 'chore_assigned', title: `${nameOf(me())} assigned you ${title}.`, body: L.relativeDue(d.due, today()), link: `#/chores/all?id=${occ.id}`, key: `assign:${occ.id}:${d.assigneeId}` });
      }
      return { ok: true };
    });
  }

  function reassignChore(occId, assigneeId) {
    const occ = state.occurrences.find((o) => o.id === occId);
    if (!occ || occ.doneAt || !isMember(assigneeId) || occ.assigneeId === assigneeId) return { ok: false };
    return mutate(() => {
      occ.assigneeId = assigneeId;
      occ.manualOverride = true; // manual assignment wins this cycle; rotation resumes next cycle (1.4)
      invalidateSwaps(occ.id, 'reassigned'); // any pending swap for this occurrence is now stale (2.8)
      track('chore_assigned', { assigneeId, reassigned: true });
      logActivity('reassigned', `${occ.title} to ${nameOf(assigneeId)}`, `#/chores/all?id=${occ.id}`);
      notify([assigneeId], { type: 'chore_assigned', title: `${nameOf(me())} reassigned ${occ.title} to you.`, body: L.relativeDue(occ.due, today()), link: `#/chores/all?id=${occ.id}`, key: `assign:${occ.id}:${assigneeId}` });
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
      invalidateSwaps(occ.id, 'completed'); // a completed occurrence can't be swapped (2.8)
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
      if (next) notify([next.assigneeId], { type: 'chore_assigned', title: `You're up next: ${next.title}.`, body: `Due ${L.fmtDay(next.due)}`, link: `#/chores/all?id=${next.id}`, key: `assign:${next.id}:${next.assigneeId}` });
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
      invalidateSwaps(open, 'deleted');
      logActivity('deleted the chore', title, '#/chores/all');
      return { ok: true };
    }, `Deleted “${title}”`);
  }

  // ---------- chore swaps (Requirement 2) ----------
  /**
   * Mark any pending swap that references one of `occIds` as invalidated, so an occurrence that
   * is completed/deleted/reassigned out from under a request can never produce an inconsistent
   * swap (2.8). Called from completeChore/deleteChore/reassignChore. Mutates state directly.
   */
  function invalidateSwaps(occIds, reason) {
    const ids = Array.isArray(occIds) ? occIds : [occIds];
    for (const sw of state.swaps) {
      if (sw.status !== 'pending') continue;
      if (!ids.includes(sw.occId) && !ids.includes(sw.targetOccId)) continue;
      sw.status = 'invalidated';
      sw.resolvedBy = me();
      sw.resolvedAt = nowISO();
      // Let the two parties know their pending swap can no longer go through.
      const parties = [sw.requesterId, sw.addresseeId].filter(Boolean);
      notify(parties, { type: 'swap', title: `A swap for ${swapTitle(sw)} is no longer available.`, body: `The chore was ${reason}.`, link: '#/chores/all', key: `swap:invalid:${sw.id}` });
    }
  }
  const openOcc = (id) => state.occurrences.find((o) => o.id === id && !o.doneAt) || null;
  const swapTitle = (sw) => { const o = state.occurrences.find((x) => x.id === sw.occId); return o ? o.title : 'a chore'; };

  /** Post an open swap request for one of my open occurrences (2.1). */
  function requestOpenSwap(occId) {
    const occ = openOcc(occId);
    if (!occ) return { ok: false, error: 'This chore is no longer open.' };
    if (occ.assigneeId !== me()) return { ok: false, error: 'You can only hand off a chore assigned to you.' }; // 2.10
    if (state.swaps.some((s) => s.status === 'pending' && s.occId === occId)) return { ok: false, error: 'There is already a pending request for this chore.' };
    return mutate(() => {
      const sw = { id: uid('sw'), kind: 'open', occId, targetOccId: null, requesterId: me(), addresseeId: null, status: 'pending', resolvedBy: null, createdAt: nowISO(), resolvedAt: null };
      state.swaps.push(sw);
      track('swap_requested', { kind: 'open' });
      logActivity('asked someone to take', occ.title, `#/chores/all?id=${occ.id}`);
      notify(memberIds(), { type: 'swap', title: `${nameOf(me())} is asking someone to take ${occ.title}.`, body: `Due ${L.fmtDay(occ.due)}`, link: `#/chores/all?id=${occ.id}`, key: `swap:open:${sw.id}` });
      return { ok: true, id: sw.id };
    });
  }

  /** The original requester cancels their own open request; occurrence stays with them (2.4). */
  function cancelSwap(swapId) {
    const sw = state.swaps.find((s) => s.id === swapId);
    if (!sw) return { ok: false, error: 'Swap not found.' };
    if (sw.status !== 'pending') return { ok: false, error: 'This request is no longer pending.' };
    if (sw.requesterId !== me()) return { ok: false, error: 'Only the person who made the request can cancel it.' }; // 2.10
    return mutate(() => {
      sw.status = 'cancelled'; sw.resolvedBy = me(); sw.resolvedAt = nowISO();
      track('swap_cancelled', { kind: sw.kind });
      logActivity('cancelled the swap request for', swapTitle(sw), '#/chores/all');
      return { ok: true };
    });
  }

  /** Another roommate accepts an open request: reassign the occurrence to them (2.2/2.3). */
  function acceptOpenSwap(swapId) {
    const sw = state.swaps.find((s) => s.id === swapId);
    if (!sw || sw.kind !== 'open') return { ok: false, error: 'Swap not found.' };
    if (sw.status !== 'pending') return { ok: false, error: 'This request has already been resolved or cancelled.' }; // 2.3
    if (sw.requesterId === me()) return { ok: false, error: 'You can’t accept your own request.' }; // 2.10
    const occ = openOcc(sw.occId);
    if (!occ || occ.assigneeId !== sw.requesterId) { // occurrence changed under us
      return mutate(() => {
        sw.status = 'invalidated'; sw.resolvedBy = me(); sw.resolvedAt = nowISO();
        return { ok: false, error: 'That chore is no longer available to take.' }; // 2.3 / 2.8
      });
    }
    const requester = sw.requesterId, taker = me();
    return mutate(() => {
      occ.assigneeId = taker;
      occ.manualOverride = true; // swap wins this cycle; rotation resumes next cycle (2.9 / 1.4)
      occ.rotIdx = -1;
      dropReminders(occ.id);
      sw.status = 'accepted'; sw.resolvedBy = taker; sw.resolvedAt = nowISO();
      track('swap_accepted', { kind: 'open' });
      logActivity('took', `${occ.title} from ${nameOf(requester)}`, `#/chores/all?id=${occ.id}`);
      notify([requester], { type: 'swap', title: `${nameOf(taker)} took ${occ.title} for you.`, body: `Due ${L.fmtDay(occ.due)}`, link: `#/chores/all?id=${occ.id}`, key: `swap:accepted:${sw.id}` });
      return { ok: true };
    }, `${nameOf(taker)} took “${occ.title}”`);
  }

  /** Propose a direct trade: my occurrence ↔ a specific roommate's occurrence (2.5). */
  function proposeDirectSwap(occId, targetOccId) {
    const occ = openOcc(occId);
    const target = openOcc(targetOccId);
    if (!occ || !target) return { ok: false, error: 'One of those chores is no longer open.' };
    if (occ.assigneeId !== me()) return { ok: false, error: 'You can only offer a chore assigned to you.' }; // 2.10
    if (target.assigneeId === me()) return { ok: false, error: 'Pick a chore assigned to a different roommate.' };
    if (!isMember(target.assigneeId)) return { ok: false, error: 'That chore isn’t assigned to a current roommate.' };
    if (state.swaps.some((s) => s.status === 'pending' && (s.occId === occId || s.targetOccId === occId || s.occId === targetOccId || s.targetOccId === targetOccId))) {
      return { ok: false, error: 'One of those chores is already part of a pending swap.' };
    }
    const addressee = target.assigneeId;
    return mutate(() => {
      const sw = { id: uid('sw'), kind: 'direct', occId, targetOccId, requesterId: me(), addresseeId: addressee, status: 'pending', resolvedBy: null, createdAt: nowISO(), resolvedAt: null };
      state.swaps.push(sw);
      track('swap_requested', { kind: 'direct' });
      logActivity('offered to trade', `${occ.title} for ${target.title}`, `#/chores/all?id=${occ.id}`);
      notify([addressee], { type: 'swap', title: `${nameOf(me())} wants to trade chores with you.`, body: `Their ${occ.title} ↔ your ${target.title}`, link: `#/chores/all?id=${target.id}`, key: `swap:direct:${sw.id}` });
      return { ok: true, id: sw.id };
    });
  }

  /** The addressed roommate accepts (swap atomically) or declines a direct proposal (2.6/2.7/2.8). */
  function respondDirectSwap(swapId, accept) {
    const sw = state.swaps.find((s) => s.id === swapId);
    if (!sw || sw.kind !== 'direct') return { ok: false, error: 'Swap not found.' };
    if (sw.status !== 'pending') return { ok: false, error: 'This proposal has already been resolved.' }; // 2.8
    if (sw.addresseeId !== me()) return { ok: false, error: 'Only the roommate this trade was offered to can respond.' }; // 2.10
    if (!accept) {
      return mutate(() => {
        sw.status = 'declined'; sw.resolvedBy = me(); sw.resolvedAt = nowISO();
        track('swap_declined', { kind: 'direct' });
        logActivity('declined the trade for', swapTitle(sw), '#/chores/all');
        notify([sw.requesterId], { type: 'swap', title: `${nameOf(me())} declined your chore trade.`, body: 'Both chores stay as they were.', link: '#/chores/all', key: `swap:declined:${sw.id}` });
        return { ok: true, declined: true };
      });
    }
    const occ = openOcc(sw.occId), target = openOcc(sw.targetOccId);
    // Re-check both occurrences are still open and owned by the original parties (2.8).
    if (!occ || !target || occ.assigneeId !== sw.requesterId || target.assigneeId !== sw.addresseeId) {
      return mutate(() => {
        sw.status = 'invalidated'; sw.resolvedBy = me(); sw.resolvedAt = nowISO();
        return { ok: false, error: 'One of these chores changed, so the trade can’t go through.' }; // 2.8
      });
    }
    const requester = sw.requesterId, addressee = me();
    return mutate(() => {
      // Atomic assignee swap: both occurrences change owner inside one mutate (2.6).
      occ.assigneeId = addressee; occ.manualOverride = true; occ.rotIdx = -1;
      target.assigneeId = requester; target.manualOverride = true; target.rotIdx = -1;
      dropReminders(occ.id); dropReminders(target.id);
      sw.status = 'accepted'; sw.resolvedBy = addressee; sw.resolvedAt = nowISO();
      track('swap_accepted', { kind: 'direct' });
      logActivity('traded', `${target.title} for ${occ.title} with ${nameOf(requester)}`, `#/chores/all?id=${target.id}`);
      notify([requester], { type: 'swap', title: `${nameOf(addressee)} accepted your chore trade.`, body: `You now have ${target.title}; they took ${occ.title}.`, link: `#/chores/all?id=${target.id}`, key: `swap:accepted:${sw.id}` });
      return { ok: true };
    }, `Traded “${occ.title}” ↔ “${target.title}”`);
  }

  // ---------- shared household expectations (Requirement 3) ----------
  // Shared (not per-roommate) norms. Reuse the 300-char notes cap for consistency (3.3).
  function validateExpectation(text) {
    const t = trimmed(text);
    if (!t) return { error: 'Enter the expectation.' };
    if (t.length > 300) return { error: 'Keep expectations under 300 characters.' };
    return { text: t };
  }

  /** Add a shared household expectation visible to everyone (3.1/3.2/3.5). */
  function addExpectation(text) {
    const { text: t, error } = validateExpectation(text);
    if (error) return { ok: false, error };
    return mutate(() => {
      const id = uid('exp');
      state.expectations.push({ id, text: t, createdBy: me(), createdAt: nowISO(), updatedBy: me(), updatedAt: nowISO() });
      logActivity('added the expectation', t, '#/home');
      return { ok: true, id };
    });
  }

  /** Edit an existing shared expectation, tracking who changed it and when (3.2/3.3). */
  function editExpectation(id, text) {
    const exp = state.expectations.find((x) => x.id === id);
    if (!exp) return { ok: false, error: 'Expectation not found.' };
    const { text: t, error } = validateExpectation(text);
    if (error) return { ok: false, error };
    return mutate(() => {
      exp.text = t; exp.updatedBy = me(); exp.updatedAt = nowISO();
      logActivity('updated the expectation', t, '#/home');
      return { ok: true };
    });
  }

  /** Remove a shared expectation; undoable one step (3.2/3.4). */
  function removeExpectation(id) {
    const exp = state.expectations.find((x) => x.id === id);
    if (!exp) return { ok: false, error: 'Expectation not found.' };
    const text = exp.text;
    return mutate(() => {
      state.expectations = state.expectations.filter((x) => x.id !== id);
      logActivity('removed the expectation', text, '#/home');
      return { ok: true };
    }, `Removed expectation “${text}”`);
  }

  // ---------- shared purchasing rules (Requirement 4) ----------
  // Shared (not per-roommate) buying standards: a monthly budget plus preferred products and
  // store preferences. Lists reuse the same { id, text, createdBy, createdAt } shape and the
  // 300-char cap for consistency with expectations. Budget is integer cents via parseMoney.
  function validatePurchasingText(text, label) {
    const t = trimmed(text);
    if (!t) return { error: `Enter the ${label}.` };
    if (t.length > 300) return { error: `Keep ${label}s under 300 characters.` };
    return { text: t };
  }

  /**
   * Set (or clear) the shared monthly purchasing budget (4.1). Accepts money input parsed via
   * `L.parseMoney` (positive integer cents) and rejects invalid amounts with a clear message.
   * Passing an empty value clears the budget (budgetCents = null).
   */
  function setPurchasingBudget(amount) {
    const raw = typeof amount === 'string' ? amount.trim() : amount;
    if (raw === '' || raw == null) {
      return mutate(() => {
        state.purchasing.budgetCents = null;
        logActivity('cleared the shared purchasing budget', '', '#/money');
        return { ok: true, cleared: true };
      });
    }
    const cents = L.parseMoney(String(raw));
    if (cents === null) return { ok: false, error: 'Enter an amount greater than $0 (for example 300 or 250.50).' };
    return mutate(() => {
      state.purchasing.budgetCents = cents;
      logActivity('set the shared purchasing budget to', L.fmtMoney(cents), '#/money');
      return { ok: true, budgetCents: cents };
    });
  }

  /** Add a shared preferred product/brand visible to everyone (4.2). */
  function addPreferredProduct(text) {
    const { text: t, error } = validatePurchasingText(text, 'preferred product');
    if (error) return { ok: false, error };
    return mutate(() => {
      const id = uid('pp');
      state.purchasing.preferredProducts.push({ id, text: t, createdBy: me(), createdAt: nowISO() });
      logActivity('added the preferred product', t, '#/money');
      return { ok: true, id };
    });
  }

  /** Remove a preferred product; undoable one step (4.5). */
  function removePreferredProduct(id) {
    const item = state.purchasing.preferredProducts.find((x) => x.id === id);
    if (!item) return { ok: false, error: 'Preferred product not found.' };
    const text = item.text;
    return mutate(() => {
      state.purchasing.preferredProducts = state.purchasing.preferredProducts.filter((x) => x.id !== id);
      logActivity('removed the preferred product', text, '#/money');
      return { ok: true };
    }, `Removed preferred product “${text}”`);
  }

  /** Add a shared store preference visible to everyone (4.2). */
  function addStorePreference(text) {
    const { text: t, error } = validatePurchasingText(text, 'store preference');
    if (error) return { ok: false, error };
    return mutate(() => {
      const id = uid('sp');
      state.purchasing.storePreferences.push({ id, text: t, createdBy: me(), createdAt: nowISO() });
      logActivity('added the store preference', t, '#/money');
      return { ok: true, id };
    });
  }

  /** Remove a store preference; undoable one step (4.5). */
  function removeStorePreference(id) {
    const item = state.purchasing.storePreferences.find((x) => x.id === id);
    if (!item) return { ok: false, error: 'Store preference not found.' };
    const text = item.text;
    return mutate(() => {
      state.purchasing.storePreferences = state.purchasing.storePreferences.filter((x) => x.id !== id);
      logActivity('removed the store preference', text, '#/money');
      return { ok: true };
    }, `Removed store preference “${text}”`);
  }

  // ---------- local roommate profile fields (Requirement 5, interim) ----------
  // Per-member profile living on the shared member record (no accounts yet). Text fields reuse
  // the 300-char cap used elsewhere; the personal budget is integer cents via parseMoney, and an
  // empty value clears it to null. Only fields present in `patch` are touched (5.1/5.3/5.4).
  function updateProfile(patch) {
    if (!patch || typeof patch !== 'object') return { ok: false, errors: { _: 'Nothing to update.' } };
    const m = state.members.find((x) => x.id === me());
    if (!m) return { ok: false, errors: { _: 'Profile not found.' } };
    const e = {};
    const next = {};
    if ('dietary' in patch) {
      const t = trimmed(patch.dietary);
      if (t.length > 300) e.dietary = 'Keep dietary notes under 300 characters.';
      else next.dietary = t;
    }
    if ('rules' in patch) {
      const t = trimmed(patch.rules);
      if (t.length > 300) e.rules = 'Keep personal rules under 300 characters.';
      else next.rules = t;
    }
    if ('budgetCents' in patch) {
      const raw = typeof patch.budgetCents === 'string' ? patch.budgetCents.trim() : patch.budgetCents;
      if (raw === '' || raw == null) {
        next.budgetCents = null; // clearing the personal budget is allowed
      } else {
        const cents = L.parseMoney(String(raw));
        if (cents === null) e.budgetCents = 'Enter an amount greater than $0 (for example 200 or 150.50).';
        else next.budgetCents = cents;
      }
    }
    if (Object.keys(e).length) return { ok: false, errors: e };
    return mutate(() => {
      m.profile = { ...defaultProfile(), ...(m.profile || {}), ...next };
      logActivity('updated their profile', m.name, '#/profile');
      return { ok: true };
    });
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
    logActivity('added the expense', `${b.description} (${L.fmtMoney(b.cents)})`, `#/money/expenses?id=${exp.id}`);
    for (const pid of b.participantIds) {
      notify([pid], { type: 'expense', title: `${nameOf(d.payerId)} added ${b.description}.`, body: `Your share: ${L.fmtMoney(b.splits[pid])} of ${L.fmtMoney(b.cents)}`, link: `#/money/expenses?id=${exp.id}` });
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
      logActivity('edited the expense', `${b.description} (${L.fmtMoney(b.cents)})`, `#/money/expenses?id=${exp.id}`);
      for (const pid of b.participantIds) notify([pid], { type: 'expense', title: `${nameOf(me())} updated ${b.description}.`, body: `Your share: ${L.fmtMoney(b.splits[pid])} of ${L.fmtMoney(b.cents)}`, link: `#/money/expenses?id=${exp.id}` });
      return { ok: true };
    });
  }
  function deleteExpense(id) {
    const exp = state.expenses.find((x) => x.id === id);
    if (!exp) return { ok: false };
    return mutate(() => {
      state.expenses = state.expenses.filter((x) => x.id !== id);
      state.shopping.forEach((s) => { if (s.expenseId === id) s.expenseId = null; });
      logActivity('deleted the expense', exp.description, '#/money/expenses');
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
      logActivity('recorded a repayment of', `${L.fmtMoney(cents)} from ${nameOf(r.fromId)} to ${nameOf(r.toId)}`, '#/money/expenses');
      notify([r.fromId, r.toId], { type: 'expense', title: `${nameOf(me())} recorded a repayment: ${nameOf(r.fromId)} paid ${nameOf(r.toId)} ${L.fmtMoney(cents)}.`, body: 'Paid outside Kasa.', link: '#/money/expenses' });
      return { ok: true };
    });
  }
  function deleteReimbursement(id) {
    const r = state.reimbursements.find((x) => x.id === id);
    if (!r) return { ok: false };
    return mutate(() => { state.reimbursements = state.reimbursements.filter((x) => x.id !== id); return { ok: true }; }, 'Deleted repayment');
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
      logActivity('added', `${name} to the shopping list`, '#/money/shopping');
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
      if (claim) logActivity('claimed', item.name, '#/money/shopping');
      return { ok: true };
    });
  }
  /** Put a previously purchased item back on the list as a fresh "needed" item (the old purchase and its expense stay untouched). */
  function addItemAgain(id) {
    const old = state.shopping.find((s) => s.id === id);
    if (!old || old.status !== 'purchased') return { ok: false };
    if (state.shopping.some((s) => s.status === 'needed' && s.name.toLowerCase() === old.name.toLowerCase())) return { ok: true, duplicate: true };
    return mutate(() => {
      state.shopping.push({ id: uid('s'), name: old.name, qty: old.qty, notes: old.notes, buyerId: null, status: 'needed', purchasedBy: null, purchasedAt: null, expenseId: null, createdBy: me(), createdAt: nowISO() });
      logActivity('added', `${old.name} to the shopping list`, '#/money/shopping');
      return { ok: true };
    });
  }
  function takeOverItem(id) {
    const item = state.shopping.find((s) => s.id === id);
    if (!item || item.status !== 'needed' || item.buyerId === me()) return { ok: false };
    return mutate(() => { item.buyerId = me(); logActivity('took over buying', item.name, '#/money/shopping'); return { ok: true }; });
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
      logActivity('added', `${title} to the calendar`, `#/calendar?id=${ev.id}`);
      notify(memberIds(), { type: 'event', title: `${nameOf(me())} added ${title}.`, body: `${L.CATEGORIES[ev.category].label} · ${L.describeEventTime(ev)}`, link: `#/calendar?id=${ev.id}` });
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
      logActivity('updated', `${title} on the calendar`, `#/calendar?id=${ev.id}`);
      notify(memberIds(), { type: 'event', title: `${nameOf(me())} updated ${title}.`, body: L.describeEventTime(ev), link: `#/calendar?id=${ev.id}` });
      return { ok: true };
    });
  }
  function deleteEvent(id) {
    const ev = state.events.find((x) => x.id === id);
    if (!ev || ev.creatorId !== me()) return { ok: false };
    return mutate(() => {
      state.events = state.events.filter((x) => x.id !== id);
      logActivity('removed', `${ev.title} from the calendar`, '#/calendar');
      notify(memberIds(), { type: 'event', title: `${nameOf(me())} removed ${ev.title}.`, body: L.describeEventTime(ev), link: '#/calendar' });
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
    // Shared purchasing budget status (Requirement 4.4). Display-only: never blocks spending.
    // Compares this month's shared spend (`monthTotal`) against the shared budget. Returns a
    // flat summary so the UI can render a "remaining"/"over budget" line.
    budgetStatus: () => {
      const budgetCents = (state.purchasing && state.purchasing.budgetCents) ?? null;
      const spentCents = sel.monthTotal();
      if (budgetCents === null) return { set: false, budgetCents: null, spentCents, remainingCents: null, over: false };
      const remainingCents = budgetCents - spentCents;
      return { set: true, budgetCents, spentCents, remainingCents, over: remainingCents < 0 };
    },
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
    // Chore swaps (Requirement 2): pending requests I could act on or that I started.
    openSwaps: () => state.swaps.filter((s) => s.kind === 'open' && s.status === 'pending' && s.requesterId !== me()),
    incomingSwaps: () => state.swaps.filter((s) => s.kind === 'direct' && s.status === 'pending' && s.addresseeId === me()),
    outgoingSwaps: () => state.swaps.filter((s) => s.status === 'pending' && s.requesterId === me()),
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
    const trash = chore('Take out trash & recycling', 'weekly', all, 'Bins go to the curb the night before pickup.');
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
    ev('Sam away (visiting family)', 'away', sam, lt(4, 8), lt(6, 20));
    ev('Apartment dinner', 'plans', maya, lt(3, 19, 30), lt(3, 21, 30), 'Pasta night. Everyone welcome!');

    // Activity (newest first)
    const act = (actorId, verb, subject, link, n, h) => state.activity.push({ id: uid('act'), actorId, verb, subject, link, ref: null, ts: iso(n, h) });
    act(maya, 'recorded a repayment of', '$20.00 from Maya to Jordan', '#/money/expenses', -1, 18);
    act(priya, 'added', 'Quiet study block (midterm review) to the calendar', '#/calendar', -1, 11);
    act(priya, 'added the expense', 'Cleaning supplies (Target) ($27.43)', '#/money/expenses', -3, 16);
    act(priya, 'purchased', 'Sponges & trash bags', '#/money/shopping', -3, 16);
    act(sam, 'completed', 'Vacuum common areas', '#/chores/done', -3, 15);
    act(jordan, 'added the expense', 'Electric bill ($138.37)', '#/money/expenses', -6, 20);
    state.activity.forEach((a) => { if (a.verb === 'completed') a.ref = v1.id; });
    state.activity.sort((a, b) => b.ts.localeCompare(a.ts));

    // Notifications for Maya (reminders are generated live)
    const nt = (userId, type, title, body, link, h, read = false) => state.notifications.push({ id: uid('n'), userId, type, title, body, link, key: null, read, createdAt: iso(-1, h) });
    nt(maya, 'expense', 'Maya recorded a repayment: Maya paid Jordan $20.00.', 'Paid outside Kasa.', '#/money/expenses', 18, true);
    nt(maya, 'event', 'Priya added Quiet study block (midterm review).', `Quiet / study · ${L.fmtDay(at(1))}`, '#/calendar', 11);
    nt(maya, 'expense', 'Priya added Cleaning supplies (Target).', 'Your share: $6.86 of $27.43', '#/money/expenses', 10, true);

    // ----- v2 feature fixtures (one example of each new entity) -----
    // Auto-rotating chore (Requirement 1): weekly rotation through all four, advancing on schedule.
    // Anchor on today with startIdx = Priya so the current cycle maps to Priya; advanceRotations
    // (run from commit()) will find this occurrence already correct and leave it untouched.
    const rotateOrder = [priya, sam, maya, jordan];
    const bins = chore('Roll bins to the curb (auto-rotates)', 'weekly', rotateOrder, 'Rotates automatically each week — no manual reassigning needed.');
    bins.autoRotate = true;
    bins.anchorDate = at(0);
    bins.cycleDays = 7;
    bins.startIdx = 0; // cycle 0 → rotateOrder[0] = Priya
    occ(bins, at(0), priya, 0).manualOverride = false;

    // Pending swap (Requirement 2): an open request Jordan posted for the overdue kitchen chore.
    const kitchenOcc = state.occurrences.find((o) => o.choreId === kitchen.id);
    state.swaps.push({ id: uid('sw'), kind: 'open', occId: kitchenOcc.id, targetOccId: null, requesterId: kitchenOcc.assigneeId, addresseeId: null, status: 'pending', resolvedBy: null, createdAt: iso(-1, 8), resolvedAt: null });

    // Shared household expectations (Requirement 3).
    const exp = (text, by, n, h) => state.expectations.push({ id: uid('exp'), text, createdBy: by, createdAt: iso(n, h), updatedBy: by, updatedAt: iso(n, h) });
    exp('Quiet after 11pm on weeknights', maya, -14, 20);
    exp('Dishes done the same day you use them', priya, -10, 9);

    // Shared purchasing rules (Requirement 4): budget + a preferred product + a store preference.
    state.purchasing.budgetCents = 30000; // $300.00 shared monthly budget
    state.purchasing.preferredProducts.push({ id: uid('pp'), text: 'Seventh Generation dish soap', createdBy: maya, createdAt: iso(-12, 11) });
    state.purchasing.storePreferences.push({ id: uid('sp'), text: 'Costco for bulk paper goods', createdBy: jordan, createdAt: iso(-9, 17) });

    // Local roommate profiles (Requirement 5): populate a few, leave Sam at defaults to show empty state.
    const profileOf = (id) => state.members.find((m) => m.id === id).profile;
    Object.assign(profileOf(maya), { dietary: 'Vegetarian', budgetCents: 15000, rules: '' });
    Object.assign(profileOf(priya), { dietary: '', budgetCents: null, rules: 'No overnight guests on exam weeks.' });
    Object.assign(profileOf(jordan), { dietary: 'No shellfish', budgetCents: 20000, rules: '' });

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
    requestOpenSwap, cancelSwap, acceptOpenSwap, proposeDirectSwap, respondDirectSwap,
    addExpectation, editExpectation, removeExpectation,
    setPurchasingBudget, addPreferredProduct, removePreferredProduct, addStorePreference, removeStorePreference,
    updateProfile,
    addExpense, editExpense, deleteExpense, addReimbursement, deleteReimbursement,
    addItem, editItem, deleteItem, claimItem, takeOverItem, addItemAgain, purchaseItem, reopenItem,
    addEvent, editEvent, deleteEvent,
    setRead, markAllRead, setPrefs, undoLast, runReminders: () => { const advanced = advanceRotations(today()); if (generateReminders() || advanced) { save(); emit(); } },
    // Log a usage event (e.g. tutorial progress) into the same on-device analytics the Settings export reads. No network, no profiles.
    trackEvent: (name, props = {}) => { if (!state) return; track(name, props); save(); },
    exportAnalytics: () => JSON.stringify({ household: state.household.id, mode: state.mode, exportedAt: nowISO(), events: state.analytics, completions: state.occurrences.filter((o) => o.doneAt).map((o) => ({ title: o.title, due: o.due, doneAt: o.doneAt, doneBy: o.doneBy, assigneeId: o.assigneeId })) }, null, 2),
  };
}
