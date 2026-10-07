/*
 * LIVE WEBSITE TEXT on the static marketing pages, edited in /admin/website.
 *
 * The pages ship with their text written into the HTML -- that is what search
 * engines, no-JS visitors and the first paint show, and it is never removed.
 * This script asks the database for the PUBLISHED text (get_site_content:
 * public, read-only) and replaces only the marked elements, only with
 * non-empty values. If anything fails, the page keeps its written text.
 *
 * Everything is placed with textContent (never as HTML), and links are only
 * used when they start with https:// (or are built here as mailto:/tel:/wa.me),
 * so nothing typed in the console can run as code on the site.
 *
 * Marked elements:
 *   [data-cms=path]               text, e.g. data-cms="hero.title"
 *   [data-cms-list=path]          <ul> rebuilt from a list of lines
 *   [data-cms-faqs]               the <details> questions, rebuilt
 *   [data-cms-email=path]         <a> mailto link + its text
 *   [data-cms-contact-extra]      a card shown only when a phone/WhatsApp is set
 *   [data-cms-social]             footer social links, shown only when set
 *   [data-cms-photo=path]         the hero picture: a photo replaces the phone mock
 *
 * PREVIEW. Opened as ?cms-preview=1 inside the admin console's frame, the page
 * skips the database and shows whatever the console sends (same origin only).
 */
