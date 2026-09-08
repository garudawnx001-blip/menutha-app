/**
 * WHO CAN SIGN IN, AND HOW. One list, so the portal and the phone cannot drift.
 *
 * THE MODEL, as he redefined it:
 *
 *   EMAIL  — a one-time code / magic link. No password to forget, no SMS bill,
 *            and the address is already the thing every receipt and payout
 *            notice goes to.
 *   GOOGLE — one tap, and the account it links is the same address, so the two
 *            paths land on one identity rather than creating a second account
 *            for the same restaurant.
 *   APPLE  — the seam is here and the button is drawn on the platforms that
 *            expect it, but the provider is not wired: it needs an Apple
 *            Developer team, a Services ID and a signing key that we do not
 *            have. It is DISABLED rather than hidden on those platforms,
 *            because a button that is present and honestly unavailable is
 *            better than one that appears the week the config lands and makes
 *            the screen change shape under a user who had learned it.
 *
 *   PHONE  — GONE. Not hidden, not defaulted-away-from: removed. SMS was never
 *            configured, so every OTP send failed; a login method that cannot
 *            work is worse than one that is absent, because the user blames
 *            themselves for the failure. "did you remove phone from login" --
 *            yes, from both surfaces and from profile settings.
 */

/** Apple's button is expected on Apple platforms and on the web, and is noise
 *  on Android -- Play's own guidance is that you do not surface a sign-in
 *  method the device has no affinity with. Hidden there, drawn elsewhere. */
export function showAppleButton(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return !/Android/i.test(ua);
}

/**
 * Apple is drawn but cannot yet sign anyone in.
 *
 * Flip this to false in the same commit that adds the Services ID and key to
 * Supabase -- and nowhere else, so the button and the provider turn on
 * together rather than one shipping ahead of the other.
 */
export const APPLE_COMING_SOON = true;

/** What to say when a provider is drawn but not configured on the server. */
export const APPLE_PENDING_MESSAGE =
  'Sign in with Apple is coming soon. Use your email or Google for now.';

/**
 * Supabase says "Unsupported provider" / "provider is not enabled" when the
 * provider has no client credentials configured. That is a SETUP state, not a
 * user error, and it deserves a sentence the person reading it can act on
 * rather than the raw string.
 */
export function providerError(err: unknown, provider: 'Google' | 'Apple'): string {
  const msg = String((err as { message?: string })?.message ?? err ?? '');
  if (/not enabled|unsupported provider|provider.*disabled/i.test(msg)) {
    return `${provider} sign-in is not switched on for this account yet.`;
  }
  return msg || `Could not reach ${provider}. Please try again.`;
}
