// Zephyr chrome controller — tab strip, toolbar, omnibox, menus, prompts.
/* global document, window, localStorage */
(function () {
  'use strict';

  // ---------------------------------------------------------------- ipc
  function ZX(cmd, data) {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: cmd, tab: null, data: data || {} })); }
    catch (e) {}
  }
  var listeners = {};
  window.__zx = {
    post: function (cmd, data) { ZX(cmd, data); },
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, payload) {
      var a = listeners[ev];
      if (a) { for (var i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) {} } }
    }
  };

  // ---------------------------------------------------------------- icons (inline SVG)
  var I = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    fwd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 21h20L12 3z"/><path d="M12 10v5M12 18.5v.01"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14 0 18-3-4-3-14.5 0-18z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6l8-3z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>',
    find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    newtab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 8v8M8 12h8"/></svg>',
    newwin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="12" height="12" rx="2"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M5 6l1 15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-15"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8L4 7l2-2 3.8 5M15 10.8L20 7l-2-2-3.8 5"/><path d="M12 3a4 4 0 0 0-4 4c0 2 1.5 3.6 2 4l2 4 2-4c.5-.4 2-2 2-4a4 4 0 0 0-4-4z"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3l1.5 1.5-2 2L21 8l-2.5 2.5-1.5-1.5-5 5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
    zoomin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>',
    zoomout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7z"/></svg>'
  };

  // ---------------------------------------------------------------- state
  var S = {
    tabs: [], active: 0, activeUrl: '', activeTitle: '', activeBlocked: 0,
    prefs: {}, sessionStats: { ads: 0, trackers: 0, cosmetic: 0, params: 0 },
    downloadsActive: false, bookmarks: [], findOpen: false, findCount: -1,
    serverBase: '', ntpUrl: 'zephyr://newtab'
  };
  var el = {};
  function $(id) { return document.getElementById(id); }

  function hostOf(u) {
    try { return new URL(u).hostname; } catch (e) { return ''; }
  }
  function letterColor(h) {
    var x = 0;
    for (var i = 0; i < h.length; i++) { x = (x * 31 + h.charCodeAt(i)) % 360; }
    return 'hsl(' + x + ', 55%, 45%)';
  }
  function faviconHtml(t) {
    if (t.favicon) return '<img src="' + t.favicon + '" alt="">';
    var host = hostOf(t.url) || (t.url.indexOf('zephyr://') === 0 ? 'zephyr' : '?');
    var letter = (host.replace(/^www\./, '')[0] || '?').toUpperCase();
    if (t.internal) return '<span class="letter" style="background:var(--accent)">' + letter + '</span>';
    return '<span class="letter" style="background:' + letterColor(host) + '">' + letter + '</span>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------- tab strip
  function renderTabs() {
    var html = '';
    for (var i = 0; i < S.tabs.length; i++) {
      var t = S.tabs[i];
      html += '<div class="tab' + (t.active ? ' active' : '') + (t.pinned ? ' pinned' : '') + (t.suspended ? ' suspended' : '') +
        '" data-id="' + t.id + '" data-idx="' + i + '" title="' + esc(t.title || t.url) + '">' +
        '<span class="fav">' + (t.loading ? '<span class="spinner"></span>' : faviconHtml(t)) + '</span>' +
        '<span class="title">' + esc(t.title || '…') + '</span>' +
        (t.muted ? '<span class="badge">' + I.mute.replace('<svg', '<svg width="11" height="11"') + '</span>' : '') +
        '<button class="close" data-close="' + t.id + '" title="Close tab">' + I.close + '</button>' +
        '</div>';
    }
    el.tabs.innerHTML = html;
  }

  el.tabs = null; // set in init

  function tabById(id) {
    for (var i = 0; i < S.tabs.length; i++) if (S.tabs[i].id === id) return S.tabs[i];
    return null;
  }

  // ---------------------------------------------------------------- toolbar / omnibox
  function securityIcon() {
    var u = S.activeUrl;
    if (u.indexOf('zephyr://') === 0) return { cls: 'internal', svg: I.shield };
    if (u.indexOf('https://') === 0) return { cls: 'https', svg: I.lock };
    if (u.indexOf('http://') === 0) return { cls: 'http', svg: I.warn };
    if (u.indexOf('file://') === 0) return { cls: 'file', svg: I.doc };
    if (u.indexOf('http://127.0.0.1') === 0) return { cls: 'internal', svg: I.shield };
    return { cls: '', svg: I.globe };
  }
  function displayUrl() {
    var u = S.activeUrl;
    if (u === S.ntpUrl) return '';
    if (u.indexOf('zephyr://') === 0) {
      var q = '';
      var qi = u.indexOf('?');
      if (qi !== -1) { try { q = decodeURIComponent(u.slice(qi + 1).replace(/^u=/, '')); } catch (e) { q = u.slice(qi + 1); } }
      var base = qi === -1 ? u : u.slice(0, qi);
      if (base === 'zephyr://blocked') return q || u;
      return u;
    }
    return u;
  }
  function renderToolbar() {
    var at = S.tabs[S.active];
    el.back.classList.toggle('disabled', !(at && at.canBack));
    el.fwd.classList.toggle('disabled', !(at && at.canFwd));
    el.home.style.display = S.prefs.show_home_button === false ? 'none' : 'flex';
    var sec = securityIcon();
    el.sec.innerHTML = sec.svg;
    el.sec.className = 'sec ' + sec.cls;
    if (document.activeElement !== el.url) {
      el.url.value = displayUrl();
    }
    if (S.activeBlocked > 0) {
      el.chip.innerHTML = I.shield + '<span>' + S.activeBlocked + '</span>';
      el.chip.classList.remove('hidden');
      el.chip.title = 'Privacy protection: ' + S.activeBlocked + ' items blocked on this page — click for the dashboard';
    } else {
      el.chip.classList.add('hidden');
    }
    el.dlBtn.classList.toggle('active', !!S.downloadsActive);
    el.bmBar.classList.toggle('hidden', S.prefs.show_bookmarks_bar !== true);
  }

  function renderAll() { renderTabs(); renderToolbar(); renderBookmarksBar(); }

  // ---------------------------------------------------------------- bookmarks bar
  function renderBookmarksBar() {
    if (S.prefs.show_bookmarks_bar !== true) return;
    var html = '';
    for (var i = 0; i < S.bookmarks.length && i < 40; i++) {
      var b = S.bookmarks[i];
      var h = hostOf(b.url) || '?';
      html += '<div class="bm-item" data-url="' + esc(b.url) + '" title="' + esc(b.title || b.url) + '">' +
        '<span class="dot" style="background:' + letterColor(h) + '"></span>' + esc(b.title || h) + '</div>';
    }
    el.bmBar.innerHTML = html || '<div class="bm-item" style="color:var(--text2)">No bookmarks yet — press Ctrl+D</div>';
  }

  // ---------------------------------------------------------------- suggestions
  var sugItems = [], sugSel = -1, sugTimer = null;

  function renderSuggest(items) {
    sugItems = items || [];
    sugSel = -1;
    if (!sugItems.length) { el.suggest.classList.add('hidden'); updateChromeHeight(); return; }
    var html = '';
    for (var i = 0; i < sugItems.length; i++) {
      var it = sugItems[i];
      var ico = it.kind === 'search' ? I.search : it.kind === 'bookmark' ? I.bookmark : it.kind === 'history' ? I.history : I.globe;
      html += '<div class="sug-item" data-idx="' + i + '">' +
        '<span class="kind">' + ico + '</span>' +
        '<span class="txt">' + esc(it.title || it.url) + '</span>' +
        '<span class="url">' + esc(hostOf(it.url) || '') + '</span></div>';
    }
    el.suggest.innerHTML = html;
    el.suggest.classList.remove('hidden');
    updateChromeHeight();
  }
  function sugGo(idx) {
    if (idx >= 0 && idx < sugItems.length) {
      ZX('nav', { url: sugItems[idx].url });
    }
    closeSuggest();
  }
  function closeSuggest() {
    el.suggest.classList.add('hidden');
    sugItems = []; sugSel = -1;
    updateChromeHeight();
  }

  // ---------------------------------------------------------------- menus
  var openPopups = 0;
  function updateChromeHeight() {
    var extra = 0;
    var anyOpen = !el.suggest.classList.contains('hidden') || !el.menu.classList.contains('hidden') ||
      !el.tabmenu.classList.contains('hidden') || !el.findbar.classList.contains('hidden') ||
      !el.pwPrompt.classList.contains('hidden') || !el.permPrompt.classList.contains('hidden') ||
      document.getElementById('toasts').children.length > 0;
    if (!el.suggest.classList.contains('hidden')) extra = Math.max(extra, 300);
    if (!el.menu.classList.contains('hidden')) extra = Math.max(extra, 330);
    if (!el.tabmenu.classList.contains('hidden')) extra = Math.max(extra, 240);
    if (!el.findbar.classList.contains('hidden')) extra = Math.max(extra, 40);
    if (!el.pwPrompt.classList.contains('hidden') || !el.permPrompt.classList.contains('hidden')) extra = Math.max(extra, 64);
    if (document.getElementById('toasts').children.length > 0) extra = Math.max(extra, 58);
    ZX('chrome-height', { h: 86 + extra, open: anyOpen });
  }

  var MENU_ITEMS = [
    { cmd: 'tab-new', ico: I.newtab, label: 'New tab', kbd: 'Ctrl+T' },
    { cmd: 'win-new', ico: I.newwin, label: 'New window', kbd: 'Ctrl+N' },
    { sep: true },
    { cmd: 'open-bookmarks', ico: I.bookmark, label: 'Bookmarks', kbd: 'Ctrl+Shift+O' },
    { cmd: 'open-history', ico: I.history, label: 'History', kbd: 'Ctrl+H' },
    { cmd: 'open-downloads', ico: I.dl, label: 'Downloads', kbd: 'Ctrl+J' },
    { cmd: 'open-privacy', ico: I.shield, label: 'Privacy dashboard' },
    { sep: true },
    { cmd: 'save-page', ico: I.save, label: 'Save page…', kbd: 'Ctrl+S' },
    { cmd: 'print-page', ico: I.print, label: 'Print…', kbd: 'Ctrl+P' },
    { cmd: 'find-open', ico: I.find, label: 'Find in page', kbd: 'Ctrl+F' },
    { sep: true },
    { cmd: 'zoom-inc', ico: I.zoomin, label: 'Zoom in', kbd: 'Ctrl++' },
    { cmd: 'zoom-dec', ico: I.zoomout, label: 'Zoom out', kbd: 'Ctrl+−' },
    { cmd: 'zoom-reset', ico: I.refresh, label: 'Reset zoom', kbd: 'Ctrl+0' },
    { cmd: 'fullscreen', ico: I.expand, label: 'Full screen', kbd: 'F11' },
    { sep: true },
    { cmd: 'view-source', ico: I.code, label: 'View page source', kbd: 'Ctrl+U' },
    { cmd: 'devtools', ico: I.wrench, label: 'Developer tools', kbd: 'F12' },
    { sep: true },
    { cmd: 'open-settings', ico: I.settings, label: 'Settings' }
  ];

  function menuItem(it) {
    if (it.sep) return '<div class="menu-sep"></div>';
    return '<div class="menu-item" data-cmd="' + it.cmd + '" data-arg="' + esc(it.arg || '') + '">' +
      '<span class="ico">' + it.ico + '</span><span>' + it.label + '</span>' +
      (it.kbd ? '<span class="kbd">' + it.kbd + '</span>' : '') + '</div>';
  }

  function openMenu() {
    el.menu.innerHTML = MENU_ITEMS.map(menuItem).join('');
    el.menu.classList.remove('hidden');
    updateChromeHeight();
  }
  function closeMenu() { el.menu.classList.add('hidden'); updateChromeHeight(); }

  function openTabMenu(id, x) {
    var t = tabById(id);
    if (!t) return;
    var items = [
      { cmd: 'tab-new', ico: I.newtab, label: 'New tab' },
      { cmd: 'tab-duplicate', arg: String(t.id), ico: I.doc, label: 'Duplicate' },
      { sep: true },
      { cmd: 'tab-pin', arg: JSON.stringify({ id: t.id, pinned: !t.pinned }), ico: I.pin, label: t.pinned ? 'Unpin tab' : 'Pin tab' },
      { cmd: 'tab-mute', arg: JSON.stringify({ id: t.id, muted: !t.muted }), ico: t.muted ? I.sound : I.mute, label: t.muted ? 'Unmute site' : 'Mute site' },
      { cmd: 'tab-suspend', arg: String(t.id), ico: I.up, label: 'Suspend tab (free memory)' },
      { sep: true },
      { cmd: 'bm-add', arg: JSON.stringify({ url: t.url, title: t.title }), ico: I.star, label: 'Bookmark tab' },
      { cmd: 'tab-restore-closed', ico: I.refresh, label: 'Reopen closed tab', kbd: 'Ctrl+Shift+T' },
      { cmd: 'tab-close-others', arg: String(t.id), ico: I.close, label: 'Close other tabs' },
      { sep: true },
      { cmd: 'tab-close', arg: String(t.id), ico: I.close, label: 'Close tab', kbd: 'Ctrl+W' }
    ];
    el.tabmenu.innerHTML = items.map(menuItem).join('');
    el.tabmenu.style.left = Math.min(x, window.innerWidth - 240) + 'px';
    el.tabmenu.classList.remove('hidden');
    updateChromeHeight();
  }
  function closeTabMenu() { el.tabmenu.classList.add('hidden'); updateChromeHeight(); }

  function runMenuCmd(cmd, arg) {
    switch (cmd) {
      case 'open-settings': ZX('nav', { url: 'zephyr://settings' }); break;
      case 'open-bookmarks': ZX('nav', { url: 'zephyr://bookmarks' }); break;
      case 'open-history': ZX('nav', { url: 'zephyr://history' }); break;
      case 'open-downloads': ZX('nav', { url: 'zephyr://downloads' }); break;
      case 'open-privacy': ZX('nav', { url: 'zephyr://privacy' }); break;
      case 'tab-duplicate': ZX(cmd, { id: parseInt(arg, 10) }); break;
      case 'tab-pin': case 'tab-mute': {
        var o = JSON.parse(arg);
        ZX(cmd, o);
        break;
      }
      case 'bm-add': {
        var bo = JSON.parse(arg);
        ZX(cmd, bo);
        break;
      }
      default:
        ZX(cmd, arg != null && arg !== '' ? { id: parseInt(arg, 10) } : {});
    }
  }

  // ---------------------------------------------------------------- find bar
  function openFind() {
    S.findOpen = true;
    el.findbar.classList.remove('hidden');
    el.findInput.value = '';
    el.findCount.textContent = '';
    setTimeout(function () { el.findInput.focus(); }, 30);
    updateChromeHeight();
  }
  function closeFind() {
    S.findOpen = false;
    el.findbar.classList.add('hidden');
    el.findCount.textContent = '';
    ZX('find-close', {});
    updateChromeHeight();
  }

  // ---------------------------------------------------------------- prompts + toasts
  function toast(kind, text) {
    var t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    t.innerHTML = '<span class="t-ico">' + (kind === 'error' ? I.warn : kind === 'ok' ? I.check : I.shield) + '</span><span>' + esc(text) + '</span>';
    document.getElementById('toasts').appendChild(t);
    updateChromeHeight();
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
      updateChromeHeight();
    }, 3800);
  }

  function showPwPrompt(p) {
    el.pwOrigin.textContent = p.origin + ' — ' + p.username;
    el.pwPrompt.dataset.tab = p.tab;
    el.pwPrompt.classList.remove('hidden');
    updateChromeHeight();
    clearTimeout(el.pwPrompt._t);
    el.pwPrompt._t = setTimeout(hidePwPrompt, 30000);
  }
  function hidePwPrompt() {
    var tab = parseInt(el.pwPrompt.dataset.tab || '0', 10);
    if (tab) ZX('pw-save-dismiss', { tab: tab });
    el.pwPrompt.classList.add('hidden');
    el.pwPrompt.dataset.tab = '0';
    updateChromeHeight();
  }
  function showPermPrompt(p) {
    var names = { geolocation: 'location access', notifications: 'notifications', camera: 'camera / microphone', microphone: 'microphone' };
    el.permTitle.textContent = 'Allow ' + (names[p.kind] || p.kind) + '?';
    el.permOrigin.textContent = p.origin;
    el.permPrompt.dataset.req = p.reqId;
    el.permPrompt.classList.remove('hidden');
    updateChromeHeight();
    clearTimeout(el.permPrompt._t);
    el.permPrompt._t = setTimeout(hidePermPrompt, 45000);
  }
  function hidePermPrompt() {
    var req = parseInt(el.permPrompt.dataset.req || '0', 10);
    if (req) ZX('perm-answer', { reqId: req, allow: false });
    el.permPrompt.classList.add('hidden');
    el.permPrompt.dataset.req = '0';
    updateChromeHeight();
  }

  // ---------------------------------------------------------------- theme
  function applyTheme() {
    var chrome = document.getElementById('chrome');
    var theme = S.prefs.theme || 'system';
    var resolved = theme;
    if (theme === 'system') {
      resolved = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    chrome.setAttribute('data-theme', resolved);
    chrome.setAttribute('data-density', S.prefs.density || 'normal');
    var accent = S.prefs.accent || '#5b7cfa';
    chrome.style.setProperty('--accent', accent);
    // derive soft variant
    chrome.style.setProperty('--accent-soft', hexToRgba(accent, 0.16));
  }
  function hexToRgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 6) {
      var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }
    return 'rgba(91,124,250,' + a + ')';
  }

  // ---------------------------------------------------------------- gestures (chrome area)
  var gTrack = false, gMoved = false, gSx = 0, gSy = 0;
  function gestureInit() {
    document.addEventListener('mousedown', function (e) {
      if (e.button !== 2) return;
      gTrack = true; gMoved = false; gSx = e.clientX; gSy = e.clientY;
    }, true);
    document.addEventListener('mousemove', function (e) {
      if (!gTrack) return;
      if (!gMoved && Math.abs(e.clientX - gSx) + Math.abs(e.clientY - gSy) > 9) gMoved = true;
    }, true);
    document.addEventListener('contextmenu', function (e) {
      if (gMoved) e.preventDefault();
      var tab = e.target.closest && e.target.closest('.tab');
      if (tab) {
        e.preventDefault();
        openTabMenu(parseInt(tab.dataset.id, 10), e.clientX);
      } else if (e.target.closest && (e.target.closest('#toolbar') || e.target.closest('#tabstrip'))) {
        e.preventDefault();
      }
    }, true);
    document.addEventListener('mouseup', function (e) {
      if (e.button !== 2 || !gTrack) return;
      gTrack = false;
      var wasMoved = gMoved; gMoved = false;
      if (!wasMoved) return;
      var dx = e.clientX - gSx, dy = e.clientY - gSy;
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (ax < 24 && ay < 24) return;
      if (ax > ay * 1.6) { if (dx < 0) ZX('nav-back', {}); else ZX('nav-forward', {}); }
      else if (ay > ax * 1.6) { if (dy < 0) ZX('nav-reload', {}); else ZX('tab-new', {}); }
    }, true);
  }

  // ---------------------------------------------------------------- keyboard
  function shortcuts(e) {
    var mod = e.ctrlKey || e.metaKey;
    var k = e.key.toLowerCase();
    if (e.key === 'F11') { ZX('fullscreen', {}); e.preventDefault(); return; }
    if (e.key === 'F12') { ZX('devtools', {}); e.preventDefault(); return; }
    if (e.key === 'F5') { ZX('nav-reload', {}); e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (S.findOpen) { closeFind(); return; }
      if (!el.suggest.classList.contains('hidden')) { closeSuggest(); return; }
      if (!el.menu.classList.contains('hidden')) { closeMenu(); return; }
      return;
    }
    if (e.altKey && e.key === 'ArrowLeft') { ZX('nav-back', {}); e.preventDefault(); return; }
    if (e.altKey && e.key === 'ArrowRight') { ZX('nav-forward', {}); e.preventDefault(); return; }
    if (!mod) return;
    if (e.shiftKey) {
      if (k === 't') { ZX('tab-restore-closed', {}); e.preventDefault(); }
      else if (k === 'o') { ZX('nav', { url: 'zephyr://bookmarks' }); e.preventDefault(); }
      else if (k === 'i') { ZX('devtools', {}); e.preventDefault(); }
      return;
    }
    switch (k) {
      case 't': ZX('tab-new', {}); e.preventDefault(); break;
      case 'w': ZX('tab-close', { id: activeTabId() }); e.preventDefault(); break;
      case 'n': ZX('win-new', {}); e.preventDefault(); break;
      case 'l': el.url.focus(); el.url.select(); e.preventDefault(); break;
      case 'd': ZX('bm-add', {}); e.preventDefault(); break;
      case 'f': openFind(); e.preventDefault(); break;
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

  // ---------------------------------------------------------------- events from Rust
  function bindEvents() {
    // surface any JS error to the Rust core log for diagnostics
    window.onerror = function (msg, src, line, col) {
      try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: 'chrome-error', tab: null, data: { msg: String(msg), src: String(src), line: line, col: col } })); } catch (e) {}
    };
    window.addEventListener('unhandledrejection', function (e) {
      try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: 'chrome-error', tab: null, data: { msg: 'rejection: ' + String(e.reason) } })); } catch (er) {}
    });
    window.__zx.on('state', function (p) {
      try {
        S.tabs = p.tabs || [];
      S.active = p.active || 0;
      S.activeUrl = p.activeUrl || '';
      S.activeTitle = p.activeTitle || '';
      S.activeBlocked = p.activeBlocked || 0;
      S.prefs = p.prefs || {};
      S.sessionStats = p.sessionStats || S.sessionStats;
      S.downloadsActive = !!p.downloadsActive;
      S.serverBase = p.serverBase || S.serverBase;
        S.ntpUrl = p.ntpUrl || S.ntpUrl;
        applyTheme();
        renderAll();
      } catch (e) {
        try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: 'chrome-error', tab: null, data: { msg: 'state handler: ' + (e && e.stack || e) } })); } catch (er) {}
      }
    });
    window.__zx.on('suggest', function (p) {
      if (document.activeElement === el.url && (p.q || '') === el.url.value.trim().toLowerCase()) {
        renderSuggest(p.items || []);
      }
    });
    window.__zx.on('find-result', function (p) {
      el.findCount.textContent = p.count > 0 ? (p.active || 0) + ' / ' + p.count : (p.count === 0 ? 'no matches' : '');
    });
    window.__zx.on('bm-changed', function () { ZX('bm-list', { q: '' }); });
    window.__zx.on('bm-data', function (p) {
      S.bookmarks = (p.items || []).map(function (b) { return { url: b.url, title: b.title }; });
      renderBookmarksBar();
    });
    window.__zx.on('pw-prompt', showPwPrompt);
    window.__zx.on('pw-saved', function (p) { toast('ok', 'Password saved for ' + p.origin); });
    window.__zx.on('perm-prompt', showPermPrompt);
    window.__zx.on('download-done', function (p) {
      toast(p.ok ? 'ok' : 'error', p.ok ? 'Download complete' : 'Download failed');
    });
    window.__zx.on('dl-progress', function () { el.dlBtn.classList.add('active'); });
    window.__zx.on('page-saved', function (p) { toast('ok', 'Page saved: ' + p.path); });
    window.__zx.on('lists-updated', function (p) {
      toast(p.ok ? 'ok' : 'error', p.ok ? 'Filter lists updated — ' + p.detail : 'List update failed: ' + p.detail);
    });
    window.__zx.on('data-cleared', function (p) { toast('ok', 'Browsing data cleared' + (p.cookies ? ' (cookies + cache)' : '')); });
    window.__zx.on('toast', function (p) { toast(p.kind, p.text); });
    window.__zx.on('close-menus', function () {
      closeMenu(); closeTabMenu(); closeSuggest();
      hidePermPrompt(); hidePwPrompt();
    });
    window.__zx.on('prefs-data', function (p) {
      S.prefs = p;
      applyTheme();
      renderAll();
    });
    window.__zx.on('prefs-changed', function (p) {
      if (p.key) { S.prefs[p.key] = p.value; applyTheme(); renderAll(); }
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
    el.menuBtn.addEventListener('click', function () {
      if (el.menu.classList.contains('hidden')) openMenu(); else closeMenu();
    });
    el.chip.addEventListener('click', function () { ZX('nav', { url: 'zephyr://privacy' }); });
    el.bmStar.addEventListener('click', function () {
      var at = S.tabs[S.active];
      ZX('bm-toggle', at ? { url: at.url, title: at.title } : {});
    });

    // tabs (event delegation)
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
      if (e.button === 1) { // middle click closes
        var tab = e.target.closest && e.target.closest('.tab');
        if (tab) { e.preventDefault(); ZX('tab-close', { id: parseInt(tab.dataset.id, 10) }); }
      }
    });

    // omnibox
    el.url.addEventListener('focus', function () { el.url.select(); });
    el.url.addEventListener('input', function () {
      clearTimeout(sugTimer);
      var q = el.url.value.trim();
      if (!q) { closeSuggest(); return; }
      sugTimer = setTimeout(function () { ZX('addr-query', { q: q }); }, 70);
    });
    el.url.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        if (sugSel >= 0 && sugItems[sugSel]) { sugGo(sugSel); }
        else { ZX('nav', { url: el.url.value }); closeSuggest(); }
        el.url.blur();
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (sugItems.length) { sugSel = Math.min(sugSel + 1, sugItems.length - 1); paintSugSel(); e.preventDefault(); }
      } else if (e.key === 'ArrowUp') {
        if (sugItems.length) { sugSel = Math.max(sugSel - 1, 0); paintSugSel(); e.preventDefault(); }
      } else if (e.key === 'Escape') {
        closeSuggest();
        el.url.value = displayUrl();
        el.url.blur();
      }
    });
    function paintSugSel() {
      var nodes = el.suggest.querySelectorAll('.sug-item');
      for (var i = 0; i < nodes.length; i++) nodes[i].classList.toggle('sel', i === sugSel);
    }
    el.suggest.addEventListener('mousedown', function (e) {
      var it = e.target.closest && e.target.closest('.sug-item');
      if (it) { sugGo(parseInt(it.dataset.idx, 10)); e.preventDefault(); }
    });

    // find bar
    el.findInput.addEventListener('input', function () {
      ZX('find-query', { q: el.findInput.value });
    });
    el.findInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { ZX(e.shiftKey ? 'find-prev' : 'find-next', {}); e.preventDefault(); }
      else if (e.key === 'Escape') { closeFind(); e.preventDefault(); }
    });
    el.findNext.addEventListener('click', function () { ZX('find-next', {}); });
    el.findPrev.addEventListener('click', function () { ZX('find-prev', {}); });
    el.findClose.addEventListener('click', closeFind);

    // prompts
    el.pwSave.addEventListener('click', function () {
      var tab = parseInt(el.pwPrompt.dataset.tab || '0', 10);
      ZX('pw-save-confirm', { tab: tab });
      el.pwPrompt.classList.add('hidden');
      el.pwPrompt.dataset.tab = '0';
      updateChromeHeight();
    });
    el.pwDismiss.addEventListener('click', hidePwPrompt);
    el.permAllow.addEventListener('click', function () {
      var req = parseInt(el.permPrompt.dataset.req || '0', 10);
      ZX('perm-answer', { reqId: req, allow: true });
      el.permPrompt.classList.add('hidden');
      el.permPrompt.dataset.req = '0';
      updateChromeHeight();
    });
    el.permBlock.addEventListener('click', hidePermPrompt);

    // menus (delegation)
    [el.menu, el.tabmenu].forEach(function (m) {
      m.addEventListener('click', function (e) {
        var item = e.target.closest && e.target.closest('.menu-item');
        if (!item) return;
        runMenuCmd(item.dataset.cmd, item.dataset.arg);
        closeMenu(); closeTabMenu();
      });
    });

    // bookmarks bar
    el.bmBar.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.bm-item');
      if (b && b.dataset.url) ZX('nav', { url: b.dataset.url });
    });
    el.bmBar.addEventListener('contextmenu', function (e) {
      var b = e.target.closest && e.target.closest('.bm-item');
      if (b) { e.preventDefault(); ZX('bm-remove', { url: b.dataset.url }); }
    });

    // keyboard shortcuts
    document.addEventListener('keydown', shortcuts);

    // system theme changes
    if (window.matchMedia) {
      try {
        window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
          if ((S.prefs.theme || 'system') === 'system') applyTheme();
        });
      } catch (e) {}
    }
  }

  // ---------------------------------------------------------------- init
  function init() {
    el = {
      tabs: $('tabs'), newtab: $('newtab'), back: $('nav-back'), fwd: $('nav-fwd'),
      reload: $('nav-reload'), home: $('nav-home'), sec: $('sec-icon'), url: $('url-input'),
      chip: $('blocked-chip'), bmStar: $('bm-star'), dlBtn: $('dl-btn'), menuBtn: $('menu-btn'),
      bmBar: $('bookmarksbar'), suggest: $('suggest'), menu: $('menu'), tabmenu: $('tabmenu'),
      findbar: $('findbar'), findInput: $('find-input'), findCount: $('find-count'),
      findNext: $('find-next'), findPrev: $('find-prev'), findClose: $('find-close'),
      pwPrompt: $('pw-prompt'), pwOrigin: $('pw-origin'), pwSave: $('pw-save'), pwDismiss: $('pw-dismiss'),
      permPrompt: $('perm-prompt'), permTitle: $('perm-title'), permOrigin: $('perm-origin'),
      permAllow: $('perm-allow'), permBlock: $('perm-block')
    };
    el.newtab.innerHTML = I.plus;
    el.back.innerHTML = I.back;
    el.fwd.innerHTML = I.fwd;
    el.reload.innerHTML = I.reload;
    el.home.innerHTML = I.home;
    el.bmStar.innerHTML = I.star;
    el.dlBtn.innerHTML = I.dl + '<span class="dot"></span>';
    el.menuBtn.innerHTML = I.menu;
    el.findNext.innerHTML = I.down;
    el.findPrev.innerHTML = I.up;
    el.findClose.innerHTML = I.close;
    $('pw-prompt').querySelector('.prompt-icon').innerHTML = I.key;
    $('perm-prompt').querySelector('.prompt-icon').innerHTML = I.eye;

    bindEvents();
    bindDom();
    gestureInit();

    ZX('hello', { ua: navigator.userAgent });
    ZX('bm-list', { q: '' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
