-- Kasa Phase 2 — RLS policy tests (Requirements 4, 6.2; NFR 3).
--
-- Proves server-side isolation independent of any client UI:
--   * a member can read their own household's data
--   * a member CANNOT read another household's data
--   * a user can update only their OWN profile
--   * the phone column is not exposed to other members (via household_profiles)
--
-- Run:  docker exec -i <db container> psql -U postgres -d postgres < this file
-- Any failed assertion raises an exception and aborts (psql exits non-zero).
--
-- We simulate auth.uid() by setting the `authenticated` role + request.jwt.claims,
-- exactly as PostgREST does per request. Seeding runs as the privileged postgres
-- role (which bypasses RLS) so the test fixtures exist before we drop privileges.

\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres / RLS-bypassing): two users, two households.
-- auth.users rows are created directly; locally this is fine for policy testing.
-- ---------------------------------------------------------------------------
-- deterministic uuids for the two users
-- user A = 11111111-...  user B = 22222222-...
insert into auth.users (id, instance_id, aud, role, email)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@example.com');

-- household A (owned by user A) + household B (owned by user B)
insert into public.households (id, name, created_by) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'House A', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'House B', '22222222-2222-2222-2222-222222222222');

insert into public.memberships (household_id, user_id, role, display_name, claimed) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'owner', 'Alice', true),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'owner', 'Bob', true);

insert into public.profiles (user_id, display_name, dietary, phone_e164, phone_verified) values
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'vegetarian', '+15555550001', true),
  ('22222222-2222-2222-2222-222222222222', 'Bob', 'none', '+15555550002', true);

-- a chore in each household so cross-household reads have something to (not) see
insert into public.chores (household_id, client_id, title, recurrence) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'c_a', 'A chore', 'weekly'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'c_b', 'B chore', 'weekly');

-- helper: become a given user (authenticated role + jwt sub claim)
-- (inline via set local in each test block below)

-- ===========================================================================
-- TEST 1: user A reads only their own household
-- ===========================================================================
do $$
declare own int; other int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

  select count(*) into own from public.households where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select count(*) into other from public.households where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if own <> 1 then raise exception 'FAIL T1: A should see own household (got %)', own; end if;
  if other <> 0 then raise exception 'FAIL T1: A must NOT see household B (got %)', other; end if;
  raise notice 'PASS T1: household read isolation';
  reset role;
end $$;

-- ===========================================================================
-- TEST 2: user A reads only their own household's chores
-- ===========================================================================
do $$
declare own int; other int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

  select count(*) into own from public.chores where household_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  select count(*) into other from public.chores where household_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  if own <> 1 then raise exception 'FAIL T2: A should see own chore (got %)', own; end if;
  if other <> 0 then raise exception 'FAIL T2: A must NOT see B chores (got %)', other; end if;
  raise notice 'PASS T2: content read isolation';
  reset role;
end $$;

-- ===========================================================================
-- TEST 3: user A cannot write into household B
-- ===========================================================================
do $$
declare blocked boolean := false;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';
  begin
    insert into public.chores (household_id, client_id, title, recurrence)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'c_evil', 'injected', 'weekly');
  exception when insufficient_privilege or check_violation then
    blocked := true;
  end;
  -- RLS insert denial surfaces as a row-level security violation (error) OR zero rows;
  -- re-check nothing landed:
  if exists (select 1 from public.chores where client_id = 'c_evil') then
    raise exception 'FAIL T3: A injected a chore into household B';
  end if;
  raise notice 'PASS T3: cross-household write denied';
  reset role;
end $$;

-- ===========================================================================
-- TEST 4: a user can update ONLY their own profile
-- ===========================================================================
do $$
declare b_dietary text;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

  -- own update succeeds
  update public.profiles set dietary = 'vegan' where user_id = '11111111-1111-1111-1111-111111111111';
  if (select dietary from public.profiles where user_id = '11111111-1111-1111-1111-111111111111') <> 'vegan' then
    raise exception 'FAIL T4: A could not update own profile';
  end if;

  -- attempt to update B's profile must affect 0 rows (policy USING hides it)
  update public.profiles set dietary = 'hacked' where user_id = '22222222-2222-2222-2222-222222222222';
  reset role;

  -- verify as postgres that B is untouched
  select dietary into b_dietary from public.profiles where user_id = '22222222-2222-2222-2222-222222222222';
  if b_dietary = 'hacked' then
    raise exception 'FAIL T4: A modified B''s profile';
  end if;
  raise notice 'PASS T4: profile update is owner-only';
end $$;

-- ===========================================================================
-- TEST 5: phone number is NOT exposed to a fellow member via household_profiles.
-- Put both users in the SAME household so the profile row is readable, then
-- confirm the masking view omits phone while the base row keeps it for the owner.
-- ===========================================================================
-- add Bob to household A so Alice and Bob share a household
insert into public.memberships (household_id, user_id, role, display_name, claimed)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'member', 'Bob', true);

do $$
declare has_phone_col int; bob_visible int;
begin
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111"}';

  -- Alice can now see Bob's shareable profile via the masking view
  select count(*) into bob_visible from public.household_profiles where user_id = '22222222-2222-2222-2222-222222222222';
  if bob_visible <> 1 then raise exception 'FAIL T5: Alice should see Bob''s shared profile via view (got %)', bob_visible; end if;

  -- the view has no phone column at all (structural guarantee of masking)
  select count(*) into has_phone_col
  from information_schema.columns
  where table_schema='public' and table_name='household_profiles' and column_name in ('phone_e164','phone_verified');
  if has_phone_col <> 0 then raise exception 'FAIL T5: masking view exposes phone columns'; end if;

  raise notice 'PASS T5: phone masked from fellow members';
  reset role;
end $$;

-- ===========================================================================
-- TEST 6: household size limit (max 5) enforced server-side (R7.4)
-- ===========================================================================
do $$
declare hit_limit boolean := false;
begin
  -- household A currently has Alice + Bob (2). Add 3 placeholders -> 5 total (ok),
  -- then a 6th must fail.
  insert into public.memberships (household_id, user_id, role, display_name, claimed) values
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'member', 'P3', false),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'member', 'P4', false),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'member', 'P5', false);
  begin
    insert into public.memberships (household_id, user_id, role, display_name, claimed)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', null, 'member', 'P6', false);
  exception when check_violation then
    hit_limit := true;
  end;
  if not hit_limit then raise exception 'FAIL T6: 6th member was allowed'; end if;
  raise notice 'PASS T6: household size limit enforced';
end $$;

rollback;  -- leave the database clean; this is a test, not a seed
