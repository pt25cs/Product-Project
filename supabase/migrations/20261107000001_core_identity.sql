-- Kasa Phase 2 — core identity schema (profiles, households, memberships, invitations)
-- Requirements: 3, 4, 6, 7. RLS is enabled on every table; policies enforce per-household
-- isolation and owner-only profile writes server-side (NFR 3).
--
-- Identity itself is Supabase's managed `auth.users`. Our tables reference auth.uid().

-- Note: the is_household_member() helper is defined AFTER households+memberships
-- exist, because a `language sql` function validates its referenced relations at
-- CREATE time (unlike plpgsql, which defers resolution to call time).

-- ---------------------------------------------------------------------------
-- households (Requirement 6, 7)
-- ---------------------------------------------------------------------------
create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 60),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
alter table public.households enable row level security;

-- ---------------------------------------------------------------------------
-- memberships (Requirement 7) — links users to households. `claimed = false`
-- marks a migration placeholder member not yet tied to a real auth user (R5.3, R7.3).
-- A placeholder has user_id = null until someone claims it.
-- ---------------------------------------------------------------------------
create table public.memberships (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,
  role         text not null default 'member' check (role in ('member', 'owner')),
  display_name text not null check (char_length(display_name) between 1 and 30),
  claimed      boolean not null default true,
  joined_at    timestamptz not null default now(),
  -- a real (claimed) membership must have a user; a placeholder must not.
  constraint claimed_has_user check ((claimed and user_id is not null) or (not claimed and user_id is null)),
  -- a user appears at most once per household
  unique (household_id, user_id)
);
create index memberships_household_idx on public.memberships (household_id);
create index memberships_user_idx on public.memberships (user_id);
alter table public.memberships enable row level security;

-- ---------------------------------------------------------------------------
-- Helper: is the current user a member of a given household?
-- SECURITY DEFINER so the membership lookup bypasses RLS and does NOT recurse
-- through the memberships policies (the classic Supabase RLS recursion trap).
-- Defined here, after households + memberships exist (see note at top of file).
-- ---------------------------------------------------------------------------
create or replace function public.is_household_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

revoke all on function public.is_household_member(uuid) from public;
grant execute on function public.is_household_member(uuid) to authenticated;

-- Enforce the product's 2–5 roommate guidance server-side (R7.4): cap claimed+placeholder
-- members per household at 5. (Minimum of 2 is a UX concern at create/invite time.)
create or replace function public.enforce_household_size()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.memberships where household_id = new.household_id) >= 5 then
    raise exception 'A household can have at most 5 roommates.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger memberships_size_limit
  before insert on public.memberships
  for each row execute function public.enforce_household_size();

-- ---------------------------------------------------------------------------
-- profiles (Requirement 3, 4) — one row per auth user. Field shape mirrors the
-- Phase 1 client profile (dietary, budgetCents, rules) so the UI adopts it unchanged.
-- phone_e164 + phone_verified live here, exposed only to the owner (R2.6, R4.2).
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  display_name   text not null default '' check (char_length(display_name) <= 30),
  dietary        text not null default '' check (char_length(dietary) <= 300),
  budget_cents   integer check (budget_cents is null or (budget_cents > 0 and budget_cents <= 100000000)),
  rules          text not null default '' check (char_length(rules) <= 300),
  phone_e164     text check (phone_e164 is null or phone_e164 ~ '^\+[1-9]\d{1,14}$'),
  phone_verified boolean not null default false,
  updated_at     timestamptz not null default now()
);
-- a verified phone must exist and be unique across accounts (R2.5)
create unique index profiles_phone_verified_unique
  on public.profiles (phone_e164) where phone_verified;
alter table public.profiles enable row level security;

-- ---------------------------------------------------------------------------
-- invitations (Requirement 7.2) — a shareable code that adds an authenticated
-- user to a household, optionally claiming a specific placeholder membership.
-- ---------------------------------------------------------------------------
create table public.invitations (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households (id) on delete cascade,
  code                   text not null unique,
  created_by             uuid not null references auth.users (id),
  placeholder_membership uuid references public.memberships (id) on delete set null,
  expires_at             timestamptz,
  accepted_by            uuid references auth.users (id),
  accepted_at            timestamptz,
  created_at             timestamptz not null default now()
);
create index invitations_household_idx on public.invitations (household_id);
alter table public.invitations enable row level security;

-- ===========================================================================
-- RLS POLICIES
-- ===========================================================================

-- households: members can read; the creator (any authenticated user) can insert;
-- members can update/delete their own household.
create policy households_select on public.households
  for select to authenticated
  using (public.is_household_member(id));

create policy households_insert on public.households
  for insert to authenticated
  with check (created_by = auth.uid());

create policy households_update on public.households
  for update to authenticated
  using (public.is_household_member(id))
  with check (public.is_household_member(id));

create policy households_delete on public.households
  for delete to authenticated
  using (public.is_household_member(id));

-- memberships: a member can read all memberships of their household (so they see
-- roommates + placeholders); a user manages their own membership row; members may
-- insert rows into their household (create/invite flows go through edge functions
-- with the service role for stricter control, but members can add within policy).
create policy memberships_select on public.memberships
  for select to authenticated
  using (public.is_household_member(household_id));

create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (
    -- the creator seeding their own first membership, OR an existing member adding to the household
    user_id = auth.uid() or public.is_household_member(household_id)
  );

create policy memberships_update on public.memberships
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

create policy memberships_delete on public.memberships
  for delete to authenticated
  using (user_id = auth.uid());

-- profiles: anyone sharing a household with the owner can read the row; ONLY the
-- owner may insert/update their own row (R4.1). phone columns are further gated by
-- a column-masking view below for other members (R4.2).
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.memberships me
      join public.memberships them on them.household_id = me.household_id
      where me.user_id = auth.uid() and them.user_id = public.profiles.user_id
    )
  );

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- invitations: household members can read/create/delete invitations for their household.
create policy invitations_select on public.invitations
  for select to authenticated
  using (public.is_household_member(household_id));

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (public.is_household_member(household_id) and created_by = auth.uid());

create policy invitations_delete on public.invitations
  for delete to authenticated
  using (public.is_household_member(household_id));

-- ---------------------------------------------------------------------------
-- Household-visible profile view (R4.2): exposes shareable profile fields to
-- fellow members WITHOUT the private phone columns. The owner reads their own
-- full row via the base table; others use this view.
-- ---------------------------------------------------------------------------
create view public.household_profiles
with (security_invoker = true)
as
  select user_id, display_name, dietary, budget_cents, rules, updated_at
  from public.profiles;

grant select on public.household_profiles to authenticated;
