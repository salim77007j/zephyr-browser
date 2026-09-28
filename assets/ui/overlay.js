// Zephyr overlay controller — renders menus, suggestions, panels, prompts, toasts.
// Lives in its own transparent full-window webview; backdrop clicks close popups.
/* global document, window */
(function () {
  'use strict';
  function ZX(cmd, data) {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: cmd, tab: null, data: data || {} })); }
    catch (e) {}
  }
  var listeners = {};
  window.__zx = {
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, payload) {
      var a = listeners[ev];
      if (a) { for (var i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) {} } }
    }
  };

  var I = {
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    newtab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v8M8 12h8"/></svg>',
    newwin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="13" height="13" rx="2.5"/><path d="M9 21h10a2 2 0 0 0 2-2V9"/></svg>',
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/></svg>',
    dl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 7.8-8 9-4.6-1.2-8-4.5-8-9V6l8-3z"/></svg>',
    print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 9V3h12v6"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/></svg>',
    find: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    code: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/></svg>',
    zoomin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6M11 8v6"/></svg>',
    zoomout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
    expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3 3.7-3.7z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/><path d="M14 2v6h6"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.8L4 7l2-2 3.8 5M15 10.8L20 7l-2-2-3.8 5"/><path d="M12 3a4 4 0 0 0-4 4c0 2 1.5 3.6 2 4l2 4 2-4c.5-.4 2-2 2-4a4 4 0 0 0-4-4z"/></svg>',
    mute: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
    sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M5 6l1 15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-15"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3l1.5 1.5-2 2L21 8l-2.5 2.5-1.5-1.5-5 5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-2.4 3.2M6.6 6.6C4 8.3 2 12 2 12s3.5 7 10 7c1.4 0 2.7-.3 3.9-.8"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.4L12 17.6l-5.8 3-1.1-6.4L.4 9.6l6.5-.9z" transform="translate(1.6 0.6) scale(0.86)"/></svg>',
    cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/><path d="M12 12l9-5M12 12v10M12 12L3 7"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>'
  };

  var currentModal = null; // name of open modal kind
  var lastRect = null;
  var pwcTab = 0, permReq = 0;
  var lastSuggest = [];

  // signal boot to the Rust core (smoke suite readiness check)
  try { ZX('overlay-alive', {}); } catch (e) {}

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ------------------------------------------------------------ positioning
  function place(node, x, y, w) {
    var maxX = window.innerWidth - node.offsetWidth - 8;
    var maxY = window.innerHeight - node.offsetHeight - 8;
    if (x > maxX) x = Math.max(8, maxX);
    if (y > maxY) y = Math.max(8, maxY);
    node.style.left = Math.max(8, x) + 'px';
    node.style.top = Math.max(8, y) + 'px';
    if (w) node.style.minWidth = w + 'px';
  }

  function showBackdrop(on) {
    document.getElementById('backdrop').classList.toggle('hidden', !on);
  }

  function openPopup(kind, x, y, w, payload) {
    currentModal = kind;
    lastRect = { x: x, y: y, w: w };
    payload = payload || {};
    if (kind === 'pw') pwcTab = payload.tab || 0;
    if (kind === 'perm') permReq = payload.reqId || 0;
    if (kind === 'suggest') lastSuggest = payload.items || [];
    document.body.dataset.modal = kind;
    var host = document.getElementById('popups');
    host.innerHTML = build(kind, payload);
    var node = host.firstElementChild;
    showBackdrop(kind !== 'find');
    if (node) place(node, x || 60, y || 50, w);
  }

  function closeAll() {
    currentModal = null;
    delete document.body.dataset.modal;
    document.getElementById('popups').innerHTML = '';
    showBackdrop(false);
  }

  function hideSelf() {
    closeAll();
    ZX('overlay-hide', {});
  }

  // ------------------------------------------------------------ builders
  function menuItem(it) {
    if (it.sep) return '<div class="menu-sep"></div>';
    return '<div class="menu-item' + (it.checked ? ' checked' : '') + '" data-cmd="' + esc(it.cmd) + '" data-arg="' + esc(it.arg || '') + '">' +
      '<span class="ico">' + (it.ico || '') + '</span><span>' + esc(it.label) + '</span>' +
      (it.kbd ? '<span class="kbd">' + esc(it.kbd) + '</span>' : '') + '</div>';
  }

  function build(kind, p) {
    switch (kind) {
      case 'suggest': {
        var html = '<div class="popup suggest">';
        var items = p.items || [];
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var ico = it.kind === 'search' ? I.search : it.kind === 'bookmark' ? I.star : it.kind === 'history' ? I.history : I.globe;
          html += '<div class="sug-item' + (i === p.sel ? ' sel' : '') + '" data-idx="' + i + '">' +
            '<span class="kind">' + ico + '</span>' +
            '<span class="txt">' + esc(it.title || it.url) + '</span>' +
            '<span class="url">' + esc(it.host || '') + '</span></div>';
        }
        return html + '</div>';
      }
      case 'menu': {
        var it = p.payload || {};
        var zoomPct = Math.round((it.zoom || 1) * 100);
        var html = '<div class="popup menu">';
        // profile header (like Chrome's signed-out row)
        html += '<div class="menu-header"><span class="avatar">Z</span>' +
          '<span class="who"><span class="n">' + esc(it.profile || 'Me') + '</span>' +
          '<span class="e">Not signed in</span></span>' +
          '<span class="chev">›</span></div>';
        html += '<div class="menu-sep"></div>';
        var items = [
          { cmd: 'tab-new', ico: I.newtab, label: 'New tab', kbd: 'Ctrl+T' },
          { cmd: 'win-new', ico: I.newwin, label: 'New window', kbd: 'Ctrl+N' },
          { sep: true },
          { cmd: 'open-history', ico: I.history, label: 'History', kbd: 'Ctrl+H' },
          { cmd: 'open-downloads', ico: I.dl, label: 'Downloads', kbd: 'Ctrl+J' },
          { cmd: 'open-bookmarks', ico: I.bookmark, label: 'Bookmarks', kbd: 'Ctrl+Shift+O' },
          { cmd: 'open-passwords', ico: I.star, label: 'Passwords and autofill' },
          { sep: true },
          { cmd: 'open-privacy', ico: I.shield, label: 'Privacy dashboard' },
          { cmd: 'open-cleardata', ico: I.trash, label: 'Delete browsing data…', kbd: 'Ctrl+Shift+Del' },
          { sep: true },
          { cmd: 'save-page', ico: I.save, label: 'Save page as…', kbd: 'Ctrl+S' },
          { cmd: 'print-page', ico: I.print, label: 'Print…', kbd: 'Ctrl+P' },
          { cmd: 'find-open', ico: I.find, label: 'Find in page', kbd: 'Ctrl+F' },
          { cmd: 'zoom-row', zoom: zoomPct },
          { cmd: 'fullscreen', ico: I.expand, label: 'Full screen', kbd: 'F11' },
          { sep: true },
          { cmd: 'view-source', ico: I.code, label: 'View page source', kbd: 'Ctrl+U' },
          { cmd: 'devtools', ico: I.wrench, label: 'Developer tools', kbd: 'F12' },
          { sep: true },
          { cmd: 'open-settings', ico: I.settings, label: 'Settings' },
          { cmd: 'open-about', ico: I.doc, label: 'About Zephyr' }
        ];
        for (var i = 0; i < items.length; i++) {
          var m = items[i];
          if (m.sep) { html += '<div class="menu-sep"></div>'; continue; }
          if (m.cmd === 'zoom-row') {
            html += '<div class="zoom-row"><span class="ico">' + I.zoomin + '</span><span class="zl">Zoom</span>' +
              '<span class="zoom-step"><button class="zb" data-cmd="zoom-dec" title="Zoom out">−</button>' +
              '<span class="zv">' + m.zoom + '%</span>' +
              '<button class="zb" data-cmd="zoom-inc" title="Zoom in">+</button></span></div>';
            continue;
          }
          html += menuItem(m);
        }
        return html + '</div>';
      }
      case 'cleardata': {
        var rows = [
          { k: 'history', label: 'Browsing history' },
          { k: 'cookies', label: 'Cookies and site data' },
          { k: 'downloads', label: 'Download history' },
          { k: 'permissions', label: 'Site permissions' },
        ];
        var html = '<div class="popup cleardata">' +
          '<div class="cd-t">Delete browsing data</div>' +
          '<div class="cd-s">Clears data stored on this device. Synced data and passwords are not affected.</div>';
        for (var i = 0; i < rows.length; i++) {
          html += '<div class="cd-row' + (i < 2 ? ' on' : '') + '" data-cd="' + rows[i].k + '"><span>' + esc(rows[i].label) + '</span>' +
            '<span class="cd-sw"></span></div>';
        }
        html += '<div class="cd-actions"><button class="cd-cancel" data-act="dismiss">Cancel</button>' +
          '<button class="cd-ok" data-cdok="1">Delete data</button></div>';
        return html + '</div>';
      }
      case 'tabmenu': {
        var t = p.tab || {};
        var items = [
          { cmd: 'tab-new', ico: I.newtab, label: 'New tab to the right' },
          { cmd: 'tab-duplicate', arg: String(t.id), ico: I.doc, label: 'Duplicate' },
          { sep: true },
          { cmd: 'tab-pin', arg: JSON.stringify({ id: t.id, pinned: !t.pinned }), ico: I.pin, label: t.pinned ? 'Unpin tab' : 'Pin tab' },
          { cmd: 'tab-mute', arg: JSON.stringify({ id: t.id, muted: !t.muted }), ico: t.muted ? I.sound : I.mute, label: t.muted ? 'Unmute site' : 'Mute site' },
          { cmd: 'tab-suspend', arg: String(t.id), ico: I.refresh, label: 'Suspend tab (free memory)' },
          { sep: true },
          { cmd: 'bm-add', arg: JSON.stringify({ url: t.url, title: t.title }), ico: I.star, label: 'Bookmark tab' },
          { cmd: 'tab-restore-closed', ico: I.refresh, label: 'Reopen closed tab', kbd: 'Ctrl+Shift+T' },
          { cmd: 'tab-close-others', arg: String(t.id), ico: I.trash, label: 'Close other tabs' },
          { sep: true },
          { cmd: 'tab-close', arg: String(t.id), ico: I.close, label: 'Close tab', kbd: 'Ctrl+W' }
        ];
        return '<div class="popup">' + items.map(menuItem).join('') + '</div>';
      }
      case 'bmfolder': {
        var items = (p.items || []).map(function (b) {
          return { cmd: 'nav', arg: b.url, ico: I.bookmark, label: b.title || b.url };
        });
        items.push({ sep: true });
        items.push({ cmd: 'open-bookmarks', ico: I.folder || I.bookmark, label: 'Bookmark manager' });
        var body = items.length > 2 ? items.map(menuItem).join('') : '<div class="menu-label">No other bookmarks</div>' + items.slice(-2).map(menuItem).join('');
        return '<div class="popup">' + body + '</div>';
      }
      case 'ext': {
        var html = '<div class="popup ext"><div class="ext-head">Protection layers</div>' +
          '<div class="ext-sub">Zephyr’s built-in protections. Toggle any layer — changes apply to new page loads instantly.</div>';
        var icons = { shield: I.shield, code: I.code, eye: I.eye, link: I.link, grid: I.grid, audio: I.audio, box: I.box, cpu: I.cpu, alert: I.alert, 'eye-off': I.eyeoff };
        var prefs = p.prefs || {};
        for (var i = 0; i < (p.layers || []).length; i++) {
          var l = p.layers[i];
          var on = prefs[l.key] !== false;
          html += '<div class="menu-item" data-layer="' + esc(l.key) + '">' +
            '<span class="ico">' + (icons[l.icon] || I.shield) + '</span>' +
            '<span style="flex:1;min-width:0">' + esc(l.label) + (l.sub ? '<div style="color:var(--text2);font-size:11px;margin-top:1px">' + esc(l.sub) + '</div>' : '') + '</span>' +
            '<span class="switch' + (on ? ' on' : '') + '" data-key="' + esc(l.key) + '"></span></div>';
        }
        html += '<div class="menu-sep"></div><div class="menu-item" data-cmd="open-privacy"><span class="ico">' + I.shield + '</span><span>Privacy dashboard</span></div>' +
          '<div class="menu-item" data-cmd="open-settings"><span class="ico">' + I.settings + '</span><span>More settings</span></div></div>';
        return html;
      }
      case 'profile': {
        var items = [
          { cmd: 'open-passwords', ico: I.key, label: 'Passwords' },
          { cmd: 'open-downloads', ico: I.dl, label: 'Downloads' },
          { cmd: 'open-history', ico: I.history, label: 'History' },
          { sep: true },
          { cmd: 'open-settings', ico: I.settings, label: 'Settings' }
        ];
        return '<div class="popup">' +
          '<div class="menu-header"><span class="avatar">' + esc(p.letter || 'Z') + '</span>' +
          '<span class="who"><span class="n">' + esc(p.name || 'Me') + '</span><span class="e">' + esc(p.engine || '') + '</span></span></div>' +
          '<div class="menu-sep"></div>' + items.map(menuItem).join('') + '</div>';
      }
      case 'siteinfo': {
        var internal = (p.url || '').indexOf('zephyr://') === 0 || (p.url || '').indexOf('http://127.0.0.1') === 0;
        var https = (p.url || '').indexOf('https://') === 0;
        var ico = internal || https ? I.lock : I.warn;
        var cls = internal || https ? '' : 'warn';
        var title = p.label || (https ? 'Connection is secure' : 'Site information');
        var chips = '';
        if (p.blocked > 0) {
          chips += '<span class="si-chip red">' + I.shield + p.blocked + ' blocked here</span>';
        } else {
          chips += '<span class="si-chip">' + I.shield + 'No trackers seen</span>';
        }
        return '<div class="popup siteinfo">' +
          '<div class="si-row"><span class="si-ico ' + cls + '">' + ico + '</span>' +
          '<span class="si-main"><span class="si-t">' + esc(title) + '</span>' +
          '<span class="si-s">' + esc(p.origin || p.url || '') + '</span></span></div>' +
          '<div class="si-stats">' + chips + '</div>' +
          '<div class="menu-item" data-cmd="open-settings-perms"><span class="ico">' + I.settings + '</span><span>Site settings</span></div>' +
          '<div class="menu-item" data-cmd="open-privacy"><span class="ico">' + I.shield + '</span><span>Privacy dashboard</span></div></div>';
      }
      case 'bmedit': {
        var items = [
          { cmd: 'nav', arg: p.url, ico: I.globe, label: 'Open' },
          { cmd: 'bm-remove', arg: p.url, ico: I.trash, label: 'Remove bookmark' }
        ];
        return '<div class="popup">' + items.map(menuItem).join('') + '</div>';
      }
      case 'pw': {
        return '<div class="popup prompt">' +
          '<span class="p-ico">' + I.key + '</span>' +
          '<span class="p-body"><span class="p-t">Save password?</span>' +
          '<span class="p-s">' + esc(p.origin) + ' — ' + esc(p.username) + '</span></span>' +
          '<span class="p-btns"><button class="btn primary" data-act="pw-save">Save</button>' +
          '<button class="btn" data-act="pw-dismiss">Not now</button></span></div>';
      }
      case 'perm': {
        return '<div class="popup prompt">' +
          '<span class="p-ico">' + I.eye + '</span>' +
          '<span class="p-body"><span class="p-t">' + esc(p.title || 'Permission request') + '</span>' +
          '<span class="p-s">' + esc(p.origin) + '</span></span>' +
          '<span class="p-btns"><button class="btn primary" data-act="perm-allow">Allow</button>' +
          '<button class="btn" data-act="perm-block">Block</button></span></div>';
      }
      default:
        return '';
    }
  }

  // ------------------------------------------------------------ events
  document.getElementById('backdrop').addEventListener('mousedown', function () {
    hideSelf();
  });

  document.getElementById('popups').addEventListener('mousedown', function (e) {
    // switches (extension panel)
    var sw = e.target.closest && e.target.closest('.switch[data-key]');
    if (sw) {
      e.stopPropagation();
      sw.classList.toggle('on');
      ZX('prefs-set', { key: sw.dataset.key, value: sw.classList.contains('on') ? '1' : '0' });
      return;
    }
    var act = e.target.closest && e.target.closest('[data-act]');
    if (act) {
      e.stopPropagation();
      var a = act.dataset.act;
      if (a === 'pw-save') { ZX('pw-save-confirm', { tab: pwcTab }); }
      if (a === 'pw-dismiss') { ZX('pw-save-dismiss', { tab: pwcTab }); }
      if (a === 'perm-allow') { ZX('perm-answer', { reqId: permReq, allow: true }); }
      if (a === 'perm-block') { ZX('perm-answer', { reqId: permReq, allow: false }); }
      hideSelf();
      return;
    }
    var sug = e.target.closest && e.target.closest('.sug-item');
    if (sug) {
      e.stopPropagation();
      var idx = parseInt(sug.dataset.idx, 10);
      if (lastSuggest[idx] && lastSuggest[idx].url) ZX('nav', { url: lastSuggest[idx].url });
      hideSelf();
      return;
    }
    var zbtn = e.target.closest && e.target.closest('.zb');
    if (zbtn) {
      e.stopPropagation();
      runCmd(zbtn.dataset.cmd, '');
      return; // keep the menu open so the user sees the zoom value change
    }
    var cda = e.target.closest && e.target.closest('[data-cd]');
    if (cda) {
      e.stopPropagation();
      cda.classList.toggle('on');
      return;
    }
    var cdok = e.target.closest && e.target.closest('[data-cdok]');
    if (cdok) {
      e.stopPropagation();
      var box = document.querySelector('.cleardata');
      if (box) {
        var flags = {};
        box.querySelectorAll('[data-cd]').forEach(function (sw) {
          flags[sw.dataset.cd] = sw.classList.contains('on');
        });
        ZX('clear-data', flags);
      }
      hideSelf();
      return;
    }
    var item = e.target.closest && e.target.closest('.menu-item');
    if (item) {
      e.stopPropagation();
      var cmd = item.dataset.cmd, arg = item.dataset.arg || '';
      if (cmd === 'open-cleardata') {
        // swap this menu for the delete-data dialog in place (keep popup open)
        openPopup('cleardata', (lastRect && lastRect.x) || 60, (lastRect && lastRect.y) || 50, 400, {});
        return;
      }
      if (cmd) runCmd(cmd, arg);
      hideSelf();
    }
  });

  function runCmd(cmd, arg) {
    switch (cmd) {
      case 'open-settings': ZX('nav', { url: 'zephyr://settings' }); return;
      case 'open-settings-perms': ZX('nav', { url: 'zephyr://settings#permissions' }); return;
      case 'open-bookmarks': ZX('nav', { url: 'zephyr://bookmarks' }); return;
      case 'open-history': ZX('nav', { url: 'zephyr://history' }); return;
      case 'open-downloads': ZX('nav', { url: 'zephyr://downloads' }); return;
      case 'open-privacy': ZX('nav', { url: 'zephyr://privacy' }); return;
      case 'open-passwords': ZX('nav', { url: 'zephyr://settings#passwords' }); return;
      case 'open-about': ZX('nav', { url: 'zephyr://settings#about' }); return;
      case 'tab-duplicate': ZX(cmd, { id: parseInt(arg, 10) }); return;
      case 'tab-pin': case 'tab-mute':
        try { ZX(cmd, JSON.parse(arg)); } catch (e) {}
        return;
      case 'bm-add':
        try { ZX(cmd, JSON.parse(arg)); } catch (e) {}
        return;
      case 'bm-remove': ZX(cmd, { url: arg }); return;
      case 'nav': ZX('nav', { url: arg }); return;
      case 'tab-suspend': case 'tab-close': case 'tab-close-others':
        ZX(cmd, { id: parseInt(arg, 10) });
        return;
      default:
        ZX(cmd, {});
    }
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { hideSelf(); }
  });

  // ------------------------------------------------------------ toast stacking
  var toastCount = 0;
  function addToast(p) {
    var host = document.getElementById('toasts');
    var t = document.createElement('div');
    t.className = 'toast ' + (p.kind || '');
    var ico = p.kind === 'error' ? I.warn : p.kind === 'ok' ? I.check : I.shield;
    t.innerHTML = '<span class="t-ico">' + ico + '</span><span>' + esc(p.text) + '</span>';
    host.appendChild(t);
    toastCount++;
    ZX('overlay-need', { on: true });
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
      toastCount--;
      if (toastCount <= 0 && !currentModal) ZX('overlay-need', { on: false });
    }, 3800);
  }

  // ------------------------------------------------------------ rust events
  window.__zx.on('popup-open', function (p) {
    if (p.theme) document.documentElement.setAttribute('data-theme', p.theme);
    if (p.kind === 'toast') { addToast(p.payload || {}); return; }
    openPopup(p.kind, p.x, p.y, p.w, p.payload);
  });
  window.__zx.on('popup-hide', hideSelf);
})();
