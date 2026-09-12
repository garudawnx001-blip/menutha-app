-- ════════════════════════════════════════════════════════════════════════════
-- A CHARGE LINE ON ONE BILL  ·  2026-09-12  ·  idempotent, safe to re-run
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT EXISTS ALREADY, and why it is not this. `restaurant.bill_charges` holds
-- the owner's STANDING lines -- VAT, a cover charge, whatever this restaurant
-- always adds -- and reprice_order applies them to every order. That is a
-- policy. What has never existed is the one-off: a ₹150 cake-cutting charge on
-- table 6 tonight, a ₹40 delivery fee, a corkage. Staff have been handling
-- those by not handling them.
--
-- ONE BILL, NOT THE ORDERS. The line belongs to the settlement, not to the
-- food, so it goes on `bill` and leaves food_order untouched. That also keeps
-- it out of reprice_order, which would otherwise have to decide whether a
-- one-off on one bill applies to an order that might be re-billed later.
--
-- POST-TAX, AND SAID PLAINLY. Like the AC and parcel charges beside it, an
-- extra line is added after GST rather than folded into the taxable base.
-- Recomputing tax here would mean reproducing create_table_bill's arithmetic
-- in a third place, which is exactly the drift that made the bill and the
-- preview disagree in the first place. A restaurant that needs a charge taxed
-- should put it in Bill settings, where reprice_order will tax it properly.
--
-- REPLACE, NEVER ACCUMULATE -- the same rule apply_parcel_charge follows: back
-- out what this function put on before, then add what it is putting on now. So
-- calling it twice with the same line leaves the bill in one state, and a
-- retry after a dropped connection cannot double-charge.
--
-- MANAGER ONLY. Adding money to somebody's bill is not a waiter's decision.

begin;

alter table bill
  add column if not exists extra_lines  jsonb         not null default '[]'::jsonb,
  add column if not exists extra_charge numeric(10,2) not null default 0;

comment on column bill.extra_lines is
  'One-off charge lines on THIS bill, added after tax: [{id,label,kind:flat|percent,value,amount}]. Standing lines live on restaurant.bill_charges and are applied by reprice_order instead.';

create or replace function set_bill_charge_line(
  p_bill_id uuid,
  p_line_id text,
  p_label   text,
  p_kind    text,
  p_value   numeric
) returns json language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_bill   bill%rowtype;
  v_base   numeric;
  v_amount numeric;
  v_lines  jsonb;
  v_total  numeric;
begin
  select * into v_bill from bill where id = p_bill_id;
  if not found then raise exception 'unknown bill %', p_bill_id; end if;
  if not is_manager_of(v_bill.restaurant_id) then raise exception 'access denied'; end if;

  -- A paid bill is history: the diner has gone, and a new line on it is money
  -- nobody can collect on an invoice that no longer reconciles.
  if v_bill.status <> 'unpaid' then
    return json_build_object('bill_id', p_bill_id, 'applied', false,
                             'reason', 'bill is ' || v_bill.status,
                             'extra_charge', v_bill.extra_charge,
                             'extra_lines', v_bill.extra_lines,
                             'total', v_bill.total);
  end if;

  if p_line_id is null or btrim(p_line_id) = '' then
    raise exception 'a charge line needs an id';
  end if;
  if coalesce(btrim(p_label), '') = '' then
    raise exception 'a charge line needs a label';
  end if;
  if p_kind not in ('flat', 'percent') then
    raise exception 'unknown charge kind "%" -- use flat or percent', p_kind;
  end if;
  if p_value is null or p_value < 0 then
    raise exception 'a charge line cannot be negative';
  end if;

  -- Percent is taken on the bill's own taxable base, which is what
  -- create_table_bill stored in `subtotal` (food + service), less the
  -- discount. Not on the grand total: compounding a percentage on top of tax
  -- and other extras is never what anyone means by "10% service".
  v_base := greatest(0, coalesce(v_bill.subtotal, 0) - coalesce(v_bill.discount, 0));

  v_amount := case p_kind
    when 'flat' then round(p_value, 2)
    else round(v_base * p_value / 100.0, 2)
  end;

  if v_amount > 1000000 then raise exception 'charge line is implausibly large'; end if;

  -- Everything except this line, then this line. An upsert expressed as a
  -- rebuild, which is also what makes a repeat call a no-op.
  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_lines
  from jsonb_array_elements(coalesce(v_bill.extra_lines, '[]'::jsonb)) l
  where l ->> 'id' <> p_line_id;

  v_lines := v_lines || jsonb_build_array(jsonb_build_object(
    'id',     p_line_id,
    'label',  btrim(p_label),
    'kind',   p_kind,
    'value',  p_value,
    'amount', v_amount
  ));

  select coalesce(sum((l ->> 'amount')::numeric), 0) into v_total
  from jsonb_array_elements(v_lines) l;

  update bill
     set total        = round(coalesce(total, 0) - coalesce(extra_charge, 0) + v_total, 2),
         extra_charge = v_total,
         extra_lines  = v_lines
   where id = p_bill_id
  returning * into v_bill;

  return json_build_object('bill_id', p_bill_id, 'applied', true,
                           'extra_charge', v_bill.extra_charge,
                           'extra_lines', v_bill.extra_lines,
                           'total', v_bill.total);
