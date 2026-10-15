// Pure helpers: dates, money, splitting, balances, rotation. No DOM, no storage.

export const pad = (n) => String(n).padStart(2, '0');

// ---------- Dates (all calendar dates are local "YYYY-MM-DD"; times are local "YYYY-MM-DDTHH:mm") ----------
export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function toDateTimeStr(d) {
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function parseDate(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return toDateStr(parseDate(s)) === s;
}
export function isValidTime(s) {
  return typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
/** Whole days from a to b (b - a). */
export function diffDays(a, b) {
  const A = parseDate(a), B = parseDate(b);
  return Math.round((Date.UTC(B.getFullYear(), B.getMonth(), B.getDate()) - Date.UTC(A.getFullYear(), A.getMonth(), A.getDate())) / 86400000);
}
/** Weeks start on Monday. */
export function startOfWeek(s) {
  return addDays(s, -((parseDate(s).getDay() + 6) % 7));
}
export const dtDate = (s) => s.slice(0, 10);
export const dtTime = (s) => s.slice(11, 16);

const F = {
  day: new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
  md: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }),
  wk: new Intl.DateTimeFormat('en-US', { weekday: 'short' }),
  time: new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }),
  stamp: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
  month: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }),
  full: new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
  wlong: new Intl.DateTimeFormat('en-US', { weekday: 'long' }),
};
export const fmtDay = (s) => F.day.format(parseDate(s));
export const fmtMonthDay = (s) => F.md.format(parseDate(s));
export const fmtWeekday = (s) => F.wk.format(parseDate(s));
export const fmtMonth = (s) => F.month.format(parseDate(s));
export const fmtFull = (s) => F.full.format(parseDate(s));
export const fmtWeekdayLong = (s) => F.wlong.format(parseDate(s));
export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return F.time.format(new Date(2000, 0, 1, h, m));
}
export const fmtStamp = (iso) => F.stamp.format(new Date(iso));
export function relativeDue(due, today) {
  const d = diffDays(today, due);
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d === -1) return '1 day overdue';
  if (d < 0) return `${-d} days overdue`;
  return `Due ${fmtDay(due)}`;
}

// ---------- Money (integer cents everywhere) ----------
/** Parse user input like "12", "$1,234.5", "0.99" into positive integer cents, or null. */
export function parseMoney(input) {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  const cents = Number(w) * 100 + Number((f + '00').slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000) return null;
  return cents;
}
export function fmtMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  const a = Math.abs(cents);
  return `${sign}$${Math.floor(a / 100).toLocaleString('en-US')}.${pad(a % 100)}`;
}

/**
 * Equal split with deterministic rounding: everyone gets floor(total/n) cents; the
 * leftover cents (0..n-1) go one each to the first participants in the order given
 * (callers pass household member order). Shares always sum exactly to the total.
 */
export function splitEqual(totalCents, participantIds) {
  const n = participantIds.length;
  const base = Math.floor(totalCents / n);
  const rem = totalCents - base * n;
  const out = {};
  participantIds.forEach((id, i) => { out[id] = base + (i < rem ? 1 : 0); });
  return out;
}

/** Net balance per member in cents: positive = is owed, negative = owes. */
export function computeBalances(memberIds, expenses, reimbursements) {
  const net = {};
  memberIds.forEach((id) => { net[id] = 0; });
  const add = (id, c) => { net[id] = (net[id] || 0) + c; };
  for (const e of expenses) {
    add(e.payerId, e.amountCents);
    for (const [id, c] of Object.entries(e.splits)) add(id, -c);
  }
  for (const r of reimbursements) {
    add(r.fromId, r.amountCents); // paid someone back -> owes less
    add(r.toId, -r.amountCents);  // was paid back -> is owed less
  }
  return net;
}

/** Greedy, deterministic suggestion of who could pay whom to settle everything. */
export function suggestSettlements(net, order) {
  const idx = (id) => order.indexOf(id);
  const debtors = order.filter((id) => net[id] < 0).map((id) => ({ id, c: -net[id] }));
  const creditors = order.filter((id) => net[id] > 0).map((id) => ({ id, c: net[id] }));
  const byAmt = (a, b) => b.c - a.c || idx(a.id) - idx(b.id);
  debtors.sort(byAmt); creditors.sort(byAmt);
  const out = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amt = Math.min(debtors[i].c, creditors[j].c);
    out.push({ from: debtors[i].id, to: creditors[j].id, cents: amt });
    debtors[i].c -= amt; creditors[j].c -= amt;
    if (debtors[i].c === 0) i++;
    if (creditors[j].c === 0) j++;
  }
  return out;
}

// ---------- Chore rotation ----------
/** Assignee of the occurrence that follows `occ` (round-robin; same person when no rotation). */
export function nextAssigneeId(chore, occ) {
  const r = chore && chore.rotation;
  if (!r || !r.length) return occ.assigneeId;
  return r[(occ.rotIdx + 1) % r.length];
}
export function nextRotIdx(chore, occ) {
  const r = chore && chore.rotation;
  return r && r.length ? (occ.rotIdx + 1) % r.length : -1;
}
/** Next weekly due date; skips any weeks already in the past so no backlog is created. */
export function nextDue(due, today) {
  let n = addDays(due, 7);
  while (n < today) n = addDays(n, 7);
  return n;
}

// ---------- Calendar ----------
export const CATEGORIES = {
  away: { label: 'Away', hint: 'Away or unavailable' },
  quiet: { label: 'Quiet / study', hint: 'Quiet or study time' },
  guest: { label: 'Guests', hint: 'Guests coming over (FYI only)' },
  plans: { label: 'Household plans', hint: 'Shared plans' },
};
export const eventOnDay = (ev, day) => dtDate(ev.start) <= day && day <= dtDate(ev.end);
export function describeEventTime(ev) {
  const sd = dtDate(ev.start), ed = dtDate(ev.end);
  if (sd === ed) return `${fmtDay(sd)} · ${fmtTime(dtTime(ev.start))}–${fmtTime(dtTime(ev.end))}`;
  return `${fmtDay(sd)} ${fmtTime(dtTime(ev.start))} → ${fmtDay(ed)} ${fmtTime(dtTime(ev.end))}`;
}
