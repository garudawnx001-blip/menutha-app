-- ════════════════════════════════════════════════════════════════════════════
-- THE BILL AGREES WITH THE ORDERS  ·  2026-09-12  ·  idempotent, safe to re-run
-- ════════════════════════════════════════════════════════════════════════════
--
-- WHAT IS WRONG TODAY. The live create_table_bill takes its tax rate from
-- `restaurant.gst_pct`, defaulting to 5:
--
--     select coalesce(gst_pct, 5) into v_gst_pct from restaurant ...
--     v_gst := round((v_subtotal + v_service - p_discount) * v_gst_pct / 100.0, 2);
--
-- Every OTHER price in the product comes from reprice_order, which uses
-- `sgst_pct` and `cgst_pct` (each defaulting to 2.5) and, since the bill-charges
-- round, the owner's own charge lines. Two different sources of truth for one
-- number.
--
-- They agree today by coincidence: Ashwamedha is on 2.5 + 2.5 = 5, and gst_pct
-- is unset so it falls back to 5. Set SGST and CGST to 9 and 9 in Bill settings
-- and every order reprices at 18% while every bill still charges 5% -- the
-- screen and the paper would disagree by 13% of the food, and nothing would say
-- so. No UI writes gst_pct; it is vestigial.
--
-- THE FIX IS NOT ANOTHER FORMULA. Recomputing GST here from sgst_pct/cgst_pct
-- would be right for a restaurant on the legacy path and WRONG for one using
-- owner-defined charge lines, where the total is subtotal + packing + service +
-- the lines walked in order, and sgst_amount holds only whatever lines happen
-- to be labelled SGST. Any formula written here is a second implementation of
-- reprice_order that will drift from it.
--
-- So the bill stops computing and starts AGREEING: it sums what the orders
-- already carry. With no discount the bill total is the sum of the order totals
-- exactly, for every restaurant, on both paths. That is the whole property the
-- preview needs.
--
--   food    = sum(subtotal + packing_charge)
--   service = sum(service_charge)
--   lines   = sum(total) - food - service      -- GST and/or owner lines
--   flat    = sum of charge_lines amounts with kind 'flat'
--   pct     = lines - flat                     -- everything rate-based
--   base    = food + service
--   factor  = base > 0 ? (base - discount) / base : 1
--   total   = round(base - discount + flat + round(pct * factor, 2), 2)
--
-- THE DISCOUNT SCALES THE RATE-BASED CHARGES AND NOT THE FLAT ONES, which is
-- the only defensible reading: a 10% discount on the food reduces the tax on
-- that food by 10%, and does not reduce a flat twenty-rupee packing line, which
-- is not a function of the price. On the legacy path this is algebraically
-- exact -- (taxable - d) * rate = taxable * rate * factor -- so a discounted
-- bill lands where recomputing from the rates would have put it, without this
-- function having to know what the rates are.
--
-- KEPT EXACTLY AS DEPLOYED, because the app reads them:
--   * the signature (uuid, uuid[], numeric) and SECURITY DEFINER;
--   * is_staff_of to raise, is_manager_of only for a discount. Raising a bill
--     is a waiter's job -- a manager guard here would stop the floor billing
--     anything, which is not a hardening, it is an outage;
--   * every validation, in order, with the same messages;
--   * bill.subtotal stored as food + service, while the returned `subtotal` is
--     food only. Reports read the column and the printed bill reads the JSON;
--   * every key of the returned JSON. Three keys are ADDED (sgst_amount,
--     cgst_amount, charges) -- additive, so nothing that reads by name breaks.

-- ── BEFORE YOU RUN THIS, one read-only check ──────────────────────────────
-- If any row comes back, a restaurant has a gst_pct that disagrees with its
-- own SGST + CGST, and its bills are about to change. Expect zero rows.
--
--   select id, name, gst_pct, sgst_pct, cgst_pct
--   from restaurant
--   where coalesce(gst_pct, coalesce(sgst_pct,2.5) + coalesce(cgst_pct,2.5))
--       <> coalesce(sgst_pct,2.5) + coalesce(cgst_pct,2.5);

begin;

create or replace function create_table_bill(
  p_restaurant_id uuid, p_order_ids uuid[], p_discount numeric default 0
) returns json language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_uid      uuid := auth.uid();
  v_count    int;
  v_food     numeric;   -- subtotal + packing, as the orders carry it
  v_service  numeric;
  v_orders   numeric;   -- sum of order totals
  v_flat     numeric;   -- owner lines with kind 'flat'
  v_gst      numeric;   -- sgst + cgst as the orders carry it
  v_sgst     numeric;
  v_cgst     numeric;
  v_lines    numeric;
  v_pct      numeric;
  v_base     numeric;
  v_factor   numeric;
  v_table    uuid;
  v_bill     bill%rowtype;
