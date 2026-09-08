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

/**
 * What a keystroke in a username box is allowed to become.
 *
 * Lower-cased and filtered to Instagram's alphabet, because what the owner
 * sees has to be what is stored. Kept in one place so the sign-up field and
 * the Finish-setup field cannot drift apart -- they claim the same handle.
 */
export const cleanHandle = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9._]/g, '').slice(0, 30);
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

/**
 * FINISH A RESET: the six-digit code from the email, and a new password.
 *
 * Always through the edge function, even for an email identifier, so both
 * surfaces and both identifier kinds take one code path -- and so the reply is
 * the same sentence whether the code was wrong, expired, or the account never
 * existed. It answers with a session, which this adopts: someone who has just
 * proved they own the address and chosen a password should not then be asked
 * to type it.
 */
export async function completeReset(identifier: string, code: string, newPassword: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('username-login', {
    body: {
      action: 'reset_verify',
      identifier: identifier.trim().toLowerCase(),
      token: code.trim(),
      password: newPassword,
    },
  });
  if (error) {
    let msg = 'That code did not match. Check it and try again.';
    try { msg = JSON.parse(String((error as any)?.context?.body ?? '{}')).error ?? msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  const session = (data as any)?.session;
  if (!session?.access_token) throw new Error('That code did not match. Check it and try again.');
  const { error: setErr } = await supabase.auth.setSession({
    access_token: session.access_token, refresh_token: session.refresh_token,
  });
  if (setErr) throw setErr;
}

/**
 * THE PASSWORD RULE, in one place so both surfaces enforce the same one.
 *
 * Eight characters with a letter and a digit. Deliberately not a wall of
 * classes: a rule an owner cannot satisfy on a busy floor gets written on a
 * sticky note beside the till, which is worse than a slightly shorter
 * password. Length is what actually resists guessing.
 */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Include at least one letter and one number.';
  return null;
}

/**
 * CHANGE THE PASSWORD OF SOMEONE WHO IS SIGNED IN AND KNOWS THE OLD ONE.
 *
 * This is the ordinary case and it must NOT involve a code: a person who can
 * already prove who they are should not be sent to their inbox. The forgot
 * path (completeReset) is for someone who cannot.
 *
 * Supabase has no "verify my current password" call, so the current password
 * is checked by signing in with it. That is the verification -- a wrong one
 * fails here and nothing is changed. It re-issues a session for the SAME
 * user, so the person stays signed in either way; updateUser then sets the
 * new password on that freshly proven session.
 *
 * Without this check, anyone who found an unlocked counter PC could set a new
 * password without knowing the old one and lock the owner out of their own
 * restaurant.
 */
export async function changePassword(
  email: string, currentPw: string, newPw: string, logOutOthers = false,
): Promise<void> {
  const problem = passwordProblem(newPw);
  if (problem) throw new Error(problem);
  if (currentPw === newPw) throw new Error('That is your current password — choose a different one.');

  const { error: reauth } = await supabase.auth.signInWithPassword({ email, password: currentPw });
  if (reauth) {
    throw new Error(/invalid login credentials/i.test(reauth.message)
      ? 'That is not your current password.'
      : loginErrorSentence(reauth.message));
  }

  const { error } = await supabase.auth.updateUser({ password: newPw });
  if (error) throw new Error(error.message);

  // Everywhere else is signed out only when asked. Someone changing a
  // password because they think it leaked wants this; someone tidying up does
  // not, and silently ending their other sessions would be a surprise.
  if (logOutOthers) {
    try { await supabase.auth.signOut({ scope: 'others' }); } catch { /* best effort */ }
  }
}

/** Supabase's OTP failures, in words the person typing can act on. */
export function otpErrorSentence(message: string): string {
  if (/expired/i.test(message)) return 'That code has expired — send a new one.';
  if (/invalid|not found/i.test(message)) return 'That code did not match. Check it and try again.';
  if (/rate|too many|seconds/i.test(message)) return 'Too many attempts just now. Wait a minute and try again.';
  return message;
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
