// Per-tab onboarding coachmarks. Dependency-free; no accounts, no backend.
// Each tab (home/chores/money/calendar/profile) gets one short, single-step coachmark the
// first time it's opened, reusing the low-level ring/card chrome + positioning primitives.
// "Seen" state is a small per-tab map in localStorage — not tied to any user profile.

// ---------- anchor helpers (shared by COACHMARKS) ----------
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

// ---------- per-tab coachmark seen-state (Requirement 6) ----------
// Onboarding is per-tab: each tab (home/chores/money/calendar/profile) has its own "seen" flag,
// stored as a small map under one key so tabs are independent (6.3) and resettable together (6.4).
// Every accessor is wrapped in try/catch so a blocked/throwing storage fails quietly (6.6).
const COACH_KEY = 'roomsync.coach.v1'; // { home:true, chores:true, money:true, calendar:true, profile:true }

function readCoachMap(storage) {
  try {
    const raw = storage.getItem(COACH_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

export function coachSeen(storage, tab) {
  try { return readCoachMap(storage)[tab] === true; } catch { return false; }
}

export function markCoachSeen(storage, tab) {
  try {
    const map = readCoachMap(storage);
    map[tab] = true;
    storage.setItem(COACH_KEY, JSON.stringify(map));
  } catch { /* storage blocked: coachmark just won't persist */ }
}

export function resetCoachmarks(storage) {
  try { storage.removeItem(COACH_KEY); } catch { /* ignore */ }
}

// ---------- per-tab coachmark content ----------
// One short lesson per tab, anchored to a reliably-present element. `money` anchors to `.tabs`
// (always present on that route); if an anchor is missing the engine's center fallback handles it (6.5).
const COACHMARKS = {
  home: {
    find: firstVisible('.dash', 'main'),
    title: 'Home shows what matters now',
    body: 'Your due chores, balance, upcoming plans and the shopping preview live here. The tabs below (or the sidebar on a computer) open the full sections.',
  },
  chores: {
    find: firstVisible('.add-row[data-action="add-chore"]', '[data-action="add-chore"]', 'main'),
    title: 'Chores and whose turn it is',
    body: 'Check off what you did and see who’s next. “Add chore” sets who’s responsible, a due date, and weekly rotation — turn on “Advance automatically” so turns rotate on schedule. Need a hand? Use a chore’s menu to ask someone to take it or offer a trade.',
  },
  money: {
    find: firstVisible('.tabs'),
    title: 'Expenses & Shopping together',
    body: 'This tab holds both shared expenses (who paid, who owes) and the shopping list, switched via the two tabs at the top. Set shared purchasing rules — a monthly budget and preferred products/stores — and watch the budget line track this month’s spending (it never blocks a purchase).',
  },
  calendar: {
    find: firstVisible('[data-action="add-event"]', 'main'),
    title: 'The shared calendar',
    body: 'Quiet hours, guests, away days and plans live here. Use “Add event” to pick a type and set start/end dates and times.',
  },
  profile: {
    find: firstVisible('.profile-head', 'main'),
    title: 'Your roommate profile',
    body: 'Set dietary notes, a personal budget, and your personal rules so the household can see your preferences. This is a local, interim profile — no account or sync yet.',
  },
};

// Show a single-step coachmark for `tab`, reusing the tour's ring/card chrome and positioning.
// Returns true if a coachmark was displayed, false if the tab has no content. `track` logs
// shown/seen analytics via the existing on-device analytics (6.7). `onEnd` fires on dismissal.
export function showCoachmark({ tab, storage, track, onEnd } = {}) {
  const content = COACHMARKS[tab];
  if (!content) { onEnd && onEnd({ tab, shown: false }); return false; }
  if (active) endCoachmark();
  const trackFn = track || (() => {});
  active = {
    i: 0,
    coach: true,
    tab,
    content,
    navigate: () => {},
    track: trackFn,
    storage,
    onEnd: (res) => onEnd && onEnd({ tab, shown: true, ...res }),
    els: buildChrome(),
    keyHandler: null,
    resizeHandler: null,
  };
  trackFn('coachmark_shown', { tab });
  bindGlobalHandlers();
  renderCoachmark();
  return true;
}

function renderCoachmark() {
  if (!active || !active.coach) return;
  const { progress, title, text, back, next } = active.els;
  const { content } = active;
  progress.textContent = '';
  title.textContent = content.title;
  text.textContent = content.body;
  back.hidden = true;
  next.textContent = 'Got it';
  // Single step: resolve the anchor with a few retries (covers async re-render), center-fallback otherwise.
  resolveCoachAnchor(content, 6);
}

function resolveCoachAnchor(content, triesLeft) {
  if (!active || active.content !== content) return;
  const el = content.find ? content.find() : null;
  if (el || triesLeft <= 0) {
    active._lastEl = el || null;
    position(el || null, el ? 'auto' : 'center');
    if (el) try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* older browsers */ }
    // non-blocking tip: do not steal focus from the page. The card stays in the tab order and is
    // dismissable via its buttons or Escape; grabbing focus here would disrupt a user mid-task.
    return;
  }
  setTimeout(() => resolveCoachAnchor(content, triesLeft - 1), 90);
}

// ---------- engine ----------
let active = null;

// Tear down the active coachmark: remove chrome + global handlers, log the "seen" event, fire onEnd.
export function endCoachmark({ completed = false } = {}) {
  if (!active) return;
  const { els, keyHandler, resizeHandler, onEnd, tab } = active;
  if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
  if (resizeHandler) { window.removeEventListener('resize', resizeHandler); window.removeEventListener('scroll', resizeHandler, true); }
  els.root.remove();
  // Coachmarks persist their own per-tab seen-state (via markCoachSeen in app wiring).
  active.track('coachmark_seen', { tab });
  active = null;
  onEnd && onEnd({ completed });
}

function buildChrome() {
  const root = document.createElement('div');
  root.className = 'tour-root tour-coach';
  root.innerHTML = `
    <div class="tour-backdrop" data-tour="backdrop"></div>
    <div class="tour-ring" data-tour="ring" hidden></div>
    <div class="tour-card" data-tour="card" role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body">
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
  els.skip.addEventListener('click', () => endCoachmark({ completed: false }));
  els.next.addEventListener('click', () => endCoachmark({ completed: true }));
  // Clicking the dimmed backdrop does nothing destructive (prevents accidental dismissal); Skip is explicit.
  els.backdrop.addEventListener('click', (e) => e.stopPropagation());
  return els;
}

function bindGlobalHandlers() {
  // non-blocking: only Escape dismisses, and only when it isn't closing an open modal dialog.
  // We must NOT hijack Enter/ArrowRight/typing — the page (forms, menus) owns the keyboard while
  // a coachmark floats. Bubble phase (not capture) so modal/menu handlers get the key first.
  active.keyHandler = (e) => {
    if (e.key !== 'Escape') return;
    const modal = document.getElementById('modal');
    if (modal && modal.open) return; // let the dialog handle its own Escape
    endCoachmark({ completed: false });
  };
  document.addEventListener('keydown', active.keyHandler);
  active.resizeHandler = () => { if (active) position(active._lastEl); };
  window.addEventListener('resize', active.resizeHandler);
  window.addEventListener('scroll', active.resizeHandler, true);
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
