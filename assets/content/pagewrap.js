// Zephyr page wrapper — title reporting, SPA navigation tracking,
// target=_blank interception, password form detection + autofill,
// save-page serialization.
(function () {
  function post(cmd, data) {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'content', cmd: cmd, tab: window.__ZX_TAB || 0, data: data || {} })); }
    catch (e) {}
  }

  // ---- any page click collapses open chrome menus
  document.addEventListener('mousedown', function () {
    post('chrome-collapse', {});
  }, true);

  // ---- title
  function reportTitle() { post('title', { title: document.title || '' }); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportTitle, true);
  } else reportTitle();
  try {
    var titleEl = document.querySelector('title');
    if (titleEl) {
      var tmo = new MutationObserver(reportTitle);
      tmo.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
  } catch (e) {}

  // ---- SPA navigation tracking
  try {
    var pushS = history.pushState;
    var repS = history.replaceState;
    function navReport() { post('nav-spa', { url: location.href }); }
    history.pushState = function () { var r = pushS.apply(this, arguments); navReport(); return r; };
    history.replaceState = function () { var r = repS.apply(this, arguments); navReport(); return r; };
    window.addEventListener('popstate', navReport, true);
    window.addEventListener('hashchange', navReport, true);
  } catch (e) {}

  // ---- target=_blank / rel=noopener links -> new tab (capture phase)
  document.addEventListener('click', function (e) {
    try {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var tgt = a.getAttribute('target');
      if (tgt === '_blank') {
        var href = a.href;
        if (href && href.indexOf('javascript:') !== 0) {
          e.preventDefault();
          e.stopPropagation();
          post('newtab', { url: href });
        }
      }
    } catch (err) {}
  }, true);

  // ---- password form detection
  document.addEventListener('submit', function (e) {
    try {
      var form = e.target;
      if (!form || form.nodeName !== 'FORM') return;
      var pw = form.querySelector('input[type="password"]');
      if (!pw || !pw.value) return;
      var user = form.querySelector('input[type="email"],input[type="text"],input[type="tel"],input:not([type])');
      var username = user && user.value ? user.value : '';
      if (!username) {
        // try common patterns
        var named = form.querySelector('input[name*=user i],input[name*=email i],input[name*=login i],input[id*=user i],input[id*=email i]');
        username = named && named.value ? named.value : '';
      }
      post('pw-detect', { origin: location.origin, user: username, pw: pw.value });
    } catch (err) {}
  }, true);

  // ---- autofill hook (Rust calls with credentials)
  window.__zxAutofill = function (user, pass) {
    try {
      var pws = document.querySelectorAll('input[type="password"]');
      for (var i = 0; i < pws.length; i++) {
        var pw = pws[i];
        var form = pw.closest ? pw.closest('form') : null;
        var scope = form || document;
        var userField = scope.querySelector('input[type="email"],input[type="text"],input:not([type])');
        if (userField && user && userField.value === '') {
          userField.value = user;
          userField.dispatchEvent(new Event('input', { bubbles: true }));
          userField.dispatchEvent(new Event('change', { bubbles: true }));
        }
        pw.value = pass;
        pw.dispatchEvent(new Event('input', { bubbles: true }));
        pw.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } catch (e) {}
  };

  // ---- save page hook
  window.__zxSavePage = function () {
    try {
      var html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
      post('page-html', { html: html });
    } catch (e) {}
  };

  // ---- zoom test hook (visual cue; native zoom is driven by Rust)
  window.__zxTestZoom = function () {};

  // ---- keyboard shortcuts forwarded to Rust (find/print/bookmark/zoom)
  document.addEventListener('keydown', function (e) {
    try {
      if (!(e.ctrlKey || e.metaKey)) return;
      var k = e.key.toLowerCase();
      if (k === 'f') { post('find-open', {}); e.preventDefault(); }
      else if (k === 'p') { post('print-page', {}); e.preventDefault(); }
      else if (k === 'd') { post('bm-add', {}); e.preventDefault(); }
      else if (k === 'g') { post('view-source', {}); e.preventDefault(); }
      else if (k === 's') { post('save-page', {}); e.preventDefault(); }
      else if (k === '=' || k === '+') { post('zoom-inc', {}); e.preventDefault(); }
      else if (k === '-') { post('zoom-dec', {}); e.preventDefault(); }
      else if (k === '0') { post('zoom-reset', {}); e.preventDefault(); }
    } catch (err) {}
  }, true);
})();
