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
/**
 * detectSessionInUrl: TRUE, and the false it replaces is why Continue with
 * Google never signed anybody in on the web.
 *
 * This config was copied from the native app, where `false` is correct: the
 * phone opens Google in a system browser, gets the tokens back on a deep link,
 * and auth-callback.tsx parses that URL and calls setSession itself. The app
 * turns detection off because it does the job by hand.
 *
 * The web copied the flag and not the handler. Nothing here has ever read an
 * OAuth redirect -- there is no exchangeCodeForSession and no hash parsing
 * anywhere in this codebase. So Google returned to /partner/register carrying
 * a perfectly good token, supabase-js was told not to look at it, no session
 * was ever created, and the page waited for an onAuthStateChange that could
 * not come. The "Opening your account" card and its ten-second floor were
 * doing exactly what they should; there was simply nothing on the way.
 *
 * flowType PINNED to implicit rather than left to the library's default.
 *
 * Two reasons, and the second is the one that matters here. First, the default
 * has moved between supabase-js versions, and a silent flip on a dependency
 * bump would take sign-up down again with no commit to blame. Second, PKCE
 * keeps a code verifier in localStorage between the outbound redirect and the
 * return, and on mobile -- an in-app browser, a privacy mode, a tab restored
 * into a different storage context -- that verifier can be gone when Google
 * comes back, so the exchange fails and no session lands. Most of this app's
 * owners sign up on a phone browser. Implicit carries the token home in the
 * fragment and needs nothing remembered, so it cannot fail that way.
 *
 * The trade is real: an implicit token rides in the URL fragment and reaches
 * the browser's history, where PKCE's would not. For a short-lived access
 * token in a first-party SPA that is the accepted shape, and it is worth
 * revisiting once sign-up is known-good on the phones that actually matter.
 *
 * GITHUB PAGES DOES NOT EAT THE TOKEN, which was worth checking before
 * blaming it: 404.html re-encodes the path into /?/..., appends the query and
 * the hash verbatim, and index.html puts both back with replaceState in the
 * document head -- before this module is ever evaluated. supabase-js sees the
 * real URL.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
});
