-- ════════════════════════════════════════════════════════════════════════════
-- CORRECTING WHAT WAS ORDERED  ·  2026-09-12  ·  idempotent, safe to re-run
-- ════════════════════════════════════════════════════════════════════════════
--
-- THE GAP. diner_update_order_item lets a DINER change their own order, and
-- only inside the grace window -- order_is_editable requires released_at to be
-- in the future. Once the order reaches the kitchen nobody can touch it, staff
-- included. So the commonest correction in a restaurant ("they sent one back",
-- "that's two dosas not three", "wrong table") has had no path at all, and the
-- only workarounds were to discount the bill by roughly the right amount or to
-- bill it anyway.
--
-- This is the staff equivalent, with a different guard because it answers a
-- different question. The diner's guard is about TIME. A manager's is about
-- MONEY: has this been settled, and is a bill already standing on it?
--
--   * paid              -- refuse. Changing the food behind a payment makes the
--                          payment wrong, and that is a refund, not an edit.
--   * on a live bill    -- refuse, and say which. The bill was printed with the
--                          old line on it; silently repricing the order would
--                          leave the paper and the record disagreeing. Cancel
--                          the bill (void_bill), correct the order, raise it
--                          again -- three steps, and the trail says what
--                          happened at each.
--   * cancelled         -- refuse. Nothing to correct.
--
-- A VOID bill does not block: it has already been taken back.
--
-- REPRICE, NEVER ARITHMETIC HERE. reprice_order owns every price in the
-- product -- service rate, the owner's charge lines, SGST/CGST -- and this
-- function's whole job is to change a quantity and then ask it to do its work.
-- Any subtotal computed here would be a second implementation that drifts.
--
-- MANAGER ONLY, and deliberately stricter than billing. Raising a bill is a
-- waiter's job; rewriting what a table ordered after it was cooked is not.

begin;

create or replace function staff_set_order_item_qty(
  p_order_item_id uuid,
  p_qty           int
) returns json language plpgsql volatile security definer set search_path = public as $fn$
declare
  v_order   food_order%rowtype;
  v_item    order_item%rowtype;
  v_bill_no bigint;
  v_left    int;
begin
  select * into v_item from order_item where id = p_order_item_id;
  if not found then raise exception 'item not found'; end if;

  select * into v_order from food_order where id = v_item.order_id;
  if not found then raise exception 'order not found'; end if;

  -- SECURITY DEFINER bypasses RLS, so the caller check is made by hand.
  if not is_manager_of(v_order.restaurant_id) then raise exception 'access denied'; end if;

  if p_qty is null or p_qty < 0 then raise exception 'quantity cannot be negative'; end if;
  if p_qty > 999 then raise exception 'quantity is implausibly large'; end if;

  if v_order.status = 'cancelled' then
    raise exception 'this order was cancelled';
  end if;

  if exists (select 1 from payment p where p.order_id = v_order.id and p.status = 'paid') then
    raise exception 'this order has been paid for - a correction after payment is a refund';
  end if;

  select b.bill_no into v_bill_no
  from bill b
  where v_order.id = any (b.order_ids) and b.status <> 'void'
  order by b.created_at desc
  limit 1;

  if v_bill_no is not null then
    raise exception 'bill #% is standing on this order - cancel that bill first, then correct it', v_bill_no;
  end if;

  if p_qty = 0 then
    delete from order_item where id = p_order_item_id;
  else
    update order_item set qty = p_qty where id = p_order_item_id;
  end if;

  -- An order with nothing left in it is not an order for nothing; it is
  -- cancelled. Same rule the diner path already follows, so the two cannot
  -- leave the data in two different shapes.
  select count(*) into v_left from order_item where order_id = v_order.id;
  if v_left = 0 then
    update food_order set status = 'cancelled' where id = v_order.id;
    return json_build_object('order_id', v_order.id, 'cancelled', true,
                             'items_left', 0, 'total', 0);
  end if;

  perform reprice_order(v_order.id);

  select * into v_order from food_order where id = v_order.id;
  return json_build_object('order_id', v_order.id, 'cancelled', false,
                           'items_left', v_left,
                           'subtotal', v_order.subtotal,
                           'service_charge', v_order.service_charge,
                           'gst_amount', v_order.gst_amount,
                           'total', v_order.total);
end; $fn$;

revoke all on function staff_set_order_item_qty(uuid, int) from public;
revoke all on function staff_set_order_item_qty(uuid, int) from anon;
grant execute on function staff_set_order_item_qty(uuid, int) to authenticated;

notify pgrst, 'reload schema';

commit;

-- ── VERIFY (expect: fn present, staff can call, anon cannot) ──────────────
-- select
--   exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--            where n.nspname = 'public' and p.proname = 'staff_set_order_item_qty') as fn_exists,
--   has_function_privilege('authenticated',
--     'public.staff_set_order_item_qty(uuid, int)', 'EXECUTE') as staff_ok,
--   not has_function_privilege('anon',
--     'public.staff_set_order_item_qty(uuid, int)', 'EXECUTE') as anon_blocked;
