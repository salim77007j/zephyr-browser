// Zephyr new tab page controller
/* global document, window */
(function () {
  'use strict';
  function ZX(cmd, data) {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: cmd, tab: window.__ZX_TAB || 0, data: data || {} })); }
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
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function clock() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    document.getElementById('clock').textContent =
      (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
    var hr = d.getHours();
    document.getElementById('greeting').textContent =
      hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  }
  clock();
  setInterval(clock, 15000);

  document.getElementById('search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('q').value.trim();
    if (q) ZX('nav', { url: q });
  });

  document.getElementById('shield-chip').addEventListener('click', function () {
    ZX('nav', { url: 'zephyr://privacy' });
  });

  function tileHtml(url, label, color, removable, id) {
    return '<div class="tile" data-url="' + esc(url) + '"' + (removable ? ' data-id="' + id + '"' : '') + '>' +
      '<span class="avatar" style="background:' + color + '">' + esc((label.replace(/^www\./, '')[0] || '?').toUpperCase()) + '</span>' +
      '<span class="label">' + esc(label) + '</span></div>';
  }

  window.__zx.on('ntp-data', function (p) {
    var top = document.getElementById('top');
    var html = '';
    (p.topSites || []).forEach(function (s) {
      html += tileHtml(s.url, s.title || s.host, s.color, false);
    });
    top.innerHTML = html || '<div class="tile add" data-empty="1"><span class="avatar">+</span><span class="label">Browse to build history</span></div>';

    var links = document.getElementById('links');
    var lh = '';
    (p.shortcuts || []).forEach(function (s) {
      lh += tileHtml(s.url, s.title || s.host, 'var(--accent)', true, s.id);
    });
    lh += '<div class="tile add" id="add-link"><span class="avatar">+</span><span class="label">Add link</span></div>';
    links.innerHTML = lh;

    var st = p.stats || {};
    var total = (st.ads || 0) + (st.trackers || 0) + (st.cosmetic || 0) + (st.params || 0);
    document.getElementById('shield-text').textContent =
      total > 0 ? total.toLocaleString() + ' trackers & ads blocked this session' : 'Privacy protection active';
  });

  document.addEventListener('click', function (e) {
    var tile = e.target.closest && e.target.closest('.tile');
    if (!tile) return;
    if (tile.id === 'add-link') {
      var url = window.prompt('Address for the quick link:');
      if (url && url.trim()) {
        var t = window.prompt('Name (optional):') || url;
        ZX('shortcut-add', { url: url.trim(), title: t.trim() });
        setTimeout(function () { ZX('ntp-data', {}); }, 300);
      }
      return;
    }
    if (tile.dataset.url) {
      if (e.button === 0) ZX('nav', { url: tile.dataset.url });
    }
  });
  document.addEventListener('contextmenu', function (e) {
    var tile = e.target.closest && e.target.closest('.tile[data-id]');
    if (tile) {
      e.preventDefault();
      ZX('shortcut-remove', { id: parseInt(tile.dataset.id, 10) });
      setTimeout(function () { ZX('ntp-data', {}); }, 300);
    }
  });

  // collapse chrome menus when clicking into the page
  document.addEventListener('mousedown', function () {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'content', cmd: 'chrome-collapse', tab: window.__ZX_TAB || 0, data: {} })); } catch (e) {}
  }, true);

  ZX('page-hello', { page: 'ntp' });
  ZX('ntp-data', {});
  setInterval(function () { ZX('ntp-data', {}); }, 30000);
})();
