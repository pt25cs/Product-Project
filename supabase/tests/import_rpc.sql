-- End-to-end test of the import_household RPC against the real schema (Requirement 5.2/5.5).
-- Confirms a plan inserts a household + membership + content in one transaction, preserves
-- client_id, and that the idempotency signature column is set.
\set ON_ERROR_STOP on
begin;

-- a real auth user to own the imported household
insert into auth.users (id, instance_id, aud, role, email)
values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'importer@example.com');

do $$
declare
  plan jsonb;
  hid uuid;
  n_mem int; n_chore int; sig text;
begin
  plan := jsonb_build_object(
    'household', jsonb_build_object('name', 'Imported Home', 'created_by', '33333333-3333-3333-3333-333333333333'),
    'memberships', jsonb_build_array(
      jsonb_build_object('client_id','u_me','user_id','33333333-3333-3333-3333-333333333333','role','owner','display_name','Me','claimed',true),
      jsonb_build_object('client_id','u_room','user_id',null,'role','member','display_name','Roomie','claimed',false)
    ),
    'profile', jsonb_build_object('user_id','33333333-3333-3333-3333-333333333333','display_name','Me','dietary','vegan','budget_cents','12000','rules',''),
    'content', jsonb_build_object(
      'chores', jsonb_build_array(jsonb_build_object('client_id','c1','title','Trash','notes','','recurrence','weekly','rotation','[]'::jsonb,'auto_rotate',false,'cycle_days',7,'start_idx',0)),
      'occurrences', jsonb_build_array(jsonb_build_object('client_id','o1','chore_client_id','c1','title','Trash','due','2026-11-10','assignee_id','u_me')),
      'expenses', '[]'::jsonb, 'reimbursements','[]'::jsonb, 'shopping','[]'::jsonb, 'events','[]'::jsonb,
      'expectations','[]'::jsonb, 'swaps','[]'::jsonb, 'notifications','[]'::jsonb, 'activity','[]'::jsonb,
      'purchasing', jsonb_build_object('budget_cents','30000','preferred_products','[]'::jsonb,'store_preferences','[]'::jsonb),
      'prefs', '[]'::jsonb
    )
  );

  hid := public.import_household(plan, 'sig-abc');

  select count(*) into n_mem from public.memberships where household_id = hid;
  select count(*) into n_chore from public.chores where household_id = hid and client_id = 'c1';
  select import_signature into sig from public.households where id = hid;

  if n_mem <> 2 then raise exception 'FAIL: expected 2 memberships, got %', n_mem; end if;
  if n_chore <> 1 then raise exception 'FAIL: chore not imported with client_id'; end if;
  if sig <> 'sig-abc' then raise exception 'FAIL: import_signature not recorded'; end if;
  if (select budget_cents from public.profiles where user_id='33333333-3333-3333-3333-333333333333') <> 12000 then
    raise exception 'FAIL: owner profile not imported';
  end if;
  if (select count(*) from public.memberships where household_id=hid and claimed=false and user_id is null) <> 1 then
    raise exception 'FAIL: placeholder membership not created';
  end if;

  raise notice 'PASS: import_household created household %, 2 members (1 placeholder), chore, profile, signature', hid;
end $$;

rollback;