begin
  if not is_staff_of(p_restaurant_id) then raise exception 'access denied'; end if;
  if p_discount < 0 then raise exception 'invalid discount'; end if;
  if p_discount > 0 and not is_manager_of(p_restaurant_id) then
    raise exception 'discounts need a manager'; end if;
  if p_order_ids is null or array_length(p_order_ids, 1) is null then
    raise exception 'no orders selected'; end if;

  select count(*),
         coalesce(sum(subtotal + coalesce(packing_charge, 0)), 0),
         coalesce(sum(coalesce(service_charge, 0)), 0),
         coalesce(sum(total), 0),
         coalesce(sum(coalesce(sgst_amount, 0)), 0),
         coalesce(sum(coalesce(cgst_amount, 0)), 0)
    into v_count, v_food, v_service, v_orders, v_sgst, v_cgst
  from food_order
  where id = any(p_order_ids) and restaurant_id = p_restaurant_id
    and status <> 'cancelled'
    and not exists (select 1 from payment p where p.order_id = food_order.id and p.status = 'paid')
    and not exists (select 1 from bill b where b.status = 'paid' and food_order.id = any(b.order_ids));

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'some orders are cancelled, already paid, or not from this restaurant';
  end if;
  if p_discount > v_food then raise exception 'discount exceeds subtotal'; end if;

  -- Flat owner lines, which a discount must not shrink. Empty charge_lines --
  -- every restaurant until somebody opens Bill settings -- gives zero, and the
  -- whole of `lines` is then rate-based, which is exactly right for GST.
  select coalesce(sum((l ->> 'amount')::numeric), 0) into v_flat
  from food_order o,
       lateral jsonb_array_elements(coalesce(o.charge_lines, '[]'::jsonb)) l
  where o.id = any(p_order_ids)
    and (l ->> 'kind') = 'flat';

  v_gst   := v_sgst + v_cgst;
  v_lines := round(v_orders - v_food - v_service, 2);
  v_pct   := round(v_lines - v_flat, 2);
  v_base  := v_food + v_service;
  v_factor := case when v_base > 0 then (v_base - p_discount) / v_base else 1 end;

  v_pct  := round(v_pct * v_factor, 2);
  v_sgst := round(v_sgst * v_factor, 2);
  v_cgst := round(v_cgst * v_factor, 2);
  v_gst  := round(v_gst * v_factor, 2);

  -- Any order on this bill that is seated. `limit 1` and not min(uuid):
  -- min() is not defined for uuid, which broke this function for an hour once.
  select table_id into v_table from food_order
   where id = any(p_order_ids) and table_id is not null limit 1;

  insert into bill (restaurant_id, table_id, order_ids, subtotal, discount, gst_amount, total, created_by)
  values (p_restaurant_id, v_table, p_order_ids,
          v_base, p_discount, v_gst,
          round(v_base - p_discount + v_flat + v_pct, 2), v_uid)
  returning * into v_bill;

  return json_build_object(
    'id', v_bill.id, 'bill_no', v_bill.bill_no,
    'subtotal', v_food, 'service_charge', v_service, 'discount', p_discount,
    'gst_amount', v_gst, 'total', v_bill.total,
    -- Added. Nothing that reads the keys above is affected.
    'sgst_amount', v_sgst, 'cgst_amount', v_cgst, 'charges', round(v_flat + v_pct - v_gst, 2));
end; $fn$;

revoke all on function create_table_bill(uuid, uuid[], numeric) from public;
revoke all on function create_table_bill(uuid, uuid[], numeric) from anon;
grant execute on function create_table_bill(uuid, uuid[], numeric) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ── VERIFY ────────────────────────────────────────────────────────────────
-- 1. Nothing moved. For every unpaid order, what a bill for it alone WOULD
--    total vs what the order already says. Expect no rows (all agree).
--
--   select o.id, o.order_no, o.total as order_total,
--          round(o.subtotal + coalesce(o.packing_charge,0)
--                + coalesce(o.service_charge,0)
--                + (o.total - o.subtotal - coalesce(o.packing_charge,0)
--                   - coalesce(o.service_charge,0)), 2) as bill_would_be
--   from food_order o
--   where o.status <> 'cancelled' and o.placed_at > now() - interval '7 days'
--     and abs(o.total - round(o.subtotal + coalesce(o.packing_charge,0)
--             + coalesce(o.service_charge,0)
--             + (o.total - o.subtotal - coalesce(o.packing_charge,0)
--                - coalesce(o.service_charge,0)), 2)) > 0.01;
--
-- 2. The function is there and anon cannot call it:
--
--   select has_function_privilege('authenticated',
--            'public.create_table_bill(uuid, uuid[], numeric)', 'EXECUTE') as staff_ok,
--          not has_function_privilege('anon',
--            'public.create_table_bill(uuid, uuid[], numeric)', 'EXECUTE') as anon_blocked;
