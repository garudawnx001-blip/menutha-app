/** Pure Excel-menu row validation (MODULE 2) — framework-free so the exact
 *  all-or-nothing rules are unit-tested in Node CI and reused by the web
 *  portal's SheetJS import. */

export const TEMPLATE_HEADERS = [
  'Dish Name', 'Category', 'Veg/NonVeg', 'Price', 'Description', 'Available (Y/N)', 'Image Filename',
];

/**
 * @param {Array<Record<string, unknown>>} raw - sheet_to_json rows (defval '')
 * @returns {{ errors: string[], rows: Array<{row:number,name:string,category:string,isVeg:boolean,price:number,description:string,available:boolean,image:string}> }}
 */
export function validateRows(raw) {
  const errors = [];
  const rows = [];
  const seen = new Set();

  if (!Array.isArray(raw) || raw.length === 0) {
    return { errors: ['No data rows found under the header row.'], rows: [] };
  }

  raw.forEach((r, i) => {
    const rowNo = i + 2; // header is row 1
    const name = String(r['Dish Name'] ?? '').trim();
    const category = String(r['Category'] ?? '').trim();
    const vegRaw = String(r['Veg/NonVeg'] ?? '').trim().toLowerCase();
    const priceRaw = r['Price'];
    const description = String(r['Description'] ?? '').trim();
    const availRaw = String(r['Available (Y/N)'] ?? 'Y').trim().toLowerCase();
    const image = String(r['Image Filename'] ?? '').trim();

    if (!name) { errors.push(`Row ${rowNo}: Dish Name is empty.`); return; }
    if (seen.has(name.toLowerCase())) { errors.push(`Row ${rowNo}: duplicate dish "${name}" in this file.`); return; }
    seen.add(name.toLowerCase());
    if (!category) errors.push(`Row ${rowNo}: Category is empty.`);
    if (!['veg', 'nonveg', 'non-veg', 'non veg'].includes(vegRaw))
      errors.push(`Row ${rowNo}: Veg/NonVeg must be "Veg" or "NonVeg" (got "${r['Veg/NonVeg']}").`);
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0)
      errors.push(`Row ${rowNo}: Price must be a positive number (got "${priceRaw}").`);
    if (!['y', 'n', 'yes', 'no'].includes(availRaw))
      errors.push(`Row ${rowNo}: Available must be Y or N (got "${r['Available (Y/N)']}").`);

    rows.push({
      row: rowNo, name, category, isVeg: vegRaw === 'veg',
      price, description, available: availRaw.startsWith('y'), image,
    });
  });

  return { errors, rows };
}

/**
 * Diff a validated row set against the current menu.
 * @param {ReturnType<typeof validateRows>['rows']} rows
 * @param {Array<{name: string}>} categories
 * @param {Array<{name: string}>} items
 */
export function diffPlan(rows, categories, items) {
  const catNames = new Set(categories.map((c) => c.name.toLowerCase()));
  const newCategories = [...new Set(rows.map((r) => r.category).filter((c) => c && !catNames.has(c.toLowerCase())))];
  const byName = new Map(items.map((d) => [d.name.toLowerCase(), d]));
  const creates = rows.filter((r) => !byName.has(r.name.toLowerCase()));
  const updates = rows
    .filter((r) => byName.has(r.name.toLowerCase()))
    .map((r) => ({ row: r, existing: byName.get(r.name.toLowerCase()) }));
  return { newCategories, creates, updates };
}