(function () {
  var SB = 'https://xnhcziciilylzcaupqoq.supabase.co';
  var KEY = 'sb_publishable_zmrlV7bkDZ_cJiIHxd0Slg_0H192fIe';
  if (!window.fetch || !document.querySelector) return;

  var originals = typeof WeakMap === 'function' ? new WeakMap() : null;
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function get(o, path) {
    return String(path).split('.').reduce(function (a, k) { return a == null ? undefined : a[k]; }, o);
  }
  function str(v) { return typeof v === 'string' && v.trim() ? v : null; }
  function keep(el, what) {
    if (!originals) return null;
    if (!originals.has(el)) originals.set(el, what === 'html' ? el.innerHTML : el.textContent);
    return originals.get(el);
  }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function safeUrl(u) { return typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : null; }
  function safeEmail(e) { return typeof e === 'string' && /^[^@\s"'<>]+@[^@\s"'<>]+\.[^@\s"'<>]+$/.test(e) ? e : null; }
  function digits(p) { return typeof p === 'string' ? p.replace(/[^0-9+]/g, '') : ''; }

  function apply(c) {
    if (!c || typeof c !== 'object') return;

    all('[data-cms]').forEach(function (e) {
      var orig = keep(e, 'text');
      var v = str(get(c, e.getAttribute('data-cms')));
      var want = v != null ? v : orig;
      if (want != null && e.textContent !== want) e.textContent = want;
    });

    all('[data-cms-list]').forEach(function (ul) {
      var orig = keep(ul, 'html');
      var list = get(c, ul.getAttribute('data-cms-list'));
      var lines = Array.isArray(list) ? list.filter(function (x) { return str(x); }) : [];
      if (!lines.length) { if (orig != null && ul.innerHTML !== orig) ul.innerHTML = orig; return; }
      var now = Array.prototype.map.call(ul.children, function (li) { return li.textContent; });
      if (now.join('\n') === lines.join('\n')) return;
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      lines.forEach(function (t) { ul.appendChild(el('li', t)); });
    });

    all('[data-cms-faqs]').forEach(function (box) {
      var orig = keep(box, 'html');
      var faqs = Array.isArray(c.faqs) ? c.faqs.filter(function (f) { return f && str(f.q) && str(f.a); }) : [];
      if (!faqs.length) { if (orig != null && box.innerHTML !== orig) box.innerHTML = orig; return; }
      var now = Array.prototype.map.call(box.querySelectorAll('details'), function (d) {
        var s = d.querySelector('summary'), p = d.querySelector('p');
        return (s ? s.textContent : '') + '\u0000' + (p ? p.textContent : '');
      });
      var want = faqs.map(function (f) { return f.q + '\u0000' + f.a; });
      if (now.join('\n') === want.join('\n')) return;
      while (box.firstChild) box.removeChild(box.firstChild);
      faqs.forEach(function (f) {
        var d = el('details', null, 'reveal in');
        d.appendChild(el('summary', f.q));
        d.appendChild(el('p', f.a));
        box.appendChild(d);
      });
    });

    all('[data-cms-email]').forEach(function (a) {
      var orig = keep(a, 'text');
      var v = safeEmail(get(c, a.getAttribute('data-cms-email'))) || orig;
      if (!v) return;
      if (a.textContent !== v) a.textContent = v;
      a.setAttribute('href', 'mailto:' + v);
    });

    all('[data-cms-contact-extra]').forEach(function (card) {
      var p = card.querySelector('p');
      var phone = str(get(c, 'contact.phone')), wa = str(get(c, 'contact.whatsapp'));
      if (!p || (!phone && !wa)) { card.style.display = 'none'; return; }
      while (p.firstChild) p.removeChild(p.firstChild);
      if (phone && digits(phone).length >= 6) {
        var a = el('a', phone); a.setAttribute('href', 'tel:' + digits(phone)); p.appendChild(a); p.appendChild(el('br'));
      }
      if (wa && digits(wa).replace('+', '').length >= 6) {
        var w = el('a', 'WhatsApp ' + wa);
        w.setAttribute('href', 'https://wa.me/' + digits(wa).replace('+', ''));
        w.setAttribute('target', '_blank'); w.setAttribute('rel', 'noopener');
        p.appendChild(w); p.appendChild(el('br'));
      }
      p.appendChild(document.createTextNode('Call or message us — we answer fast.'));
      card.style.display = '';
    });

    all('[data-cms-social]').forEach(function (box) {
      var s = get(c, 'footer.social') || {};
      var names = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn', x: 'X' };
      while (box.firstChild) box.removeChild(box.firstChild);
      var n = 0;
      Object.keys(names).forEach(function (k) {
        var u = safeUrl(s[k]);
        if (!u) return;
        var a = el('a', names[k]);
        a.setAttribute('href', u); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener');
        a.style.marginLeft = '0'; a.style.marginRight = '14px';
        box.appendChild(a); n++;
      });
      box.style.display = n ? '' : 'none';
    });

    all('[data-cms-photo]').forEach(function (frame) {
      var u = safeUrl(get(c, frame.getAttribute('data-cms-photo')));
      var img = frame.querySelector('img.cms-photo');
      var screen = frame.querySelector('.phone-screen');
      if (!u) {
        if (img) img.parentNode.removeChild(img);
        if (screen) screen.style.display = '';
        return;
      }
      if (!img) {
        img = el('img', null, 'cms-photo');
        img.setAttribute('alt', '');
        img.style.cssText = 'display:block;width:100%;aspect-ratio:3/4;object-fit:cover;border-radius:28px;background:#faf6ef';
        frame.appendChild(img);
      }
      if (img.getAttribute('src') !== u) img.setAttribute('src', u);
      if (screen) screen.style.display = 'none';
    });
  }

  var preview = /[?&]cms-preview=1(&|$)/.test(location.search) && window.parent && window.parent !== window;
  if (preview) {
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      var d = e.data;
      if (d && d.type === 'menutha-cms-preview') { try { apply(d.content); } catch (err) { /* keep the page */ } }
    });
    // Links inside the preview must not navigate the frame away.
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (a) e.preventDefault();
    }, true);
    try { window.parent.postMessage({ type: 'menutha-cms-ready' }, location.origin); } catch (err) { /* ignore */ }
    return;
  }

  try {
    fetch(SB + '/rest/v1/rpc/get_site_content', {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: '{}',
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { try { apply(c); } catch (e) { /* keep the written text */ } })
      .catch(function () { /* offline: keep the written text */ });
  } catch (e) { /* keep the written text */ }
})();
