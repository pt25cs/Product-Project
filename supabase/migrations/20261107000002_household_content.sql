-- Kasa Phase 2 — household-content tables (Requirement 5 migration target, 6, 8).
-- These host the authenticated household and receive the one-time local import.
-- Field shapes mirror web/js/store.js state so the client maps 1:1. Every table
-- carries household_id and is RLS-scoped to members via is_household_member().
--
-- Convention: columns that the client treats as nested objects/arrays (splits,
-- rotation, participant lists) are JSONB; money is integer cents; local dates are
-- text 'YYYY-MM-DD'; local datetimes are text 'YYYY-MM-DDTHH:mm'; timestamps are
-- timestamptz. Client-generated string ids are preserved in a `client_id` column
-- so migration can keep relationships (R5.2).

-- Reusable RLS helper macro pattern: each table gets select/insert/update/delete
-- scoped to is_household_member(household_id).

-- ---------------------------------------------------------------------------
-- chores (templates: recurrence, rotation, auto-rotation metadata)
-- ---------------------------------------------------------------------------
create table public.chores (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  client_id    text,
  title        text not null check (char_length(title) between 1 and 80),
  notes        text not null default '' check (char_length(notes) <= 300),
  recurrence   text not null check (recurrence in ('once', 'weekly')),
  rotation     jsonb not null default '[]'::jsonb,   -- array of membership client_ids
  auto_rotate  boolean not null default false,
  anchor_date  text,                                 -- 'YYYY-MM-DD' or null
  cycle_days   integer not null default 7 check (cycle_days between 1 and 365),
  start_idx    integer not null default 0,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  unique (household_id, client_id)
);
create index chores_household_idx on public.chores (household_id);

-- ---------------------------------------------------------------------------
-- occurrences (dated instances of a chore)
-- ---------------------------------------------------------------------------
create table public.occurrences (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  client_id       text,
  chore_client_id text,                               -- links to chores.client_id
  title           text not null,
  notes           text not null default '',
  due             text not null,                      -- 'YYYY-MM-DD'
  assignee_id     text,                               -- membership client_id
  rot_idx         integer,
  done_by         text,
  done_at         timestamptz,
  next_occ_id     text,
  manual_override boolean not null default false,
  unique (household_id, client_id)
);
create index occurrences_household_idx on public.occurrences (household_id);

-- ---------------------------------------------------------------------------
-- expenses (with stored splits)
-- ---------------------------------------------------------------------------
create table public.expenses (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households (id) on delete cascade,
  client_id         text,
  description       text not null check (char_length(description) between 1 and 80),
  amount_cents      integer not null check (amount_cents > 0),
  date              text not null,                    -- 'YYYY-MM-DD'
  payer_id          text not null,                    -- membership client_id
  participant_ids   jsonb not null default '[]'::jsonb,
  splits            jsonb not null default '{}'::jsonb,
  shopping_item_id  text,
  token             text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz,
  unique (household_id, client_id)
);
create index expenses_household_idx on public.expenses (household_id);

-- ---------------------------------------------------------------------------
-- reimbursements (recorded repayments; Kasa never moves money)
-- ---------------------------------------------------------------------------
create table public.reimbursements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  client_id    text,
  from_id      text not null,
  to_id        text not null,
  amount_cents integer not null check (amount_cents > 0),
  date         text not null,
  note         text not null default '',
  token        text,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  unique (household_id, client_id)
);
create index reimbursements_household_idx on public.reimbursements (household_id);

-- ---------------------------------------------------------------------------
-- shopping (items; purchase links to an expense)
-- ---------------------------------------------------------------------------
create table public.shopping (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  client_id     text,
  name          text not null check (char_length(name) between 1 and 60),
  qty           text not null default '1',
  notes         text not null default '',
  buyer_id      text,
  status        text not null default 'needed' check (status in ('needed', 'purchased')),
  purchased_by  text,
  purchased_at  timestamptz,
  expense_id    text,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  unique (household_id, client_id)
);
create index shopping_household_idx on public.shopping (household_id);

