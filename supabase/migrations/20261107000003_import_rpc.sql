-- Kasa Phase 2 — transactional migration import (Requirement 5.5, NFR 6).
-- Adds an idempotency signature to households and a SECURITY DEFINER RPC that applies an
-- entire import plan in ONE transaction, so a partial failure rolls back completely and
-- leaves no half-migrated household. The edge function calls this with the service role.

alter table public.households add column if not exists import_signature text;
create unique index if not exists households_import_sig_unique
  on public.households (created_by, import_signature) where import_signature is not null;

-- import_household(p_plan jsonb, p_signature text) -> uuid (new household id)
-- p_plan shape matches buildImportPlan(): { household, memberships, profile, content:{...} }.
create or replace function public.import_household(p_plan jsonb, p_signature text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  hid uuid;
  rec jsonb;
begin
  -- 1. household
  insert into public.households (name, created_by, import_signature)
  values (p_plan->'household'->>'name', (p_plan->'household'->>'created_by')::uuid, p_signature)
  returning id into hid;

  -- 2. memberships
  for rec in select * from jsonb_array_elements(coalesce(p_plan->'memberships','[]'::jsonb)) loop
    insert into public.memberships (household_id, user_id, role, display_name, claimed)
    values (
      hid,
      nullif(rec->>'user_id','')::uuid,
      coalesce(rec->>'role','member'),
      rec->>'display_name',
      coalesce((rec->>'claimed')::boolean, false)
    );
  end loop;

  -- 3. content collections (each row gets household_id = hid)
  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'chores','[]'::jsonb)) loop
    insert into public.chores (household_id, client_id, title, notes, recurrence, rotation, auto_rotate, anchor_date, cycle_days, start_idx)
    values (hid, rec->>'client_id', rec->>'title', coalesce(rec->>'notes',''), rec->>'recurrence',
            coalesce(rec->'rotation','[]'::jsonb), coalesce((rec->>'auto_rotate')::boolean,false),
            nullif(rec->>'anchor_date',''), coalesce((rec->>'cycle_days')::int,7), coalesce((rec->>'start_idx')::int,0));
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'occurrences','[]'::jsonb)) loop
    insert into public.occurrences (household_id, client_id, chore_client_id, title, notes, due, assignee_id, rot_idx, done_by, done_at, next_occ_id, manual_override)
    values (hid, rec->>'client_id', rec->>'chore_client_id', rec->>'title', coalesce(rec->>'notes',''), rec->>'due',
            rec->>'assignee_id', nullif(rec->>'rot_idx','')::int, rec->>'done_by', nullif(rec->>'done_at','')::timestamptz,
            rec->>'next_occ_id', coalesce((rec->>'manual_override')::boolean,false));
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'expenses','[]'::jsonb)) loop
    insert into public.expenses (household_id, client_id, description, amount_cents, date, payer_id, participant_ids, splits, shopping_item_id, token)
    values (hid, rec->>'client_id', rec->>'description', (rec->>'amount_cents')::int, rec->>'date', rec->>'payer_id',
            coalesce(rec->'participant_ids','[]'::jsonb), coalesce(rec->'splits','{}'::jsonb), rec->>'shopping_item_id', rec->>'token');
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'reimbursements','[]'::jsonb)) loop
    insert into public.reimbursements (household_id, client_id, from_id, to_id, amount_cents, date, note, token)
    values (hid, rec->>'client_id', rec->>'from_id', rec->>'to_id', (rec->>'amount_cents')::int, rec->>'date', coalesce(rec->>'note',''), rec->>'token');
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'shopping','[]'::jsonb)) loop
    insert into public.shopping (household_id, client_id, name, qty, notes, buyer_id, status, purchased_by, purchased_at, expense_id)
    values (hid, rec->>'client_id', rec->>'name', coalesce(rec->>'qty','1'), coalesce(rec->>'notes',''), rec->>'buyer_id',
            rec->>'status', rec->>'purchased_by', nullif(rec->>'purchased_at','')::timestamptz, rec->>'expense_id');
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'events','[]'::jsonb)) loop
    insert into public.events (household_id, client_id, title, category, creator_id, start, "end", notes)
    values (hid, rec->>'client_id', rec->>'title', rec->>'category', rec->>'creator_id', rec->>'start', rec->>'end', coalesce(rec->>'notes',''));
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'expectations','[]'::jsonb)) loop
    insert into public.expectations (household_id, client_id, text, created_by, updated_by)
    values (hid, rec->>'client_id', rec->>'text', rec->>'created_by', rec->>'updated_by');
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'swaps','[]'::jsonb)) loop
    insert into public.swaps (household_id, client_id, kind, occ_id, target_occ_id, requester_id, addressee_id, status, resolved_by, resolved_at)
    values (hid, rec->>'client_id', rec->>'kind', rec->>'occ_id', rec->>'target_occ_id', rec->>'requester_id', rec->>'addressee_id',
            rec->>'status', rec->>'resolved_by', nullif(rec->>'resolved_at','')::timestamptz);
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'notifications','[]'::jsonb)) loop
    insert into public.notifications (household_id, client_id, user_id, type, title, body, link, key, read)
    values (hid, rec->>'client_id', rec->>'user_id', rec->>'type', rec->>'title', coalesce(rec->>'body',''),
            coalesce(rec->>'link','#/home'), rec->>'key', coalesce((rec->>'read')::boolean,false));
  end loop;

  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'activity','[]'::jsonb)) loop
    insert into public.activity (household_id, client_id, actor_id, verb, subject, link, ref)
    values (hid, rec->>'client_id', rec->>'actor_id', rec->>'verb', coalesce(rec->>'subject',''), rec->>'link', rec->>'ref');
  end loop;

  -- purchasing (single row)
  insert into public.purchasing (household_id, budget_cents, preferred_products, store_preferences)
  values (hid,
          nullif(p_plan->'content'->'purchasing'->>'budget_cents','')::int,
          coalesce(p_plan->'content'->'purchasing'->'preferred_products','[]'::jsonb),
          coalesce(p_plan->'content'->'purchasing'->'store_preferences','[]'::jsonb));

  -- prefs
  for rec in select * from jsonb_array_elements(coalesce(p_plan->'content'->'prefs','[]'::jsonb)) loop
    insert into public.prefs (household_id, user_id, data)
    values (hid, rec->>'user_id', coalesce(rec->'data','{}'::jsonb));
  end loop;

  -- owner profile (upsert; the signer may already have a profile row)
  insert into public.profiles (user_id, display_name, dietary, budget_cents, rules)
  values ((p_plan->'profile'->>'user_id')::uuid, coalesce(p_plan->'profile'->>'display_name',''),
          coalesce(p_plan->'profile'->>'dietary',''), nullif(p_plan->'profile'->>'budget_cents','')::int,
          coalesce(p_plan->'profile'->>'rules',''))
  on conflict (user_id) do update
    set display_name = excluded.display_name, dietary = excluded.dietary,
        budget_cents = excluded.budget_cents, rules = excluded.rules, updated_at = now();

  return hid;
end;
$$;

revoke all on function public.import_household(jsonb, text) from public, anon, authenticated;
-- service_role (edge function) calls this; it already bypasses RLS.
grant execute on function public.import_household(jsonb, text) to service_role;
