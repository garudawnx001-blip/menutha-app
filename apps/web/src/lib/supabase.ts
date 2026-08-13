import { createClient } from '@supabase/supabase-js';

// Same project + publishable key defaults as apps/mobile/app.config.js so the
// web app works against the live backend out of the box; override per
// environment with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
// Original healthy project ("menutha Project", ap-southeast-1). The rdfw project
// was on a restricted (402) org; this one is free-tier-healthy and holds the
// live schema + data.
const url =
  import.meta.env.VITE_SUPABASE_URL || 'https://xnhcziciilylzcaupqoq.supabase.co';
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_zmrlV7bkDZ_cJiIHxd0Slg_0H192fIe';

// Sessions persist for the Restaurant Portal (/partner); diner flows stay
// guest-first and never require sign-in.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});
