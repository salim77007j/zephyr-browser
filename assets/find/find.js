// Zephyr find-in-page bar controller (own webview).
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

  var input, count;
  var prevIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>';
  var nextIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
  var closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';

  function init() {
    input = document.getElementById('find-input');
    count = document.getElementById('find-count');
    document.getElementById('find-prev').innerHTML = prevIcon;
    document.getElementById('find-next').innerHTML = nextIcon;
    document.getElementById('find-close').innerHTML = closeIcon;
    document.getElementById('find-next').addEventListener('click', function () { ZX('find-next', {}); });
    document.getElementById('find-prev').addEventListener('click', function () { ZX('find-prev', {}); });
    document.getElementById('find-close').addEventListener('click', function () { ZX('find-close', {}); });
    input.addEventListener('input', function () {
      ZX('find-query', { q: input.value });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { ZX(e.shiftKey ? 'find-prev' : 'find-next', {}); e.preventDefault(); }
      else if (e.key === 'Escape') { ZX('find-close', {}); }
    });
    window.__zx.on('find-result', function (p) {
      count.textContent = p.count > 0 ? (p.active || 0) + ' / ' + p.count : (p.count === 0 ? 'no matches' : '–');
    });
    window.__zx.on('theme', function (p) {
      document.documentElement.setAttribute('data-theme', p.theme || 'light');
    });
    setTimeout(function () { try { input.focus(); input.select(); } catch (e) {} }, 40);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
