// Guided, click-through product tour. Dependency-free; no accounts, no backend.
// Walks a first-time user to each tab and points at the real controls for the most
// common tasks (find shopping/expenses, add items, record a purchase + price, set event times).
// "Seen" state is a single localStorage flag — not tied to any user profile.

const SEEN_KEY = 'roomsync.tour.v1';

// ---------- seen flag ----------
export function tourSeen(storage) {
  try { return storage.getItem(SEEN_KEY) === 'done'; } catch { return false; }
}
function markSeen(storage) {
  try { storage.setItem(SEEN_KEY, 'done'); } catch { /* storage blocked: tour just won't persist */ }
}
export function resetTourSeen(storage) {
  try { storage.removeItem(SEEN_KEY); } catch { /* ignore */ }
}

// ---------- step definitions ----------
// Each step: a short lesson anchored to a real element. `route` navigates first (via location.hash),
// `find` returns the element to spotlight (tried after the route renders, with retries).
// Narrow (mobile) and wide (desktop) layouts expose different nav elements, so anchors use fallbacks.
const q = (sel) => () => document.querySelector(sel);
// First matching selector that is actually visible (handles sidebar vs bottom-nav swap).
const firstVisible = (...sels) => () => {
  for (const s of sels) {
    for (const el of document.querySelectorAll(s)) {
      if (el.offsetParent !== null || el.getClientRects().length) return el;
    }
  }
  return null;
};

const STEPS = [
  {
    id: 'welcome',
    route: '#/home',
    find: firstVisible('.household'),
    title: 'Welcome to RoomSync',
    body: 'Quick tour: 60 seconds to see where everything lives and how to add things. You can skip anytime, and replay it later from Settings.',
    place: 'center',
  },
  {
    id: 'home',
    route: '#/home',
    find: firstVisible('.dash', 'main'),
    title: 'Home shows what matters now',
    body: 'Your due chores, balance, upcoming plans and the shopping list preview are all here. The tabs below (or the sidebar on a computer) take you to the full sections.',
    place: 'auto',
  },
  {
    id: 'nav-chores',
    route: '#/home',
    find: firstVisible('.sidebar .nav[href="#/chores/mine"]', '.bottomnav a[href="#/chores/mine"]'),
    title: 'Chores tab',
    body: 'Tap here to see chores. This is where you check off what you did, see who’s next in the rotation, and add new chores.',
    place: 'auto',
    advanceHint: 'chores',
  },
  {
    id: 'chores-add',
    route: '#/chores/mine',
    find: firstVisible('.add-row[data-action="add-chore"]', '[data-action="add-chore"]'),
    title: 'Add a chore',
    body: 'Use “Add chore” to create a task, pick who’s responsible, set a due date, and choose whether it repeats weekly and rotates between roommates.',
    place: 'auto',
  },
  {
    id: 'nav-money',
    route: '#/chores/mine',
    find: firstVisible('.sidebar .nav[href="#/money/expenses"]', '.bottomnav a[href="#/money/expenses"]'),
    title: 'Expenses & Shopping live together',
    body: 'This tab holds BOTH shared expenses and the shopping list. A lot of people miss that — they share one place with two tabs at the top.',
    place: 'auto',
    advanceHint: 'money',
  },
  {
    id: 'money-tabs',
    route: '#/money/expenses',
    find: firstVisible('.tabs'),
    title: 'Two tabs: Expenses and Shopping',
    body: 'Switch between “Expenses” (who paid, who owes) and “Shopping” (what to buy) right here at the top. Let’s look at each.',
    place: 'auto',
  },
  {
    id: 'expenses-add',
    route: '#/money/expenses',
    find: firstVisible('[data-action="add-expense"]'),
    title: 'Add an expense',
    body: 'Record something someone paid for. Enter the amount, who paid, and split it between roommates. To change a price later, open the expense’s menu and choose Edit.',
    place: 'auto',
  },
  {
    id: 'expenses-balance',
    route: '#/money/expenses',
    find: firstVisible('.panel-soft'),
    title: 'Balances update automatically',
    body: 'Your balance and “who owes whom” recalculate every time an expense or repayment changes. No math on your end.',
    place: 'auto',
  },
  {
    id: 'nav-shopping',
    route: '#/money/expenses',
    find: firstVisible('.tabs a[href="#/money/shopping"]'),
    title: 'Open the Shopping tab',
    body: 'Here’s the shopping list. Tap it to see what the apartment needs and to add items.',
    place: 'auto',
    advanceHint: 'shopping',
  },
  {
    id: 'shopping-add',
    route: '#/money/shopping',
    find: firstVisible('.quick-add #qa-name', '.quick-add'),
    title: 'Add an item fast',
    body: 'Type an item name (and optional quantity) and press Add. It drops straight into “Needed”. Anyone can claim an item to say they’ll buy it.',
    place: 'auto',
  },
  {
    id: 'shopping-purchase',
    route: '#/money/shopping',
    find: firstVisible('#need .chk[data-action="purchase"]', '.chk[data-action="purchase"]'),
    title: 'Buy it, and set the price',
    body: 'When you’ve bought something, tap its circle to mark it purchased. You’ll be asked for the price — that creates a shared expense automatically and splits it, so Shopping and Expenses stay in sync.',
    place: 'auto',
  },
  {
    id: 'nav-calendar',
    route: '#/money/shopping',
    find: firstVisible('.sidebar .nav[href="#/calendar"]', '.bottomnav a[href="#/calendar"]'),
    title: 'Calendar tab',
    body: 'Last stop: the shared calendar for quiet hours, guests, away days and plans. Tap here.',
    place: 'auto',
    advanceHint: 'calendar',
  },
  {
    id: 'calendar-add',
    route: '#/calendar',
    find: firstVisible('[data-action="add-event"]'),
    title: 'Add an event and set the time',
    body: 'Use “Add event” to pick a type, a start and end date, and start/end times. To change a time later, open the event and choose Edit — update the time fields and save.',
    place: 'auto',
  },
  {
    id: 'done',
    route: '#/home',
    find: firstVisible('.household'),
    title: 'That’s the tour',
    body: 'You know where chores, expenses, shopping and the calendar live, and how to add to each. Replay this anytime from Settings → Replay tutorial.',
    place: 'center',
  },
];

