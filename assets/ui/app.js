// Zephyr chrome controller — tab strip, toolbar, bookmarks bar, omnibox.
// Popups (menus/suggestions/panels/prompts) render in the overlay webview:
// we just request them via `overlay-open` and mirror their lifecycle here.
/* global document, window */
(function () {
  'use strict';

  // ---------------------------------------------------------------- ipc
  function ZX(cmd, data) {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: cmd, tab: null, data: data || {} })); }
    catch (e) {}
  }
  var listeners = {};
  window.__zx = {
    post: ZX,
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, payload) {
      var a = listeners[ev];
      if (a) { for (var i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) {} } }
    }
  };

  // ---------------------------------------------------------------- icons
  var I = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5h.01M12 12h.01M12 19h.01" stroke-width="2.6"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.6l-5.8 3-1.1-6.4L.4 9.6l6.5-.9z" transform="translate(1.6 0.6) scale(0.86)"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6l8-3z"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>',
    ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M10 3a2 2 0 0 1 4 0v1h3a2 2 0 0 1 2 2v3h1a2 2 0 0 1 0 4h-1v3a2 2 0 0 1-2 2h-3v1a2 2 0 0 1-4 0v-1H7a2 2 0 0 1-2-2v-3H4a2 2 0 0 1 0-4h1V6a2 2 0 0 1 2-2h3V3z"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    minimize: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor"><path d="M0 5h10"/></svg>',
    maximize: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x="0.5" y="0.5" width="9" height="9" rx="1.2"/></svg>',
    restore: '<svg viewBox="0 0 10 10" fill="none" stroke="currentColor"><rect x="0.5" y="2.5" width="7" height="7" rx="1.2"/><path d="M3 2.5V1.7A1.2 1.2 0 0 1 4.2.5h4.1A1.2 1.2 0 0 1 9.5 1.7v4.1A1.2 1.2 0 0 1 8.3 7h-.8"/></svg>'
  };

  // ---------------------------------------------------------------- state
  var S = {
    tabs: [], active: 0, activeUrl: '', activeTitle: '', activeBlocked: 0,
    prefs: {}, platform: '', frameless: false, maximized: false,
    sessionStats: { ads: 0, trackers: 0, cosmetic: 0, params: 0 },
    downloadsActive: false, bookmarks: [], bookmarked: false,
    serverBase: '', ntpUrl: 'zephyr://newtab', profileName: 'Me',
    loading: false
  };
  var el = {};
  function $(id) { return document.getElementById(id); }

  function hostOf(u) {
    try { return new URL(u).hostname; } catch (e) { return ''; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function letterColor(h) {
    var x = 0;
    for (var i = 0; i < h.length; i++) { x = (x * 31 + h.charCodeAt(i)) % 360; }
    return 'hsl(' + x + ', 58%, 46%)';
  }
  function faviconHtml(t, sz) {
    if (t.favicon) return '<img src="' + esc(t.favicon) + '" alt="">';
    var host = hostOf(t.url) || (t.url.indexOf('zephyr://') === 0 ? 'zephyr' : '?');
    var letter = (host.replace(/^www\./, '')[0] || '?').toUpperCase();
    var col = t.internal ? 'var(--accent)' : letterColor(host);
    return '<span class="letter" style="background:' + col + (sz ? ';width:' + sz + 'px;height:' + sz + 'px' : '') + '">' + letter + '</span>';
  }

  // ---------------------------------------------------------------- height reporting
  function chromeHeight() {
    var h = el.strip.offsetHeight + el.toolbar.offsetHeight;
    if (!el.bmBar.classList.contains('hidden')) h += el.bmBar.offsetHeight;
    return Math.round(h);
  }
  function reportHeight() {
    ZX('chrome-height', { h: chromeHeight() });
  }

  // ---------------------------------------------------------------- tab strip
  function renderTabs() {
    var html = '';
    for (var i = 0; i < S.tabs.length; i++) {
      var t = S.tabs[i];
      html += '<div class="tab' + (t.active ? ' active' : '') + (t.pinned ? ' pinned' : '') + (t.suspended ? ' suspended' : '') +
        '" data-id="' + t.id + '" data-idx="' + i + '" title="' + esc(t.title || t.url) + '">' +
        '<span class="fav">' + (t.loading ? '<span class="spinner"></span>' : faviconHtml(t)) + '</span>' +
        '<span class="title">' + esc(t.title || 'New tab') + '</span>' +
        (t.muted ? '<span class="badge">' + I.mute + '</span>' : '') +
        '<button class="close" data-close="' + t.id + '" title="Close tab">' + I.close + '</button>' +
        '</div>';
    }
    el.tabs.innerHTML = html;
  }

  // ---------------------------------------------------------------- toolbar
  function securityInfo() {
    var u = S.activeUrl;
    if (u.indexOf('zephyr://') === 0) return { cls: 'internal', svg: I.shield, label: 'Zephyr internal page' };
    if (u.indexOf('file://') === 0) return { cls: 'file', svg: I.doc, label: 'Local file' };
    if (u.indexOf('https://') === 0) return { cls: 'https', svg: I.lock, label: 'Connection is secure' };
    if (u.indexOf('http://127.0.0.1') === 0) return { cls: 'internal', svg: I.shield, label: 'Zephyr internal page' };
    if (u.indexOf('http://') === 0) return { cls: 'http', svg: I.warn, label: 'Not secure — do not enter sensitive data' };
    return { cls: 'nolock', svg: I.globe, label: '' };
  }
  function displayUrl() {
    var u = S.activeUrl;
    if (u === S.ntpUrl) return '';
    if (u.indexOf('zephyr://') === 0) {
      var qi = u.indexOf('?');
      var base = qi === -1 ? u : u.slice(0, qi);
      if (base === 'zephyr://blocked') {
        try { return decodeURIComponent(u.slice(qi + 1).replace(/^u=/, '')); } catch (e) { return u; }
      }
      return u;
    }
    // Chrome-style elision for display: hide scheme, leading www. and the
    // trailing slash. The real URL is restored on focus (see url focus handler).
    if (/^https?:\/\/|^ftp:\/\//i.test(u)) {
      var d = u.replace(/^[a-z]+:\/\//i, '');
      d = d.replace(/^www\./i, '');
      if (d.indexOf('/') === d.length - 1) d = d.slice(0, -1);
      return d;
    }
    return u;
  }
  function renderToolbar() {
    var at = S.tabs[S.active];
    el.back.classList.toggle('disabled', !(at && at.canBack));
    el.fwd.classList.toggle('disabled', !(at && at.canFwd));
    el.home.classList.toggle('visible', S.prefs.show_home_button === true);
    var sec = securityInfo();
    var fav = at && !S.loading && at.favicon && S.activeUrl.indexOf('http') === 0
      ? '<img src="' + esc(at.favicon) + '" alt="">' : sec.svg;
    el.sec.innerHTML = fav;
    el.sec.className = 'sec ' + sec.cls;
    el.sec.title = sec.label;
    if (document.activeElement !== el.url) el.url.value = displayUrl();
    var st = S.sessionStats || {};
    var totalBlocked = (st.ads || 0) + (st.trackers || 0) + (st.cosmetic || 0) + (st.params || 0);
    el.extBadge.textContent = totalBlocked > 99 ? '99+' : String(totalBlocked);
    el.extBadge.classList.toggle('hidden', totalBlocked <= 0);
    el.extBtn.title = 'Protection — ' + totalBlocked + ' items blocked this session';
    el.bmStar.classList.toggle('active', !!S.bookmarked);
    el.bmStar.title = S.bookmarked ? 'Edit bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';
    el.dlBtn.classList.toggle('active', !!S.downloadsActive);
    el.dlBtn.classList.toggle('hidden', !S.downloadsActive);
    el.reload.innerHTML = I.reload;
    el.menuBtn.classList.toggle('active', false);
  }

  function renderAll() { renderTabs(); renderToolbar(); renderBookmarksBar(); reportHeight(); }

  function renderPlatform() {
    el.winControls.classList.toggle('hidden', !S.frameless);
    el.profileBtn.querySelector('.avatar-letter').textContent = (S.profileName[0] || 'Z').toUpperCase();
  }

  // ---------------------------------------------------------------- bookmarks bar
  var DEFAULT_SHORTCUTS = ['google.com', 'youtube.com', 'mail.google.com', 'maps.google.com', 'drive.google.com'];
  function brandIcon(url) {
    var h = hostOf(url);
    if (h === 'google.com' || h === 'www.google.com') return '<img src="' + S.serverBase + '/img/google.svg" alt="">';
    if (h.indexOf('youtube.com') !== -1) return '<img src="' + S.serverBase + '/img/youtube.svg" alt="">';
    if (h === 'mail.google.com') return '<img src="' + S.serverBase + '/img/gmail.svg" alt="">';
    if (h === 'maps.google.com') return '<img src="' + S.serverBase + '/img/maps.svg" alt="">';
    if (h === 'drive.google.com') return '<img src="' + S.serverBase + '/img/drive.svg" alt="">';
    return '';
  }
  function renderBookmarksBar() {
    if (S.prefs.show_bookmarks_bar === false) { el.bmBar.classList.add('hidden'); return; }
    el.bmBar.classList.remove('hidden');
    var html = '<div class="bm-item" data-apps="1" title="Apps"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="12" cy="19" r="2"/><circle cx="19" cy="19" r="2"/></svg><span>Apps</span></div>';
    html += '<div class="bm-sep"></div>';
    var barCount = 0;
    for (var i = 0; i < S.bookmarks.length && barCount < 12; i++) {
      var b = S.bookmarks[i];
      if (b.no_bar) continue;
      var brand = brandIcon(b.url);
      var letter = '<span class="letter" style="background:' + letterColor(hostOf(b.url)) + '">' + (b.title || '?')[0].toUpperCase() + '</span>';
      html += '<div class="bm-item" data-url="' + esc(b.url) + '" title="' + esc(b.title || b.url) + '">' + (brand || letter) +
        '<span>' + esc(b.title || hostOf(b.url)) + '</span></div>';
      barCount++;
    }
    var rest = S.bookmarks.length - barCount;
    if (rest > 0 || barCount === 0) {
      html += '<div class="bm-item folder" data-folder="1" title="Other bookmarks">' + I.folder + '<span>Other Bookmarks</span></div>';
    }
    el.bmBar.innerHTML = html;
  }

  function openBmFolder(x, y) {
    var items = [];
    for (var i = 12; i < S.bookmarks.length; i++) {
      items.push({ title: S.bookmarks[i].title, url: S.bookmarks[i].url });
    }
    ZX('overlay-open', {
      kind: 'bmfolder', x: x, y: y,
      payload: { items: items }
    });
  }

  // ---------------------------------------------------------------- popups via overlay
  function openExtensionsPanel(x, y) {
    ZX('overlay-open', {
      kind: 'ext', x: x, y: y,
      payload: {
        layers: [
          { key: 'adblock_enabled', label: 'Ad blocking', sub: 'Network-level filter engine', icon: 'shield' },
          { key: 'netfilter_enabled', label: 'Script filtering', sub: 'JS request interception', icon: 'code' },
          { key: 'cosmetic_enabled', label: 'Element hiding', sub: 'Cosmetic filter rules', icon: 'eye' },
          { key: 'strip_tracking_params', label: 'Tracking parameter stripping', sub: 'utm_*, fbclid, gclid…', icon: 'link' },
          { key: 'fp_canvas', label: 'Canvas randomization', icon: 'grid' },
          { key: 'fp_audio', label: 'Audio randomization', icon: 'audio' },
          { key: 'fp_webgl', label: 'WebGL masking', icon: 'box' },
          { key: 'fp_navigator', label: 'Navigator clamping', icon: 'cpu' },
          { key: 'block_malicious', label: 'Malicious site protection', icon: 'alert' },
          { key: 'do_not_track', label: 'Do-Not-Track signal', icon: 'eye-off' }
        ],
        prefs: S.prefs
      }
    });
  }

  function openProfileMenu(x, y) {
    ZX('overlay-open', {
      kind: 'profile', x: x, y: y,
      payload: {
        name: S.profileName,
        letter: (S.profileName[0] || 'Z').toUpperCase(),
        engine: 'Zephyr · platform web engine'
      }
    });
  }

  function openMainMenu(x, y) {
    var at = S.tabs[S.active];
    ZX('overlay-open', {
      kind: 'menu', x: x, y: y, w: 344,
      payload: {
        zoom: at ? (at.zoom || 1) : 1,
        profile: S.profileName || 'Me',
      }
    });
  }

  function openSiteInfo(x, y) {
    var at = S.tabs[S.active];
    ZX('overlay-open', {
      kind: 'siteinfo', x: x, y: y,
      payload: {
        url: S.activeUrl,
        label: securityInfo().label,
        blocked: S.activeBlocked,
        origin: (S.activeUrl.match(/^https?:\/\/[^/]+/) || [''])[0]
      }
    });
  }

  function openTabMenu(id, x, y) {
    var t = null;
    for (var i = 0; i < S.tabs.length; i++) if (S.tabs[i].id === id) { t = S.tabs[i]; break; }
    if (!t) return;
    ZX('overlay-open', {
      kind: 'tabmenu', x: x, y: y,
      payload: {
        tab: { id: t.id, pinned: !!t.pinned, muted: !!t.muted, url: t.url, title: t.title }
      }
    });
  }

  // ---------------------------------------------------------------- omnibox
  var sugTimer = null;
  function closeSuggest() {
    if (!el.suggestOpen) return;
    el.suggestOpen = false;
    ZX('overlay-close', { reason: 'suggest' });
  }

  // ---------------------------------------------------------------- events from Rust
  function bindEvents() {
    window.onerror = function (msg, src, line, col) {
      try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: 'chrome-error', tab: null, data: { msg: String(msg), src: String(src), line: line, col: col } })); } catch (e) {}
    };
    window.addEventListener('unhandledrejection', function (e) {
      try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: 'chrome-error', tab: null, data: { msg: 'rejection: ' + String(e.reason) } })); } catch (er) {}
    });

    window.__zx.on('state', function (p) {
      S.tabs = p.tabs || [];
      S.active = p.active || 0;
      S.activeUrl = p.activeUrl || '';
      S.activeTitle = p.activeTitle || '';
      S.activeBlocked = p.activeBlocked || 0;
      S.sessionStats = p.sessionStats || S.sessionStats;
      S.prefs = p.prefs || {};
      S.platform = p.platform || S.platform;
      S.frameless = !!p.frameless;
      S.maximized = !!p.maximized;
      S.downloadsActive = !!p.downloadsActive;
      S.serverBase = p.serverBase || S.serverBase;
      S.ntpUrl = p.ntpUrl || S.ntpUrl;
      S.loading = !!(S.tabs[S.active] && S.tabs[S.active].loading);
      applyTheme();
      renderAll();
      renderPlatform();
    });

    window.__zx.on('suggest', function (p) {
      if (document.activeElement !== el.url) return;
      if ((p.q || '') !== el.url.value.trim().toLowerCase()) return;
      var items = p.items || [];
      if (!items.length) { closeSuggest(); return; }
      el.suggestOpen = true;
      var r = el.omnibox.getBoundingClientRect();
      ZX('overlay-open', {
        kind: 'suggest', x: r.left + 8, y: r.bottom + 6, w: r.width - 16,
        payload: { items: items, sel: p.sel == null ? -1 : p.sel }
      });
    });

    window.__zx.on('bm-data', function (p) {
      S.bookmarks = (p.items || []).map(function (b) { return { url: b.url, title: b.title }; });
      S.bookmarked = S.bookmarks.some(function (b) { return b.url === S.activeUrl && b.url.indexOf('zephyr://') !== 0; });
      renderBookmarksBar();
      renderToolbar();
    });
    window.__zx.on('bm-changed', function () { ZX('bm-list', { q: '' }); });

    window.__zx.on('pw-prompt', function (p) {
      ZX('overlay-open', { kind: 'pw', payload: p });
    });
    window.__zx.on('perm-prompt', function (p) {
      var names = { geolocation: 'location access', notifications: 'notifications', camera: 'camera / microphone', microphone: 'microphone' };
      p.title = 'Allow ' + (names[p.kind] || p.kind) + '?';
      ZX('overlay-open', { kind: 'perm', payload: p });
    });
    window.__zx.on('download-done', function (p) {
      toast(p.ok ? 'ok' : 'error', p.ok ? 'Download complete' : 'Download failed');
    });
    window.__zx.on('dl-progress', function () { el.dlBtn.classList.add('active'); });
    window.__zx.on('toast', function (p) { toast(p.kind, p.text); });
    window.__zx.on('lists-updated', function (p) {
      toast(p.ok ? 'ok' : 'error', p.ok ? 'Filter lists updated — ' + p.detail : 'List update failed: ' + p.detail);
    });
    window.__zx.on('data-cleared', function (p) { toast('ok', 'Browsing data cleared' + (p.cookies ? ' (cookies + cache)' : '')); });
    window.__zx.on('pw-saved', function (p) { toast('ok', 'Password saved for ' + p.origin); });
    window.__zx.on('page-saved', function (p) { toast('ok', 'Page saved: ' + p.path); });
    window.__zx.on('close-menus', closePopup);
    window.__zx.on('popup-closed', function () { el.suggestOpen = false; });

    window.__zx.on('win-state', function (p) {
      S.maximized = !!p.maximized;
      el.winMax.innerHTML = S.maximized ? I.restore : I.maximize;
    });

    window.__zx.on('prefs-changed', function (p) {
      if (p.key) { S.prefs[p.key] = p.value; applyTheme(); renderAll(); }
    });
  }

  function toast(kind, text) {
    ZX('overlay-open', { kind: 'toast', payload: { kind: kind || '', text: String(text || '') } });
  }

  function closePopup() {
    ZX('overlay-close', { reason: 'manual' });
    el.suggestOpen = false;
  }

  // ---------------------------------------------------------------- theme
  function applyTheme() {
    var theme = S.prefs.theme || 'light';
    var resolved = theme;
    if (theme === 'system') {
      resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    el.chrome.setAttribute('data-theme', resolved);
    el.chrome.setAttribute('data-density', S.prefs.density || 'normal');
    var accent = S.prefs.accent || '#4b7bec';
    el.chrome.style.setProperty('--accent', accent);
    el.chrome.style.setProperty('--accent-soft', hexToRgba(accent, 0.14));
  }
  function hexToRgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 6) {
      var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    return 'rgba(75,123,236,' + a + ')';
  }

  // ---------------------------------------------------------------- keyboard
  function shortcuts(e) {
    var mod = e.ctrlKey || e.metaKey;
    var k = e.key.toLowerCase();
    if (e.key === 'F12') { ZX('devtools', {}); e.preventDefault(); return; }
    if (e.key === 'F11') { ZX('fullscreen', {}); e.preventDefault(); return; }
    if (e.key === 'F5') { ZX('nav-reload', {}); e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (el.suggestOpen) { closeSuggest(); return; }
      closePopup();
      return;
    }
    if (e.altKey && e.key === 'ArrowLeft') { ZX('nav-back', {}); e.preventDefault(); return; }
    if (e.altKey && e.key === 'ArrowRight') { ZX('nav-forward', {}); e.preventDefault(); return; }
    if (!mod) return;
    if (e.shiftKey) {
      if (k === 't') { ZX('tab-restore-closed', {}); e.preventDefault(); }
      else if (k === 'o') { ZX('nav', { url: 'zephyr://bookmarks' }); e.preventDefault(); }
      else if (k === 'i') { ZX('devtools', {}); e.preventDefault(); }
      else if (k === 'b') { ZX('prefs-set', { key: 'show_bookmarks_bar', value: S.prefs.show_bookmarks_bar ? '0' : '1' }); e.preventDefault(); }
      return;
    }
    switch (k) {
      case 't': ZX('tab-new', {}); e.preventDefault(); break;
      case 'w': ZX('tab-close', { id: activeTabId() }); e.preventDefault(); break;
      case 'n': ZX('win-new', {}); e.preventDefault(); break;
      case 'l': el.url.focus(); el.url.select(); e.preventDefault(); break;
      case 'd': ZX('bm-toggle', { url: S.activeUrl, title: S.activeTitle }); e.preventDefault(); break;
      case 'f': ZX('find-open', {}); e.preventDefault(); break;
      case 'p': ZX('print-page', {}); e.preventDefault(); break;
      case 'j': ZX('nav', { url: 'zephyr://downloads' }); e.preventDefault(); break;
      case 'h': ZX('nav', { url: 'zephyr://history' }); e.preventDefault(); break;
      case 's': ZX('save-page', {}); e.preventDefault(); break;
      case 'u': ZX('view-source', {}); e.preventDefault(); break;
      case '+': case '=': ZX('zoom-inc', {}); e.preventDefault(); break;
      case '-': ZX('zoom-dec', {}); e.preventDefault(); break;
      case '0': ZX('zoom-reset', {}); e.preventDefault(); break;
    }
  }
  function activeTabId() {
    var t = S.tabs[S.active];
    return t ? t.id : 0;
  }

  // ---------------------------------------------------------------- gestures (right-drag, chrome area only)
  var gTrack = false, gMoved = false, gSx = 0, gSy = 0;
  function gestureInit() {
    if (S.prefs.gestures_enabled === false) return;
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 2) return;
      gTrack = true; gMoved = false; gSx = e.clientX; gSy = e.clientY;
    }, true);
    document.addEventListener('mousemove', function (e) {
      if (!gTrack) return;
      if (!gMoved && Math.abs(e.clientX - gSx) + Math.abs(e.clientY - gSy) > 9) gMoved = true;
    }, true);
    document.addEventListener('contextmenu', function (e) {
      var tab = e.target.closest && e.target.closest('.tab');
      if (tab) {
        e.preventDefault();
        if (!gMoved) openTabMenu(parseInt(tab.dataset.id, 10), e.clientX, e.clientY);
        return;
      }
      if (e.target.closest && (e.target.closest('#toolbar') || e.target.closest('#tabstrip') || e.target.closest('#bookmarksbar'))) {
        e.preventDefault();
      }
    }, true);
    document.addEventListener('mouseup', function (e) {
      if (e.button !== 2 || !gTrack) return;
      gTrack = false;
      if (!gMoved) { gMoved = false; return; }
      gMoved = false;
      var dx = e.clientX - gSx, dy = e.clientY - gSy;
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax < 24 && ay < 24) return;
      if (ax > ay * 1.6) { if (dx < 0) ZX('nav-back', {}); else ZX('nav-forward', {}); }
      else if (ay > ax * 1.6) { if (dy < 0) ZX('nav-reload', {}); else ZX('tab-new', {}); }
    }, true);
  }

  // ---------------------------------------------------------------- tab drag reorder
  var dragState = null;
  function tabDragInit() {
    el.tabs.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var tab = e.target.closest && e.target.closest('.tab');
      if (!tab || e.target.closest('.close')) return;
      dragState = { id: parseInt(tab.dataset.id, 10), sx: e.clientX, sy: e.clientY, moved: false };
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragState) return;
      if (!dragState.moved && Math.abs(e.clientX - dragState.sx) > 6) dragState.moved = true;
      if (dragState.moved) {
        var node = el.tabs.querySelector('.tab[data-id="' + dragState.id + '"]');
        if (node) {
          node.classList.add('dragging');
          node.style.transform = 'translateX(' + (e.clientX - dragState.sx) + 'px)';
        }
      }
    });
    document.addEventListener('mouseup', function (e) {
      if (!dragState) return;
      var d = dragState; dragState = null;
      var node = el.tabs.querySelector('.tab[data-id="' + d.id + '"]');
      if (node) { node.classList.remove('dragging'); node.style.transform = ''; }
      if (!d.moved) return;
      // compute new index from pointer position
      var tabs = el.tabs.querySelectorAll('.tab:not(.dragging)');
      var idx = tabs.length;
      for (var i = 0; i < tabs.length; i++) {
        var r = tabs[i].getBoundingClientRect();
        if (e.clientX < r.left + r.width / 2) { idx = i; break; }
      }
      ZX('tab-move', { id: d.id, index: idx });
    });
  }

  // ---------------------------------------------------------------- dom wiring
  function bindDom() {
    el.newtab.addEventListener('click', function () { ZX('tab-new', {}); });
    el.back.addEventListener('click', function () { ZX('nav-back', {}); });
    el.fwd.addEventListener('click', function () { ZX('nav-forward', {}); });
    el.reload.addEventListener('click', function () { ZX('nav-reload', {}); });
    el.home.addEventListener('click', function () { ZX('nav-home', {}); });
    el.dlBtn.addEventListener('click', function () { ZX('nav', { url: 'zephyr://downloads' }); });
    el.menuBtn.addEventListener('click', function (e) {
      var r = el.menuBtn.getBoundingClientRect();
      openMainMenu(r.right - 240, r.bottom + 6);
    });
    el.extBtn.addEventListener('click', function (e) {
      var r = el.extBtn.getBoundingClientRect();
      openExtensionsPanel(r.right - 280, r.bottom + 6);
    });
    el.profileBtn.addEventListener('click', function () {
      var r = el.profileBtn.getBoundingClientRect();
      openProfileMenu(r.right - 260, r.bottom + 6);
    });
    el.sec.addEventListener('click', function (e) {
      var r = el.omnibox.getBoundingClientRect();
      openSiteInfo(r.left + 8, r.bottom + 6);
    });
    el.bmStar.addEventListener('click', function () {
      var at = S.tabs[S.active];
      ZX('bm-toggle', at ? { url: at.url, title: at.title } : {});
    });

    // window controls (frameless)
    el.winMin.addEventListener('click', function () { ZX('win-min', {}); });
    el.winMax.addEventListener('click', function () { ZX('win-max-toggle', {}); });
    el.winClose.addEventListener('click', function () { ZX('win-close', {}); });

    // window drag: blank strip areas + empty tab strip space
    function dragHandler(e) {
      if (e.button !== 0) return;
      if (e.target.closest && (e.target.closest('.tab') || e.target.closest('button') || e.target.closest('#tabs'))) return;
      if (e.detail === 2) { ZX('win-max-toggle', {}); return; }
      ZX('win-drag', {});
    }
    el.strip.addEventListener('mousedown', dragHandler);
    el.dragStrip.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      if (e.detail === 2) { ZX('win-max-toggle', {}); return; }
      ZX('win-drag', {});
    });

    // tabs
    el.tabs.addEventListener('click', function (e) {
      var close = e.target.closest && e.target.closest('.close');
      if (close) {
        e.stopPropagation();
        ZX('tab-close', { id: parseInt(close.dataset.close, 10) });
        return;
      }
      var tab = e.target.closest && e.target.closest('.tab');
      if (tab) ZX('tab-activate', { id: parseInt(tab.dataset.id, 10) });
    });
    el.tabs.addEventListener('mousedown', function (e) {
      if (e.button === 1) {
        var tab = e.target.closest && e.target.closest('.tab');
        if (tab) { e.preventDefault(); ZX('tab-close', { id: parseInt(tab.dataset.id, 10) }); }
      }
    });

    // omnibox
    el.url.addEventListener('focus', function () {
      // editing always shows the full URL (display may be elided)
      el.url.value = S.activeUrl === S.ntpUrl ? '' : S.activeUrl;
      el.url.select();
    });
    el.url.addEventListener('blur', function () { el.url.value = displayUrl(); });
    el.url.addEventListener('input', function () {
      clearTimeout(sugTimer);
      var q = el.url.value.trim();
      if (!q) { closeSuggest(); return; }
      sugTimer = setTimeout(function () { ZX('addr-query', { q: q }); }, 70);
    });
    el.url.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        ZX('nav', { url: el.url.value });
        closeSuggest();
        el.url.blur();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        closeSuggest();
        el.url.value = displayUrl();
        el.url.blur();
      }
    });

    // bookmarks bar
    el.bmBar.addEventListener('click', function (e) {
      var item = e.target.closest && e.target.closest('.bm-item');
      if (!item) return;
      if (item.dataset.apps) { ZX('nav-home', {}); return; }
      if (item.dataset.folder) {
        var r = item.getBoundingClientRect();
        openBmFolder(r.left, r.bottom + 6);
        return;
      }
      if (item.dataset.url) ZX('nav', { url: item.dataset.url });
    });
    el.bmBar.addEventListener('contextmenu', function (e) {
      var item = e.target.closest && e.target.closest('.bm-item[data-url]');
      if (!item) return;
      e.preventDefault();
      ZX('overlay-open', {
        kind: 'bmedit', x: e.clientX, y: e.clientY,
        payload: { url: item.dataset.url, title: item.title }
      });
    });

    document.addEventListener('keydown', shortcuts);
    window.addEventListener('resize', reportHeight);
    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
          if ((S.prefs.theme || 'light') === 'system') applyTheme();
        });
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------- edge resize (frameless: top / upper sides)
  function edgeInit() {
    var E = 6, C = { n: 'ns-resize', nw: 'nwse-resize', ne: 'nesw-resize', w: 'ew-resize', e: 'ew-resize' };
    document.addEventListener('mousemove', function (e) {
      if (!S.frameless) return;
      var west = e.clientX <= E, east = e.clientX >= window.innerWidth - E;
      var north = e.clientY <= E;
      var d = north && west ? 'nw' : north && east ? 'ne' : north ? 'n' : west ? 'w' : east ? 'e' : null;
      el.chrome.style.cursor = d ? C[d] : '';
    }, true);
    document.addEventListener('mousedown', function (e) {
      if (!S.frameless || e.button !== 0) return;
      var west = e.clientX <= E, east = e.clientX >= window.innerWidth - E;
      var north = e.clientY <= E;
      var d = north && west ? 'nw' : north && east ? 'ne' : north ? 'n' : west ? 'w' : east ? 'e' : null;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      ZX('win-resize', { dir: d });
    }, true);
  }

  // ---------------------------------------------------------------- init
  function init() {
    el = {
      chrome: $('chrome'),
      strip: $('tabstrip'), tabs: $('tabs'), newtab: $('newtab'), dragStrip: $('drag-strip'),
      toolbar: $('toolbar'),
      winControls: $('win-controls'), winMin: $('win-min'), winMax: $('win-max'), winClose: $('win-close'),
      back: $('nav-back'), fwd: $('nav-fwd'), reload: $('nav-reload'), home: $('nav-home'),
      omnibox: $('omnibox'), sec: $('sec-icon'), url: $('url-input'),
      bmStar: $('bm-star'), extBadge: $('ext-badge'),
      dlBtn: $('dl-btn'), extBtn: $('ext-btn'), profileBtn: $('profile-btn'), menuBtn: $('menu-btn'),
      bmBar: $('bookmarksbar')
    };
    el.newtab.innerHTML = I.plus;
    el.back.innerHTML = I.back;
    el.fwd.innerHTML = I.fwd;
    el.reload.innerHTML = I.reload;
    el.home.innerHTML = I.home;
    el.bmStar.innerHTML = I.star;
    el.dlBtn.innerHTML = I.dl + '<span class="dot"></span>';
    el.extBtn.innerHTML = I.ext + '<span id="ext-badge" class="tb-badge hidden"></span>';
    el.extBadge = $('ext-badge'); // re-query: innerHTML assignment above recreated the node
    el.menuBtn.innerHTML = I.menu;
    el.profileBtn.innerHTML = '<span class="avatar-letter">Z</span>';
    el.winMin.innerHTML = I.minimize;
    el.winMax.innerHTML = I.maximize;
    el.winClose.innerHTML = I.close;

    bindEvents();
    bindDom();
    gestureInit();
    tabDragInit();
    edgeInit();
    el.url.value = '';

    ZX('hello', { ua: navigator.userAgent });
    ZX('bm-list', { q: '' });
    reportHeight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