end; $fn$;

create or replace function remove_bill_charge_line(p_bill_id uuid, p_line_id text)
returns json language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_bill  bill%rowtype;
  v_lines jsonb;
  v_total numeric;
begin
  select * into v_bill from bill where id = p_bill_id;
  if not found then raise exception 'unknown bill %', p_bill_id; end if;
  if not is_manager_of(v_bill.restaurant_id) then raise exception 'access denied'; end if;

  if v_bill.status <> 'unpaid' then
    return json_build_object('bill_id', p_bill_id, 'applied', false,
                             'reason', 'bill is ' || v_bill.status,
                             'extra_charge', v_bill.extra_charge,
                             'extra_lines', v_bill.extra_lines,
                             'total', v_bill.total);
  end if;

  select coalesce(jsonb_agg(l), '[]'::jsonb) into v_lines
  from jsonb_array_elements(coalesce(v_bill.extra_lines, '[]'::jsonb)) l
  where l ->> 'id' <> p_line_id;

  select coalesce(sum((l ->> 'amount')::numeric), 0) into v_total
  from jsonb_array_elements(v_lines) l;

  update bill
     set total        = round(coalesce(total, 0) - coalesce(extra_charge, 0) + v_total, 2),
         extra_charge = v_total,
         extra_lines  = v_lines
   where id = p_bill_id
  returning * into v_bill;

  -- Removing a line that is not there is a success, not an error: it is the
  -- state the caller asked for, and a red alert on a retry teaches staff to
  -- ignore red alerts.
  return json_build_object('bill_id', p_bill_id, 'applied', true,
                           'extra_charge', v_bill.extra_charge,
                           'extra_lines', v_bill.extra_lines,
                           'total', v_bill.total);
end; $fn$;

-- Postgres grants EXECUTE to PUBLIC by default, which would include anon.
revoke all on function set_bill_charge_line(uuid, text, text, text, numeric) from public;
revoke all on function set_bill_charge_line(uuid, text, text, text, numeric) from anon;
grant execute on function set_bill_charge_line(uuid, text, text, text, numeric) to authenticated;

revoke all on function remove_bill_charge_line(uuid, text) from public;
revoke all on function remove_bill_charge_line(uuid, text) from anon;
grant execute on function remove_bill_charge_line(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ── VERIFY (expect: columns present, staff can call, anon cannot) ─────────
-- select
--   (select count(*) from information_schema.columns
--     where table_name = 'bill' and column_name in ('extra_lines','extra_charge')) as cols_2,
--   has_function_privilege('authenticated',
--     'public.set_bill_charge_line(uuid, text, text, text, numeric)', 'EXECUTE') as staff_ok,
--   not has_function_privilege('anon',
--     'public.set_bill_charge_line(uuid, text, text, text, numeric)', 'EXECUTE') as anon_blocked;
