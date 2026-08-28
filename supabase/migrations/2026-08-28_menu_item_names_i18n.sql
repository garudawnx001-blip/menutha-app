-- Menu translation, phase 1: per-dish names in the diner's script.
--
-- Nullable and with no default on purpose. NULL means "the restaurant has not
-- given us one", and the app then shows a transliteration of the English name
-- (apps/web/src/lib/translit.ts). An empty string would be indistinguishable
-- from a deliberate blank, so the portal writes NULL when the field is cleared.
--
-- No backfill. Transliteration happens at render time, so a stored copy would
-- only go stale the moment the engine improved, and it would turn a guess into
-- something that looks like the restaurant's own wording.

alter table public.menu_item
  add column if not exists name_kn text,
  add column if not exists name_hi text;

comment on column public.menu_item.name_kn is
  'Kannada dish name supplied by the restaurant. NULL = show a transliteration of name.';
comment on column public.menu_item.name_hi is
  'Hindi dish name supplied by the restaurant. NULL = show a transliteration of name.';
