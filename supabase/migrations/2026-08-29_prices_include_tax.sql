-- "Prices include tax" — the toggle the approved design shows in Settings.
--
-- NOT YET APPLIED. This file is prepared, not run. It changes the money path,
-- so it needs an explicit go-ahead before it touches production.
--
-- WHY THIS IS NOT A UI TOGGLE. Today every bill computes
--     subtotal          = sum(qty * unit_price)
--     service           = subtotal * service_charge_pct
--     sgst, cgst        = (subtotal + service) * pct
--     total             = subtotal + service + sgst + cgst
-- i.e. tax is ADDED ON TOP of the menu price.
--
-- With prices tax-inclusive, the same menu price already contains the tax, and
-- the bill has to work backwards:
--     gross             = sum(qty * unit_price)        -- what the diner sees
--     taxable           = gross / (1 + sgst_pct + cgst_pct)
--     sgst, cgst        = taxable * pct                 -- still separate lines
--     total             = gross                         -- unchanged, by design
--
-- The visible total must NOT move when this is switched on: that is the entire
-- point of the setting. What changes is how the total is BROKEN DOWN on the
-- printed tax invoice, which is what the GST lines on that invoice have to
-- state correctly.
--
-- Switching this on a restaurant with open bills would re-break-down bills a
-- diner has already been shown, so the app should refuse to change it while
-- any table is unsettled. That guard belongs in the UI, not here.
--
-- Everything defaults to false, which is exactly today's behaviour, so applying
-- this file alone changes nothing for anybody.

alter table public.restaurant
  add column if not exists prices_include_tax boolean not null default false;

comment on column public.restaurant.prices_include_tax is
  'When true, menu prices are GST-inclusive: the bill back-computes the taxable '
  'value out of the price instead of adding tax on top. The diner-visible total '
  'is identical either way; only the tax breakdown on the invoice differs.';
