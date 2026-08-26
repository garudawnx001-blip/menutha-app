/** Excel bulk menu upload (Growth+): template, all-or-nothing validation,
 *  diff preview, publish. Template columns:
 *  Dish Name | Category | Veg/NonVeg | Price | Description | Available (Y/N) | Image Filename */
import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { listDishImages, type PortalCategory, type PortalDish } from './portalApi';
import { validateRows, diffPlan, TEMPLATE_HEADERS } from '../../../../packages/menu-import/index.js';

export { TEMPLATE_HEADERS };

export function downloadTemplate() {
  const rows = [
    TEMPLATE_HEADERS,
    ['Paneer Tikka', 'Starters', 'Veg', 320, 'Char-grilled cottage cheese', 'Y', 'paneer-tikka.jpg'],
    ['Chicken Biriyani', 'Biriyani', 'NonVeg', 260, 'Donne-style, serves one', 'Y', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 40 }, { wch: 14 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Menu');
  XLSX.writeFile(wb, 'menutha-menu-template.xlsx');
}

/** Export the live menu as a workbook using the SAME columns as the import
 *  template, so a menu can be exported, edited in Excel and re-imported
 *  without any reshaping. Only a blank template existed before, which is why
 *  "Export" appeared to be missing — it was. */
export function exportMenu(
  categories: PortalCategory[],
  dishes: PortalDish[],
  restaurantName = 'menu',
) {
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const body = dishes.map((d) => [
    d.name,
    d.category_id ? catName.get(d.category_id) ?? '' : '',
    d.is_veg ? 'Veg' : 'NonVeg',
    Number(d.price),
    d.description ?? '',
    d.is_available ? 'Y' : 'N',
    // Image column carries the filename the importer matches on, not the URL.
    d.photo_url ? decodeURIComponent(d.photo_url.split('/').pop() || '') : '',
  ]);
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_HEADERS, ...body]);
  ws['!cols'] = [{ wch: 26 }, { wch: 16 }, { wch: 10 }, { wch: 8 }, { wch: 40 }, { wch: 14 }, { wch: 20 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Menu');
  const slug = restaurantName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'menu';
  XLSX.writeFile(wb, `${slug}-menu.xlsx`);
}

export interface ParsedRow {
  row: number; name: string; category: string; isVeg: boolean;
  price: number; description: string; available: boolean; image: string;
}
export interface ImportPlan {
  rows: ParsedRow[];
  newCategories: string[];
  creates: ParsedRow[];
  updates: { row: ParsedRow; existing: PortalDish }[];
  imageMatches: Map<string, string>;   // filename(lower) → public URL
  missingImages: string[];
}

/** All-or-nothing: returns { errors } (with row numbers) OR a full plan. */
export async function parseWorkbook(
  file: File,
  categories: PortalCategory[],
  items: PortalDish[],
): Promise<{ errors: string[] } | { plan: ImportPlan }> {
  const buf = await file.arrayBuffer();
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read(buf); }
  catch { return { errors: ['This file could not be read as an Excel workbook (.xlsx).'] }; }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { errors: ['The workbook has no sheets.'] };

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

  // Pure validation + diff (unit-tested in packages/menu-import).
  const { errors, rows } = validateRows(raw);
  if (errors.length) return { errors };
  const { newCategories, creates, updates } = diffPlan(rows, categories, items) as {
    newCategories: string[]; creates: ParsedRow[]; updates: { row: ParsedRow; existing: PortalDish }[];
  };

  const imageMatches = await listDishImages().catch(() => new Map<string, string>());
  const missingImages = [...new Set(
    rows.map((r) => r.image).filter((f) => f && !imageMatches.has(f.toLowerCase())),
  )];

  return { plan: { rows, newCategories, creates, updates, imageMatches, missingImages } };
}

/** Publish: create categories, then upsert dishes (matched by name). */
export async function publishPlan(
  restaurantId: string,
  plan: ImportPlan,
  categories: PortalCategory[],
): Promise<void> {
  const catIds = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));
  for (const name of plan.newCategories) {
    const { data, error } = await supabase
      .from('menu_category')
      .insert({ restaurant_id: restaurantId, name, sort_order: 90 })
      .select('id').single();
    if (error) throw new Error(`Creating category "${name}": ${error.message}`);
    catIds.set(name.toLowerCase(), data.id);
  }

  const toPayload = (r: ParsedRow) => ({
    restaurant_id: restaurantId,
    category_id: catIds.get(r.category.toLowerCase()) ?? null,
    name: r.name,
    description: r.description || null,
    price: r.price,
    is_veg: r.isVeg,
    is_available: r.available,
    ...(r.image && plan.imageMatches.has(r.image.toLowerCase())
      ? { photo_url: plan.imageMatches.get(r.image.toLowerCase()) }
      : {}),
  });

  if (plan.creates.length) {
    const { error } = await supabase.from('menu_item').insert(plan.creates.map(toPayload));
    if (error) throw new Error('Creating dishes: ' + error.message);
  }
  for (const u of plan.updates) {
    const { error } = await supabase.from('menu_item').update(toPayload(u.row)).eq('id', u.existing.id);
    if (error) throw new Error(`Updating "${u.row.name}": ` + error.message);
  }
}