// ---------- engine ----------
let active = null;

export function startTour({ navigate, track, storage, onEnd } = {}) {
  if (active) endTour();
  active = {
    i: 0,
    navigate: navigate || ((hash) => { location.hash = hash; }),
    track: track || (() => {}),
    storage,
    onEnd,
    els: buildChrome(),
    keyHandler: null,
    resizeHandler: null,
  };
  active.track('tutorial_started', { steps: STEPS.length });
  bindGlobalHandlers();
  go(0);
  return true;
}

export function endTour({ completed = false } = {}) {
  if (!active) return;
  const { els, keyHandler, resizeHandler, storage, onEnd, i } = active;
  if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
  if (resizeHandler) { window.removeEventListener('resize', resizeHandler); window.removeEventListener('scroll', resizeHandler, true); }
  els.root.remove();
  if (storage) markSeen(storage);
  active.track(completed ? 'tutorial_completed' : 'tutorial_skipped', { step: i, stepId: STEPS[i] && STEPS[i].id });
  active = null;
  onEnd && onEnd({ completed });
}

function buildChrome() {
  const root = document.createElement('div');
  root.className = 'tour-root';
  root.innerHTML = `
    <div class="tour-backdrop" data-tour="backdrop"></div>
    <div class="tour-ring" data-tour="ring" hidden></div>
    <div class="tour-card" data-tour="card" role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
      <p class="tour-step" data-tour="progress"></p>
      <h2 id="tour-title" data-tour="title"></h2>
      <p id="tour-body" data-tour="text"></p>
      <div class="tour-actions">
        <button type="button" class="tour-skip" data-tour="skip">Skip</button>
        <span class="tour-spacer"></span>
        <button type="button" class="tour-back btn quiet sm" data-tour="back">Back</button>
        <button type="button" class="tour-next btn primary sm" data-tour="next">Next</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const pick = (n) => root.querySelector(`[data-tour="${n}"]`);
  const els = { root, backdrop: pick('backdrop'), ring: pick('ring'), card: pick('card'), progress: pick('progress'), title: pick('title'), text: pick('text'), skip: pick('skip'), back: pick('back'), next: pick('next') };
  els.skip.addEventListener('click', () => endTour({ completed: false }));
  els.back.addEventListener('click', () => go(active.i - 1));
  els.next.addEventListener('click', () => {
    if (active.i >= STEPS.length - 1) return endTour({ completed: true });
    go(active.i + 1);
  });
  // Clicking the dimmed backdrop does nothing destructive (prevents accidental dismissal); Skip is explicit.
  els.backdrop.addEventListener('click', (e) => e.stopPropagation());
  return els;
}

function bindGlobalHandlers() {
  active.keyHandler = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endTour({ completed: false }); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); active.els.next.click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (active.i > 0) go(active.i - 1); }
  };
  document.addEventListener('keydown', active.keyHandler, true);
  active.resizeHandler = () => { if (active) position(active._lastEl); };
  window.addEventListener('resize', active.resizeHandler);
  window.addEventListener('scroll', active.resizeHandler, true);
}

function go(index) {
  if (!active) return;
  const i = Math.max(0, Math.min(STEPS.length - 1, index));
  active.i = i;
  const step = STEPS[i];
  active.track('tutorial_step', { step: i, stepId: step.id });

  // Navigate if this step lives on another route, then wait for the app to re-render.
  const needNav = step.route && location.hash !== step.route;
  if (needNav) active.navigate(step.route);

  const { progress, title, text, back, next } = active.els;
  progress.textContent = `Step ${i + 1} of ${STEPS.length}`;
  title.textContent = step.title;
  text.textContent = step.body;
  back.hidden = i === 0;
  next.textContent = i >= STEPS.length - 1 ? 'Finish' : 'Next';

  // Resolve the anchor element with a few retries (covers async re-render after navigation).
  resolveAnchor(step, needNav ? 12 : 6);
}

function resolveAnchor(step, triesLeft) {
  if (!active || STEPS[active.i] !== step) return;
  const el = step.find ? step.find() : null;
  if (el || triesLeft <= 0 || step.place === 'center') {
    active._lastEl = el || null;
    position(el || null, step.place);
    if (el) try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* older browsers */ }
    // Focus the card so keyboard users land in the tour, not the page behind it.
    setTimeout(() => active && active.els.card.focus?.(), 60);
    return;
  }
  setTimeout(() => resolveAnchor(step, triesLeft - 1), 90);
}

// Place the spotlight ring over `el` and the card near it, kept inside the viewport.
function position(el, place = 'auto') {
  if (!active) return;
  const { ring, card } = active.els;
  const pad = 6;
  if (!el || place === 'center') {
    ring.hidden = true;
    card.style.left = `${Math.max(12, (window.innerWidth - card.offsetWidth) / 2)}px`;
    card.style.top = `${Math.max(12, (window.innerHeight - card.offsetHeight) / 2)}px`;
    return;
  }
  const r = el.getBoundingClientRect();
  ring.hidden = false;
  ring.style.left = `${r.left - pad}px`;
  ring.style.top = `${r.top - pad}px`;
  ring.style.width = `${r.width + pad * 2}px`;
  ring.style.height = `${r.height + pad * 2}px`;

  const cw = card.offsetWidth || 320, ch = card.offsetHeight || 180, gap = 14;
  const spaceBelow = window.innerHeight - r.bottom, spaceAbove = r.top;
  let top, left;
  if (spaceBelow > ch + gap || spaceBelow > spaceAbove) top = Math.min(r.bottom + gap, window.innerHeight - ch - 12);
  else top = Math.max(12, r.top - ch - gap);
  left = Math.min(Math.max(12, r.left + r.width / 2 - cw / 2), window.innerWidth - cw - 12);
  card.style.left = `${left}px`;
  card.style.top = `${Math.max(12, top)}px`;
}
