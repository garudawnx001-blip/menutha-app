export declare const TEMPLATE_HEADERS: string[];

export interface ValidatedRow {
  row: number; name: string; category: string; isVeg: boolean;
  price: number; description: string; available: boolean; image: string;
}

export declare function validateRows(
  raw: Array<Record<string, unknown>>,
): { errors: string[]; rows: ValidatedRow[] };

export declare function diffPlan<T extends { name: string }>(
  rows: ValidatedRow[],
  categories: Array<{ name: string }>,
  items: T[],
): { newCategories: string[]; creates: ValidatedRow[]; updates: { row: ValidatedRow; existing: T }[] };
