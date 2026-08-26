/** Menu management: categories + dishes CRUD, instant price edits,
 *  availability toggles, image upload, and Growth-gated Excel bulk import
 *  (template → validate all-or-nothing → diff preview → publish). */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
  fetchMenuAdmin, upsertCategory, saveDish, deleteDish, uploadImage,
  type PortalCategory, type PortalDish,
  deleteCategory,
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
          <button className="btn btn-primary" style={{ padding: '10px 16px', fontSize: 14 }}
            onClick={() => setDraft(emptyDraft(activeCat === 'all' ? cats[0]?.id ?? null : activeCat))}>
            + Add dish
          </button>
        </div>
      </div>
      {error && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 10 }}>{error}</p>}

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
        <button className={editCats ? 'chip active' : 'chip'} onClick={() => setEditCats(!editCats)}>
          {editCats ? '✕ Done' : '✎ Edit categories'}
        </button>
      </div>

      {editCats && (
        <div className="glass" style={{ padding: 16, marginBottom: 12 }}>
          <p className="overline" style={{ marginBottom: 10 }}>Categories</p>
          {cats.map((c) => {
            const used = items.filter((d) => d.category_id === c.id).length;
            return (
              <div key={c.id} className="row-item" style={{ gap: 10 }}>
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
                  // Deleting a category with dishes in it would leave them
                  // unreachable behind the diner's category filter.
                  disabled={used > 0}
                  title={used > 0 ? 'Move or delete its dishes first' : 'Delete this category'}
                  onClick={async () => {
                    if (!confirm(`Delete the "${c.name}" category?`)) return;
                    try {
                      await deleteCategory(c.id);
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
        {visible.map((d) => (
          <div key={d.id} className="row-item">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
              <VegMark veg={d.is_veg} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</p>
                <p className="dim" style={{ fontSize: 12.5 }}>{inr(d.price)}</p>
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
      </div>

      {draft && (
        <div className="modal-scrim" onClick={() => setDraft(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
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
            <textarea className="notes" value={draft.description}
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
