/**
 * Username-or-email login, the portal's twin of the app's.
 *
 * Instagram-style: the login field takes a USERNAME or an EMAIL, and either
 * opens the same account. Supabase Auth is keyed by email, so a username has
 * to be resolved first -- and that resolution happens inside the
 * username-login Edge Function with the service role, so this client never
 * learns another account's email by guessing a handle. An email-shaped
 * identifier skips the round trip and signs in directly.
 *
 * Mirrors apps/mobile/src/lib/supabaseService.ts (the username section) so
 * the two surfaces validate, resolve and fail identically.
 */
import { supabase } from './supabase';

export const USERNAME_RE = /^[a-z0-9._]{3,30}$/;
export const isEmailLike = (s: string) => s.includes('@');

/** Format only -- the same rules the database enforces, so the form can say
 *  why before the round trip rather than after it. */
export function usernameProblem(handle: string): string | null {
  const h = handle.trim().toLowerCase();
  if (!USERNAME_RE.test(h)) return 'Username: 3–30 letters, numbers, dots or underscores.';
  if (h.startsWith('.') || h.endsWith('.') || h.includes('..')) return 'Username cannot start or end with a dot, or contain two in a row.';
  return null;
}

/** True when the handle is well-formed AND unclaimed. Anonymous by design --
 *  the sign-up form asks before the account exists -- and it reveals only
 *  whether a handle is in use, never who holds it. */
export async function usernameAvailable(handle: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('username_available', { p_username: handle.trim() });
  if (error) throw error;
  return data === true;
}

const BAD_CREDS = 'Username, email or password is incorrect.';

/** Where a reset link lands: the portal's login page, which is also its
 *  recovery screen (it reads type=recovery off the fragment). Without this
 *  Supabase falls back to the Site URL, which is the marketing landing --
 *  a page that ignores the token, so the link would open and do nothing. */
export const RESET_REDIRECT = () => `${window.location.origin}/partner`;

/** Supabase's own sentences, translated. "Email not confirmed" is the one
 *  the email door produces on purpose: an address that never opened its
 *  link stays unverified, and that is the guard, so the message says what
 *  to do rather than calling the password wrong. */
export function loginErrorSentence(message: string): string {
  if (/email not confirmed/i.test(message)) return 'Confirm your email first — open the link we sent you, then log in.';
  if (message === 'Invalid login credentials') return BAD_CREDS;
  return message;
}

/** Resolves to a signed-in session or throws with a sentence for the reader. */
export async function loginWithIdentifier(identifier: string, password: string): Promise<void> {
  const id = identifier.trim();
  if (isEmailLike(id)) {
    const { error } = await supabase.auth.signInWithPassword({ email: id, password });
    if (error) throw new Error(loginErrorSentence(error.message));
    return;
  }
  const { data, error } = await supabase.functions.invoke('username-login', {
    body: { action: 'login', identifier: id.toLowerCase(), password },
  });
  if (error) {
    // The function answers 401 with a sentence; invoke() wraps that as an
    // error whose message is the JSON body. Unwrap it rather than showing
    // "Edge Function returned a non-2xx status code".
    let msg = BAD_CREDS;
    try { msg = JSON.parse(String((error as any)?.context?.body ?? '{}')).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const session = (data as any)?.session;
  if (!session?.access_token) throw new Error(BAD_CREDS);
  // Adopt the session the function minted; from here on this client is
  // indistinguishable from one that signed in directly.
  const { error: setErr } = await supabase.auth.setSession({
    access_token: session.access_token, refresh_token: session.refresh_token,
  });
  if (setErr) throw setErr;
}

/** Reset by username OR email. Answers identically whether or not the
 *  identifier exists -- the enumeration this whole module exists to prevent. */
export async function resetByIdentifier(identifier: string): Promise<void> {
  const id = identifier.trim();
  if (isEmailLike(id)) {
    const { error } = await supabase.auth.resetPasswordForEmail(id, { redirectTo: RESET_REDIRECT() });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.functions.invoke('username-login', {
    body: { action: 'reset', identifier: id.toLowerCase() },
  });
  if (error) throw error;
}
