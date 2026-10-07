/*
 * LIVE PLANS on the static marketing pages (/pricing, /home).
 *
 * The pages ship with the prices written into the HTML -- that text is what
 * search engines and no-JS visitors read, and it is never removed. This script
 * then asks the database for the current catalog (get_plan_catalog: public,
 * read-only, the same data the admin console edits) and updates the marked
 * elements in place. If the request fails, the page simply keeps its written
 * prices. Nothing here can break the page: every step is guarded.
 *
 * Marked elements:
 *   [data-plan-card=ID]      hidden if the plan is switched off; "hot" if most popular
 *   [data-plan-name=ID]      plan name            [data-plan-desc=ID]  description
 *   [data-plan-price=ID]     monthly price with GST, e.g. ₹1,179
 *   [data-plan-base=ID]      "₹999 + 18% GST"     [data-plan-annual=ID] yearly saving line
 *   [data-plan-features=ID]  <ul> rebuilt as "Everything in X" + what this plan adds
 *   [data-plan-from]         lowest monthly price with GST across plans
 *   [data-plan-table]        comparison <table> rebuilt from the catalog
 *   [data-offer-banner]      shown when the admin marked an offer "show on pricing page"
 */
(function () {
  var SB = 'https://xnhcziciilylzcaupqoq.supabase.co';
  var KEY = 'sb_publishable_zmrlV7bkDZ_cJiIHxd0Slg_0H192fIe';
  if (!window.fetch || !document.querySelector) return;

  function inr(n) { return '₹' + Math.round(Number(n)).toLocaleString('en-IN'); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }

  function apply(c) {
    if (!c || !Array.isArray(c.tiers) || !c.tiers.length) return;
    var labels = c.features || {};
    var label = function (k) { return (labels[k] && labels[k].label) || k.replace(/_/g, ' '); };
    var shown = function (k) { return !(labels[k] && labels[k].hidden); };
    var byId = {};
    c.tiers.forEach(function (t) { byId[t.id] = t; });
    var monthly = function (t) {
      var p = (t.prices || []).filter(function (x) { return x.duration_months === 1; })[0] || (t.prices || [])[0];
      return p || null;
    };

    // Cards
    all('[data-plan-card]').forEach(function (card) {
      var t = byId[card.getAttribute('data-plan-card')];
      if (!t) { card.style.display = 'none'; return; }
      card.style.display = '';
      card.classList.toggle('hot', !!t.is_popular);
      var tag = card.querySelector('.tag');
      if (t.is_popular && !tag) { tag = el('span', 'MOST POPULAR', 'tag'); card.insertBefore(tag, card.firstChild); }
      if (!t.is_popular && tag) tag.parentNode.removeChild(tag);
    });
    all('[data-plan-name]').forEach(function (e) { var t = byId[e.getAttribute('data-plan-name')]; if (t) e.textContent = t.display_name; });
    all('[data-plan-desc]').forEach(function (e) { var t = byId[e.getAttribute('data-plan-desc')]; if (t && t.description) e.textContent = t.description; });
    all('[data-plan-price]').forEach(function (e) {
      var t = byId[e.getAttribute('data-plan-price')], m = t && monthly(t);
      if (m && m.charge_inr) e.textContent = inr(m.charge_inr);
    });
    all('[data-plan-base]').forEach(function (e) {
      var t = byId[e.getAttribute('data-plan-base')], m = t && monthly(t);
      if (m) e.textContent = inr(m.price_inr) + ' + ' + Math.round(m.gst_pct) + '% GST';
    });
    all('[data-plan-annual]').forEach(function (e) {
      var t = byId[e.getAttribute('data-plan-annual')], m = t && monthly(t);
      var y = t && (t.prices || []).filter(function (x) { return x.duration_months === 12; })[0];
      if (m && y && y.charge_inr && m.charge_inr && y.charge_inr < m.charge_inr * 12) {
        e.textContent = 'or ' + inr(y.charge_inr / 12) + '/month paid yearly (' + inr(y.charge_inr) + ' a year)';
        e.style.display = '';
      }
    });

    // Feature lists: "Everything in <previous>" + what this plan adds.
    var order = c.tiers.map(function (t) { return t.id; });
    all('[data-plan-features]').forEach(function (ul) {
      var id = ul.getAttribute('data-plan-features'), t = byId[id];
      if (!t) return;
      var i = order.indexOf(id), prev = i > 0 ? byId[order[i - 1]] : null;
      var adds = t.features.filter(shown).filter(function (f) { return !prev || prev.features.indexOf(f) < 0; });
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      if (prev) { var li = el('li'); li.appendChild(el('b', 'Everything in ' + prev.display_name)); ul.appendChild(li); }
      var max = prev ? 5 : 6;
      adds.slice(0, max).forEach(function (f) { ul.appendChild(el('li', label(f))); });
      if (adds.length > max) ul.appendChild(el('li', 'and ' + (adds.length - max) + ' more'));
    });

    // "From ₹589/month"
    var lows = c.tiers.map(monthly).filter(function (m) { return m && m.charge_inr; }).map(function (m) { return m.charge_inr; });
    if (lows.length) all('[data-plan-from]').forEach(function (e) { e.textContent = inr(Math.min.apply(null, lows)); });

    // Comparison table
    all('table[data-plan-table]').forEach(function (tbl) {
      var keys = [];
      c.tiers.forEach(function (t) { t.features.forEach(function (f) { if (shown(f) && keys.indexOf(f) < 0) keys.push(f); }); });
      keys.sort(function (a, b) { return ((labels[a] && labels[a].sort) || 0) - ((labels[b] && labels[b].sort) || 0); });
      while (tbl.firstChild) tbl.removeChild(tbl.firstChild);
      var head = el('tr'); head.appendChild(el('th', 'What you get'));
      c.tiers.forEach(function (t) { head.appendChild(el('th', t.display_name)); });
      tbl.appendChild(head);
      keys.forEach(function (k) {
        var tr = el('tr'); tr.appendChild(el('td', label(k)));
        c.tiers.forEach(function (t) { var y = t.features.indexOf(k) >= 0; tr.appendChild(el('td', y ? '✓' : '—', y ? 'y' : 'n')); });
        tbl.appendChild(tr);
      });
      var last = el('tr'); last.appendChild(el('td', 'Commission on orders'));
      c.tiers.forEach(function () { last.appendChild(el('td', '0%', 'y')); });
      tbl.appendChild(last);
    });

    // Offer banner
    var b = (c.banners || [])[0];
    all('[data-offer-banner]').forEach(function (box) {
      if (!b) { box.style.display = 'none'; return; }
      while (box.firstChild) box.removeChild(box.firstChild);
      box.appendChild(el('strong', b.text));
      var line = b.label + ' · use code ';
      var p = el('span', line);
      p.style.display = 'block'; p.style.marginTop = '4px'; p.style.fontSize = '14px';
      p.appendChild(el('b', b.code));
      if (b.ends_at) p.appendChild(document.createTextNode(' · until ' + new Date(b.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })));
      box.appendChild(p);
      box.style.display = '';
    });
  }

  try {
    fetch(SB + '/rest/v1/rpc/get_plan_catalog', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: '{}',
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { try { apply(c); } catch (e) { /* keep the written prices */ } })
      .catch(function () { /* offline: keep the written prices */ });
  } catch (e) { /* keep the written prices */ }
})();
