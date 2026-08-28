/** Menu management: categories + dishes CRUD, instant price edits,
 *  availability toggles, image upload, and Growth-gated Excel bulk import
 *  (template → validate all-or-nothing → diff preview → publish). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  fetchMenuAdmin, upsertCategory, saveDish, deleteDish, uploadImage,
  type PortalCategory, type PortalDish,
  deleteCategory, deleteCategoryWithDishes, reorderCategories,
  bulkUploadDishImages, reorderDishes, type BulkImageResult,
} from '../../lib/portalApi';
import { downloadTemplate, exportMenu, parseWorkbook, publishPlan, type ImportPlan } from '../../lib/excelMenu';
import { inr } from '../../lib/types';
import { usePartner } from './PartnerShell';
import { Spinner, VegMark } from '../../components';

interface DishDraft {
  id?: string; name: string; price: string; category_id: string | null;
  description: string; is_veg: boolean; is_available: boolean; photo_url: string | null;
}

const emptyDraft = (categoryId: string | null): DishDraft => ({
  name: '', price: '', category_id: categoryId, description: '',
  is_veg: true, is_available: true, photo_url: null,
});

export function MenuManager() {
  const { restaurant, can } = usePartner();
  const [cats, setCats] = useState<PortalCategory[]>([]);
  const [items, setItems] = useState<PortalDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>('all');
  const [draft, setDraft] = useState<DishDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState('');
  const [newCat, setNewCat] = useState('');
  const [editCats, setEditCats] = useState(false);
  // ── Drag to arrange, on pointer events ────────────────────────────────────
  // HTML5 drag-and-drop was the wrong primitive here. It is unreliable on
  // touch — which is how a restaurant actually uses this, on a phone behind
  // the counter — it gives no live preview, and its only feedback was the row
  // going faintly transparent. Pointer events cover mouse, touch and pen with
  // one code path, so the row can follow the finger, the others can slide out
  // of the way, and the drop target is visible the whole time.
  //
  // No library: this is one measured row height and some arithmetic.
  const [drag, setDrag] = useState<
    { id: string; from: number; to: number; dy: number } | null
  >(null);
  const dragRef = useRef<{ id: string; from: number; startY: number; h: number } | null>(null);
  const catCount = useRef(0);
  catCount.current = cats.length;

  const onGripDown = (e: React.PointerEvent, id: string, idx: number) => {
    const row = (e.currentTarget as HTMLElement).closest('.cat-row') as HTMLElement | null;
    const h = row?.getBoundingClientRect().height ?? 48;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id, from: idx, startY: e.clientY, h };
    setDrag({ id, from: idx, to: idx, dy: 0 });
  };

  const onGripMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const to = Math.max(0, Math.min(catCount.current - 1, d.from + Math.round(dy / d.h)));
    setDrag({ id: d.id, from: d.from, to, dy });

    // Auto-scroll when the finger nears an edge, or a long list can only be
    // reordered as far as the screen is tall.
    const M = 90;
    if (e.clientY < M) window.scrollBy({ top: -12, behavior: 'auto' });
    else if (e.clientY > window.innerHeight - M) window.scrollBy({ top: 12, behavior: 'auto' });
  };

  const onGripUp = () => {
    const d = dragRef.current;
    const cur = drag;
    dragRef.current = null;
    setDrag(null);
    if (d && cur && cur.to !== d.from) moveCatTo(d.id, cur.to);
  };

  /** How far a row slides to make room for the one being dragged. */
  const rowShift = (idx: number) => {
    if (!drag || !dragRef.current) return 0;
    const h = dragRef.current.h;
    if (idx === drag.from) return drag.dy;
    if (drag.to > drag.from && idx > drag.from && idx <= drag.to) return -h;
    if (drag.to < drag.from && idx < drag.from && idx >= drag.to) return h;
    return 0;
  };

  const [dragDish, setDragDish] = useState<string | null>(null);

  // Bulk photos
  const photoRef = useRef<HTMLInputElement>(null);
  const [bulk, setBulk] = useState<BulkImageResult | null>(null);
  const [bulkBusy, setBulkBusy] = useState(0);

  // Excel import state
  const fileRef = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    try {
      const m = await fetchMenuAdmin(restaurant.id);
      setCats(m.categories);
      setItems(m.items);
    } catch (e: any) { setError(e?.message ?? 'Could not load the menu.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [restaurant.id]);

  const visible = useMemo(
    () => (activeCat === 'all' ? items : items.filter((i) => i.category_id === activeCat)),
    [items, activeCat],
  );

  /** Move a category to a new position and persist the order.
   *
   *  Reorders local state first so the list responds instantly, then writes
   *  sort_order. A reload would make every drag feel laggy on a phone. */
  const moveCatTo = async (id: string, to: number) => {
    const from = cats.findIndex((c) => c.id === id);
    if (from < 0 || to < 0 || to >= cats.length || from === to) return;
    const next = [...cats];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCats(next);
    try { await reorderCategories(next.map((c) => c.id)); }
    catch (err: any) { setError(`Could not save the new order: ${err?.message ?? 'unknown error'}`); load(); }
  };

  /** Move a dish within the list currently on screen.
   *
   *  When a category filter is on, only those dishes are visible, so the new
   *  order is spliced back into the slots the filtered dishes already occupy
   *  globally. Reordering inside a category therefore never disturbs the
   *  dishes around it. */
  const moveDishTo = async (id: string, to: number) => {
    const from = visible.findIndex((d) => d.id === id);
    if (from < 0 || to < 0 || to >= visible.length || from === to) return;

    const slice = [...visible];
    const [moved] = slice.splice(from, 1);
    slice.splice(to, 0, moved);

    const slots = items.reduce<number[]>((acc, it, i) => {
      if (visible.some((v) => v.id === it.id)) acc.push(i);
      return acc;
    }, []);
    const next = [...items];
    slots.forEach((slot, i) => { next[slot] = slice[i]; });

    setItems(next);
    setDragDish(null);
    try { await reorderDishes(next.map((d) => d.id)); }
    catch (err: any) { setError(`Could not save the new order: ${err?.message ?? 'unknown error'}`); load(); }
  };

  /** Attach a whole folder of photos at once, matching each file to the dish
   *  whose name it resembles. Reports what did not match rather than dropping
   *  it — a photo that silently went nowhere is the worst outcome here. */
  const onBulkPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(''); setBulk(null); setBulkBusy(files.length);
    try {
      const res = await bulkUploadDishImages(Array.from(files), items);
      setBulk(res);
      if (res.matched.length) await load();
    } catch (e: any) { setError(e?.message ?? 'Bulk upload failed.'); }
    finally { setBulkBusy(0); if (photoRef.current) photoRef.current.value = ''; }
  };

  const save = async () => {
    if (!draft || busy) return;
    const price = Number(draft.price);
    if (!draft.name.trim()) { setError('Give the dish a name.'); return; }
    if (!Number.isFinite(price) || price <= 0) { setError('Price must be a positive number.'); return; }
    setBusy(true); setError('');
    try {
      await saveDish(restaurant.id, {
        name: draft.name.trim(), price,
        category_id: draft.category_id, description: draft.description.trim() || null,
        is_veg: draft.is_veg, is_available: draft.is_available, photo_url: draft.photo_url,
      } as any, draft.id);
      setDraft(null);
      await load();
    } catch (e: any) { setError(e?.message ?? 'Save failed.'); }
    finally { setBusy(false); }
  };

  const toggleAvailable = async (d: PortalDish) => {
    setItems((prev) => prev.map((i) => (i.id === d.id ? { ...i, is_available: !d.is_available } : i))); // optimistic
    try { await saveDish(restaurant.id, { is_available: !d.is_available } as any, d.id); }
    catch { await load(); }
  };

  const onPickFile = async (f: File | undefined) => {
    if (!f) return;
    setImportErrors([]); setPlan(null); setImporting(true);
    const res = await parseWorkbook(f, cats, items);
    setImporting(false);
    if ('errors' in res) setImportErrors(res.errors);
    else setPlan(res.plan);
  };

  const publish = async () => {
    if (!plan || importing) return;
    setImporting(true); setError('');
    try {
      await publishPlan(restaurant.id, plan, cats);
      setPlan(null);
      await load();
    } catch (e: any) { setError(e?.message ?? 'Publish failed — nothing was partially applied beyond the reported step.'); }
    finally { setImporting(false); }
  };

  if (loading) return <Spinner label="Loading menu…" />;

  return (
    <div className="fade-in">
      <div className="topbar" style={{ alignItems: 'flex-end', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <p className="overline">Menu</p>
          <h1 className="display" style={{ fontSize: 26 }}>{items.length} dishes</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="chip" disabled={!items.length}
            title={items.length ? 'Download the current menu as Excel' : 'Add a dish first'}
            onClick={() => exportMenu(cats, items, restaurant.name)}>⬇ Export menu</button>
          {can('excel_upload') ? (
            <>
              <button className="chip" onClick={downloadTemplate}>⬇ Excel template</button>
              <button className="chip" onClick={() => fileRef.current?.click()}>⬆ Import Excel</button>
              <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden
                onChange={(e) => onPickFile(e.target.files?.[0])} />
            </>
          ) : (
            <NavLink className="chip" to="/partner/plan">⬆ Excel import — Growth plan →</NavLink>
          )}
          <button className="chip" disabled={!items.length || bulkBusy > 0}
            title={items.length ? 'Select many photos at once — each is matched to the dish it is named after'
                                : 'Add a dish first'}
            onClick={() => photoRef.current?.click()}>
            {bulkBusy > 0 ? `Uploading ${bulkBusy} photo${bulkBusy === 1 ? '' : 's'}…` : '🖼 Bulk photos'}
          </button>
          <input ref={photoRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => onBulkPhotos(e.target.files)} />
          {/* Category editing lives with the other menu ACTIONS, not among the
              category FILTER chips below. As the last chip after every category
              it was the first control pushed offscreen: at 1024px wide with the
              client's 19 categories it sat ~1100px past the right edge of a
              scroller that deliberately hides its scrollbar, so a mouse user got
              no hint it existed. Desktop now wraps the chips, but a phone still
              scrolls them — and a primary control should not be nineteen swipes
              away on either surface. */}
          <button className={editCats ? 'chip active' : 'chip'}
            title="Rename, reorder or delete menu categories"
            onClick={() => setEditCats(!editCats)}>
            {editCats ? '✕ Done editing categories' : '✎ Edit categories'}
          </button>
          <button className="btn btn-primary" style={{ padding: '10px 16px', fontSize: 14 }}
            onClick={() => setDraft(emptyDraft(activeCat === 'all' ? cats[0]?.id ?? null : activeCat))}>
            + Add dish
          </button>
        </div>
      </div>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

      {bulk && (
        <div className="glass" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
            <strong>
              {bulk.matched.length} photo{bulk.matched.length === 1 ? '' : 's'} attached
            </strong>
            <button className="chip" onClick={() => setBulk(null)}>Dismiss</button>
          </div>
          {bulk.matched.length > 0 && (
            <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>
              {bulk.matched.map((m) => m.dish).join(', ')}
            </p>
          )}
          {bulk.unmatched.length > 0 && (
            <>
              <p style={{ fontSize: 14, marginTop: 10, color: 'var(--gold)' }}>
                {bulk.unmatched.length} file{bulk.unmatched.length === 1 ? '' : 's'} matched no dish — nothing was
                uploaded for {bulk.unmatched.length === 1 ? 'it' : 'them'}:
              </p>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>{bulk.unmatched.join(', ')}</p>
              <p className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>
                Rename the file after the dish — “Paneer Tikka.jpg”, “paneer-tikka.jpg” and “paneertikka.JPG” all
                match a dish called Paneer Tikka. Then upload again.
              </p>
            </>
          )}
          {bulk.failed.length > 0 && (
            <p style={{ fontSize: 13.5, marginTop: 10, color: 'var(--error)' }}>
              Failed: {bulk.failed.map((f) => `${f.file} (${f.reason})`).join('; ')}
            </p>
          )}
        </div>
      )}

      {importErrors.length > 0 && (
        <div className="glass" style={{ padding: 14, marginBottom: 12, borderColor: 'rgba(197,64,47,0.5)' }}>
          <strong style={{ color: 'var(--error)' }}>Import blocked — fix these rows and re-upload (nothing was changed):</strong>
          <ul style={{ listStyle: 'none', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {importErrors.slice(0, 20).map((e, i) => <li key={i} className="muted" style={{ fontSize: 13.5 }}>• {e}</li>)}
            {importErrors.length > 20 && <li className="dim" style={{ fontSize: 13 }}>…and {importErrors.length - 20} more</li>}
          </ul>
        </div>
      )}

      {plan && (
        <div className="glass" style={{ padding: 16, marginBottom: 12, borderColor: 'var(--gold)' }}>
          <strong>Ready to publish:</strong>
          <p className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            {plan.creates.length} new dish(es) · {plan.updates.length} update(s)
            {plan.newCategories.length > 0 && <> · new categories: {plan.newCategories.join(', ')}</>}
          </p>
          {plan.missingImages.length > 0 && (
            <p className="dim" style={{ fontSize: 13, marginTop: 4 }}>
              Images not found in storage (placeholder will show): {plan.missingImages.join(', ')}
            </p>
          )}
          <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 8, fontSize: 13.5 }}>
            {plan.creates.map((r) => (
              <div key={'c' + r.row} className="muted">＋ {r.name} — {inr(r.price)} ({r.category})</div>
            ))}
            {plan.updates.map(({ row: r, existing }) => (
              <div key={'u' + r.row} className="muted">
                ✎ {r.name}: {inr(existing.price)} → {inr(r.price)}{existing.is_available !== r.available ? (r.available ? ' · back in stock' : ' · marked out of stock') : ''}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" disabled={importing} onClick={publish}>
              {importing ? 'Publishing…' : 'Publish to live menu'}
            </button>
            <button className="btn btn-ghost" onClick={() => setPlan(null)}>Discard</button>
          </div>
        </div>
      )}

      {/* Categories. Adding one was a bare input tucked at the end of the
          filter chips, and renaming or deleting was not possible at all —
          "make category management obvious" meant building the missing two
          thirds of it. */}
      <div className="chip-row">
        <button className={activeCat === 'all' ? 'chip active' : 'chip'} onClick={() => setActiveCat('all')}>All</button>
        {cats.map((c) => (
          <button key={c.id} className={activeCat === c.id ? 'chip active' : 'chip'} onClick={() => setActiveCat(c.id)}>
            {c.name}
          </button>
        ))}
      </div>

      {editCats && (
        <div className="glass" style={{ padding: 16, marginBottom: 12 }}>
          <p className="overline" style={{ marginBottom: 4 }}>Categories</p>
          <p className="dim" style={{ fontSize: 12, marginBottom: 10 }}>
            Drag to reorder, or use ▲▼ — the order here is the order diners see.
            Renaming and deleting works on every category, including the ones
            that came with your account.
          </p>
          {cats.map((c, idx) => {
            const used = items.filter((d) => d.category_id === c.id).length;
            return (
              <div
                key={c.id}
                className={
                  'row-item cat-row'
                  + (drag?.id === c.id ? ' dragging' : '')
                  + (drag && drag.id !== c.id ? ' sliding' : '')
                }
                style={{ gap: 8, transform: `translateY(${rowShift(idx)}px)` }}
              >
                <span
                  className="cat-grip"
                  title="Drag to reorder"
                  role="button"
                  aria-label={`Reorder ${c.name}`}
                  onPointerDown={(e) => onGripDown(e, c.id, idx)}
                  onPointerMove={onGripMove}
                  onPointerUp={onGripUp}
                  onPointerCancel={onGripUp}
                >⠿</span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <button className="chip cat-nudge" disabled={idx === 0}
                    aria-label={`Move ${c.name} up`}
                    onClick={() => moveCatTo(c.id, idx - 1)}>▲</button>
                  <button className="chip cat-nudge" disabled={idx === cats.length - 1}
                    aria-label={`Move ${c.name} down`}
                    onClick={() => moveCatTo(c.id, idx + 1)}>▼</button>
                </span>
                <input
                  className="code-input"
                  style={{ flex: 1, minWidth: 0, padding: '8px 10px', fontSize: 14 }}
                  defaultValue={c.name}
                  onBlur={async (e) => {
                    const name = e.target.value.trim();
                    if (!name || name === c.name) { e.target.value = c.name; return; }
                    try { await upsertCategory(restaurant.id, name, c.id); load(); }
                    catch (err: any) { setError(`Rename failed: ${err?.message ?? 'unknown error'}`); e.target.value = c.name; }
                  }}
                />
                <span className="dim" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                  {used} dish{used === 1 ? '' : 'es'}
                </span>
                <button
                  className="chip"
                  title="Delete this category"
                  onClick={async () => {
                    // Dishes are the valuable thing, categories are labels. So a
                    // category with dishes in it is still deletable — its dishes
                    // move to Uncategorised rather than the delete being refused,
                    // which is what made seeded categories permanent.
                    const msg = used > 0
                      ? `Delete "${c.name}"?\n\n${used} dish${used === 1 ? '' : 'es'} will move to Uncategorised — nothing is deleted from your menu.`
                      : `Delete the "${c.name}" category?`;
                    if (!confirm(msg)) return;
                    try {
                      if (used > 0) await deleteCategoryWithDishes(c.id);
                      else await deleteCategory(c.id);
                      if (activeCat === c.id) setActiveCat('all');
                      load();
                    } catch (err: any) { setError(`Delete failed: ${err?.message ?? 'unknown error'}`); }
                  }}
                >Delete</button>
              </div>
            );
          })}
          {cats.length === 0 && <p className="muted" style={{ fontSize: 13.5 }}>No categories yet.</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <input className="code-input" style={{ flex: 1, padding: '8px 10px', fontSize: 14 }}
              placeholder="New category name" value={newCat}
              onChange={(e) => setNewCat(e.target.value)} />
            <button className="btn btn-primary" style={{ padding: '8px 16px', fontSize: 14 }} disabled={!newCat.trim()}
              onClick={async () => {
                try { await upsertCategory(restaurant.id, newCat.trim()); setNewCat(''); load(); }
                catch (err: any) { setError(`Could not add category: ${err?.message ?? 'unknown error'}`); }
              }}>
              + Add category
            </button>
          </div>
          <p className="dim" style={{ fontSize: 12, marginTop: 8 }}>
            Rename by editing a name and clicking away. A category can only be
            deleted once it has no dishes.
          </p>
        </div>
      )}

      <div className="glass" style={{ padding: '4px 16px' }}>
        {visible.length === 0 && <p className="muted" style={{ padding: '16px 0' }}>No dishes here yet.</p>}
        {visible.map((d, i) => (
          <div
            key={d.id}
            className={`row-item dish-row${dragDish === d.id ? ' dragging' : ''}`}
            draggable
            onDragStart={() => setDragDish(d.id)}
            onDragEnd={() => setDragDish(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (dragDish && dragDish !== d.id) moveDishTo(dragDish, i); }}
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
              {/* Arrows as well as drag: dragging is unreliable on a phone, and
                  this menu is arranged from behind the counter. */}
              <span className="cat-nudge" aria-hidden>
                <button className="chip" disabled={i === 0} title="Move up"
                  onClick={() => moveDishTo(d.id, i - 1)}>▲</button>
                <button className="chip" disabled={i === visible.length - 1} title="Move down"
                  onClick={() => moveDishTo(d.id, i + 1)}>▼</button>
              </span>
              {d.photo_url
                ? <img className="dish-thumb" src={d.photo_url} alt="" loading="lazy" />
                : <span className="dish-thumb empty" aria-hidden>🍽</span>}
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <VegMark veg={d.is_veg} />{d.name}
                </p>
                <p className="dim" style={{ fontSize: 12.5 }}>
                  {inr(d.price)}
                  {d.category_id && <> · {cats.find((c) => c.id === d.category_id)?.name ?? 'Uncategorised'}</>}
                  {!d.photo_url && <> · no photo</>}
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                className={d.is_available ? 'chip active' : 'chip'}
                onClick={() => toggleAvailable(d)}
                aria-pressed={d.is_available}
              >
                {d.is_available ? 'In stock' : 'Out'}
              </button>
              <button className="chip" onClick={() => setDraft({
                id: d.id, name: d.name, price: String(d.price), category_id: d.category_id,
                description: d.description ?? '', is_veg: d.is_veg, is_available: d.is_available,
                photo_url: d.photo_url,
              })}>Edit</button>
            </div>
          </div>
        ))}
        {visible.length > 1 && (
          <p className="dim" style={{ fontSize: 12.5, padding: '4px 0 12px' }}>
            Drag a dish, or use ▲▼, to set the order diners see.
            {activeCat !== 'all' && ' Within a category, the rest of the menu stays put.'}
          </p>
        )}
      </div>

      {draft && (
        <div className="modal-scrim" onClick={() => setDraft(null)}>
          <div className="sheet sheet-wide" onClick={(e) => e.stopPropagation()}>
            <h2 className="display" style={{ fontSize: 22, marginBottom: 12 }}>
              {draft.id ? 'Edit dish' : 'New dish'}
            </h2>
            <p className="overline" style={{ marginBottom: 6 }}>Name</p>
            <input className="code-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <div style={{ flex: 1 }}>
                <p className="overline" style={{ marginBottom: 6 }}>Price (₹)</p>
                <input className="code-input" inputMode="decimal" value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <p className="overline" style={{ marginBottom: 6 }}>Category</p>
                <select className="code-input" value={draft.category_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}>
                  <option value="">Uncategorised</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <p className="overline" style={{ margin: '12px 0 6px' }}>Description</p>
            <textarea className="notes" rows={4} placeholder="What is in it, how spicy, portion size — diners read this before ordering." value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className={draft.is_veg ? 'chip active' : 'chip'} onClick={() => setDraft({ ...draft, is_veg: true })}>
                <span className="veg-mark" /> Veg
              </button>
              <button className={!draft.is_veg ? 'chip active' : 'chip'} onClick={() => setDraft({ ...draft, is_veg: false })}>
                <span className="veg-mark nonveg" /> Non-veg
              </button>
              <button className={draft.is_available ? 'chip active' : 'chip'}
                onClick={() => setDraft({ ...draft, is_available: !draft.is_available })}>
                {draft.is_available ? 'In stock' : 'Out of stock'}
              </button>
            </div>
            {/* Photo. The previous control was a lone chip inside the toggles
                row: no preview, no progress, and a catch that blamed the
                network for what is normally a storage-permission error. A
                successful upload therefore looked exactly like a failed one,
                which is what "the uploaded image doesn't appear" meant. */}
            <p className="overline" style={{ margin: '14px 0 6px' }}>Photo</p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {draft.photo_url ? (
                <img
                  src={draft.photo_url}
                  alt=""
                  style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 12, border: '1px solid var(--line-strong)' }}
                  onError={() => setError('That photo is saved but will not load — upload it again.')}
                />
              ) : (
                <span
                  aria-hidden
                  style={{
                    width: 64, height: 64, borderRadius: 12, background: 'var(--sand)',
                    border: '1px dashed var(--line-strong)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 26,
                  }}
                >🍛</span>
              )}
              <label className="chip" style={{ cursor: photoBusy ? 'wait' : 'pointer' }}>
                {photoBusy ? 'Uploading…' : draft.photo_url ? 'Replace photo' : 'Add photo'}
                <input type="file" accept="image/*" hidden disabled={photoBusy} onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';   // let the same file be re-picked after a failure
                  if (!f) return;
                  setPhotoBusy(true); setError('');
                  try {
                    const url = await uploadImage('dishes', f);
                    // Functional update: the owner may have kept typing while
                    // the upload was in flight.
                    setDraft((prev) => (prev ? { ...prev, photo_url: url } : prev));
                  } catch (err: any) {
                    setError(`Photo upload failed: ${err?.message ?? 'unknown error'}`);
                  } finally {
                    setPhotoBusy(false);
                  }
                }} />
              </label>
              {draft.photo_url && !photoBusy && (
                <button className="chip" onClick={() => setDraft((p) => (p ? { ...p, photo_url: null } : p))}>
                  Remove
                </button>
              )}
            </div>
            <p className="dim" style={{ fontSize: 12, marginTop: 6 }}>
              Saved with the dish — remember to press Save dish.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save dish'}
              </button>
              {draft.id && (
                <button className="btn btn-ghost" disabled={busy} onClick={async () => {
                  if (!confirm(`Delete "${draft.name}"?`)) return;
                  await deleteDish(draft.id!); setDraft(null); load();
                }}>Delete</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
