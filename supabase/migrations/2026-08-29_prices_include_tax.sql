-- "Prices include tax" — the toggle the approved design shows in Settings.
--
-- DEFERRED, DELIBERATELY, AS OF v20. Not applied, and not shipping in v20.
--
-- The decision and its reason, so nobody re-opens this without the context:
-- the pilot restaurant's live bills already show SGST and CGST added on top of
-- the menu price, and the client reconciles against that every night. Changing
-- how a bill is broken down in the middle of a pilot — even without moving the
-- total — invites a disagreement with their own books that we would be the
-- cause of and they would be the ones explaining.
--
-- It ships later as an explicit toggle, with the client told what it changes
-- before they turn it on. Applying this file alone is still safe (it defaults
-- to false and nothing reads it yet), but there is no reason to.
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
