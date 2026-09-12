# SQL handed to the operator

These are the migrations for the production database
(`xnhcziciilylzcaupqoq`), kept here because this repo is public and
`raw.githubusercontent.com` serves it with permissive CORS — so the
Supabase SQL editor can fetch the exact bytes and run them without
anyone retyping a money-path function by hand.

They are copies. The originals live with the rest of the schema in the
app repo under `apps/api/db/migrations/`, and that is the tree to edit.

Every file is idempotent, wrapped in `begin; … commit;`, and ends with a
commented VERIFY block to run separately afterwards.

Run in this order:

1. `2026-09-12_bill_totals_agree.sql` — corrected `create_table_bill`
2. `2026-09-12_bill_extra_lines.sql` — one-off charge lines on a bill
3. `2026-09-12_staff_edit_order_item.sql` — staff quantity correction
