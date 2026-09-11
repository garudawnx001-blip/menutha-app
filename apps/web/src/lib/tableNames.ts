/**
 * NAMING A RUN OF TABLES, in one place so the phone and the portal cannot
 * disagree about what "add 10 tables" produces.
 *
 * Copied verbatim into apps/mobile/src/lib/tableNames.ts, the same way
 * packages/entitlements is mirrored and for the same reason: Metro will not
 * resolve outside apps/mobile, and two implementations of a naming rule drift
 * until somebody's floor has a Table 7 twice.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * The owner types ONE label and a count, and the label carries the pattern:
 *
 *   "Table" + 10   with nothing existing  -> Table 1 … Table 10
 *   "Table" + 4    with Table 1-6 existing -> Table 7 … Table 10
 *   "Table 1" + 10                         -> Table 1 … Table 10
 *   "Rooftop 5" + 3                        -> Rooftop 5, Rooftop 6, Rooftop 7
 *   "Cabin" + 2    with Cabin A existing   -> Cabin 1, Cabin 2
 *
 * A trailing number in what they typed is a START, not a name. That is the
 * behaviour the request described -- "Table 1-10" -- expressed as the two
 * fields somebody already has in front of them rather than as a range syntax
 * they would have to be taught.
 *
 * With no number typed, it continues from the highest one already on that
 * prefix. Restarting at 1 and then skipping six taken names would work, but it
 * reads as a bug the first time somebody watches it happen.
 *
 * ── TAKEN NAMES ARE STEPPED OVER, NOT RENAMED ──────────────────────────────
 *
 * A label that already exists is skipped and the run continues, so asking for
 * 4 always yields 4 NEW tables. The alternative -- failing the whole batch on
 * one collision -- would make the common case (adding more of what you have)
 * the one that errors. The skipped names are returned so the screen can say
 * which, because silently jumping from Table 6 to Table 11 is the kind of
 * thing that gets reported as lost tables.
 *
 * Comparison is case- and space-insensitive: "table 7" and "Table  7" are the
 * same table to everyone except a string compare.
 */

export interface TablePlan {
  /** The labels to create, in order. Exactly `count` of them unless the cap
   *  was hit. */
  labels: string[];
  /** Names passed over because a table already had them. */
  skipped: string[];
}

/** More than this in one press is a typo, not a floor plan -- and it is also
 *  a lot of rows and a lot of printed QR codes. */
export const MAX_BULK_TABLES = 50;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Splits "Rooftop 5" into ["Rooftop", 5]; "Cabin" into ["Cabin", null]. */
function splitTrailingNumber(s: string): [string, number | null] {
  const m = /^(.*?)[\s-]*(\d+)\s*$/.exec(s.trim());
  if (!m) return [s.trim(), null];
  const prefix = m[1].trim();
  // "12" on its own is a name, not a prefix with a number -- there would be
  // nothing left to call the tables.
  if (!prefix) return [s.trim(), null];
  return [prefix, Number(m[2])];
}

export function planTableLabels(typed: string, count: number, existing: string[]): TablePlan {
  const wanted = Math.max(1, Math.min(MAX_BULK_TABLES, Math.floor(count) || 1));
  const taken = new Set(existing.map(norm));

  const raw = typed.trim() || 'Table';
  const [prefix, typedStart] = splitTrailingNumber(raw);

  let n: number;
  if (typedStart !== null) {
    n = typedStart;
  } else {
    // Continue from the highest number already used on this prefix.
    let highest = 0;
    for (const label of existing) {
      const [p, num] = splitTrailingNumber(label);
      if (num !== null && norm(p) === norm(prefix)) highest = Math.max(highest, num);
    }
    n = highest + 1;
  }

  const labels: string[] = [];
  const skipped: string[] = [];
  // Bounded so a floor already holding every number in the run cannot spin.
  // Generous enough that stepping over a full set of existing tables still
  // reaches the ones after them.
  const ceiling = n + wanted + existing.length + MAX_BULK_TABLES;
  while (labels.length < wanted && n < ceiling) {
    const label = `${prefix} ${n}`;
    if (taken.has(norm(label))) skipped.push(label);
    else { labels.push(label); taken.add(norm(label)); }
    n += 1;
  }

  return { labels, skipped };
}