-- ---------------------------------------------------------------------------
-- events (shared calendar)
-- ---------------------------------------------------------------------------
create table public.events (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  client_id    text,
  title        text not null check (char_length(title) between 1 and 80),
  category     text not null check (category in ('away', 'quiet', 'guest', 'plans')),
  creator_id   text not null,
  start        text not null,                         -- 'YYYY-MM-DDTHH:mm'
  "end"        text not null,
  notes        text not null default '',
  created_at   timestamptz not null default now(),
  unique (household_id, client_id)
);
create index events_household_idx on public.events (household_id);

-- ---------------------------------------------------------------------------
-- expectations (shared household norms; Requirement 3)
-- ---------------------------------------------------------------------------
create table public.expectations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  client_id    text,
  text         text not null check (char_length(text) between 1 and 300),
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_by   text,
  updated_at   timestamptz not null default now(),
  unique (household_id, client_id)
);
create index expectations_household_idx on public.expectations (household_id);

-- ---------------------------------------------------------------------------
-- purchasing (shared rules; one row per household; Requirement 4)
-- ---------------------------------------------------------------------------
create table public.purchasing (
  household_id       uuid primary key references public.households (id) on delete cascade,
  budget_cents       integer check (budget_cents is null or budget_cents > 0),
  preferred_products jsonb not null default '[]'::jsonb,
  store_preferences  jsonb not null default '[]'::jsonb,
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- swaps (chore swaps; Requirement 2)
-- ---------------------------------------------------------------------------
create table public.swaps (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households (id) on delete cascade,
  client_id     text,
  kind          text not null check (kind in ('open', 'direct')),
  occ_id        text,
  target_occ_id text,
  requester_id  text,
  addressee_id  text,
  status        text not null check (status in ('pending', 'accepted', 'declined', 'cancelled', 'invalidated')),
  resolved_by   text,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  unique (household_id, client_id)
);
create index swaps_household_idx on public.swaps (household_id);

-- ---------------------------------------------------------------------------
-- notifications (per-user, within a household)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  client_id    text,
  user_id      text not null,                         -- membership client_id (recipient)
  type         text not null,
  title        text not null,
  body         text not null default '',
  link         text not null default '#/home',
  key          text,
  read         boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (household_id, client_id)
);
create index notifications_household_idx on public.notifications (household_id);

-- ---------------------------------------------------------------------------
-- activity (household feed)
-- ---------------------------------------------------------------------------
create table public.activity (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  client_id    text,
  actor_id     text,
  verb         text not null,
  subject      text not null default '',
  link         text,
  ref          text,
  ts           timestamptz not null default now(),
  unique (household_id, client_id)
);
create index activity_household_idx on public.activity (household_id);

-- ---------------------------------------------------------------------------
-- prefs (per-user reminder/notification preferences within a household)
-- ---------------------------------------------------------------------------
create table public.prefs (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      text not null,                         -- membership client_id
  data         jsonb not null default '{}'::jsonb,    -- { reminders, leadDays, updates, channels }
  primary key (household_id, user_id)
);

-- ===========================================================================
-- RLS: enable + membership-scoped policies on every content table.
-- Done in a loop so the policy set is identical and auditable.
-- ===========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'chores','occurrences','expenses','reimbursements','shopping','events',
    'expectations','purchasing','swaps','notifications','activity','prefs'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);

    execute format($f$
      create policy %1$s_select on public.%1$I
        for select to authenticated
        using (public.is_household_member(household_id));
    $f$, t);

    execute format($f$
      create policy %1$s_insert on public.%1$I
        for insert to authenticated
        with check (public.is_household_member(household_id));
    $f$, t);

    execute format($f$
      create policy %1$s_update on public.%1$I
        for update to authenticated
        using (public.is_household_member(household_id))
        with check (public.is_household_member(household_id));
    $f$, t);

    execute format($f$
      create policy %1$s_delete on public.%1$I
        for delete to authenticated
        using (public.is_household_member(household_id));
    $f$, t);
  end loop;
end $$;
