/**
 * Which menu filters are worth showing, worked out from the dishes a diner can
 * actually order right now.
 *
 * Callers pass the AVAILABLE dishes only (fetchMenu and get_public_restaurant
 * already drop is_available = false), so everything here is "what is on
 * offer", never "what exists in the back office".
 *
 *   - No available non-veg dish -> no Non-veg chip. Same for Veg.
 *   - Only one kind on offer    -> no diet toggle at all: a filter with one
 *                                  answer is a button that changes nothing.
 *   - A category with nothing to order (under the current diet) gets no chip.
 *
 * Pure functions, no React, so the rules are the same on every page.
 */
export type Diet = 'all' | 'veg' | 'nonveg';

export interface DietAvailability {
  veg: boolean;
  nonveg: boolean;
  /** True only when BOTH kinds are on offer, i.e. the toggle can do something. */
  offer: boolean;
}

export function dietAvailability(items: ReadonlyArray<{ is_veg: boolean }>): DietAvailability {
  let veg = false;
  let nonveg = false;
  for (const i of items) {
    if (i.is_veg) veg = true; else nonveg = true;
    if (veg && nonveg) break;
  }
  return { veg, nonveg, offer: veg && nonveg };
}

/** The diet actually applied. A saved 'nonveg' on a menu that no longer has
 *  any non-veg dish falls back to 'all' instead of showing an empty page. */
export function effectiveDiet(diet: Diet, avail: DietAvailability): Diet {
  if (!avail.offer) return 'all';
  if (diet === 'veg' && !avail.veg) return 'all';
  if (diet === 'nonveg' && !avail.nonveg) return 'all';
  return diet;
}

export function matchesDiet(item: { is_veg: boolean }, diet: Diet): boolean {
  return diet === 'all' || (diet === 'veg' ? item.is_veg : !item.is_veg);
}

/** Category names that have at least one dish under `diet`, in the
 *  restaurant's own category order. */
export function categoriesWithItems<T extends { category: string; category_sort?: number | null; is_veg: boolean }>(
  items: ReadonlyArray<T>,
  diet: Diet,
): string[] {
  const seen = new Map<string, number>();
  for (const i of items) {
    if (!matchesDiet(i, diet)) continue;
    if (!seen.has(i.category)) seen.set(i.category, i.category_sort ?? 99);
  }
  return [...seen.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
}
