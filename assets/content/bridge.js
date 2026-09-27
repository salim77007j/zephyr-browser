// Zephyr content bridge — safe IPC wrapper + event bus.
// Globals provided by the Rust bundle: __ZXD (filter data), __ZXP (prefs),
// __ZX_PERM (permission defaults), __ZX_ALLOW (per-site allowlists),
// __ZX_TAB, __ZX_MUTED, __ZX_ZOOM, __ZX_FIND_OPEN.
(function () {
  var TAB = window.__ZX_TAB || 0;
  function post(cmd, data) {
    try {
      window.ipc.postMessage(JSON.stringify({ ns: 'content', cmd: cmd, tab: TAB, data: data || {} }));
    } catch (e) { /* page may revoke ipc */ }
  }
  var listeners = {};
  window.__zx = {
    post: post,
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, payload) {
      var arr = listeners[ev];
      if (arr) { for (var i = 0; i < arr.length; i++) { try { arr[i](payload); } catch (e) {} } }
    }
  };
  // pending permission requests: id -> {resolve, timer}
  var pendingPerms = {};
  var nextPermId = 1;
  window.__zxPermRequest = function (kind) {
    return new Promise(function (resolve) {
      var id = nextPermId++;
      pendingPerms[id] = resolve;
      setTimeout(function () {
        if (pendingPerms[id]) { delete pendingPerms[id]; resolve(false); }
      }, 45000);
      post('perm-request', { kind: kind, id: id });
    });
  };
  window.__zxPermReply = function (id, allow) {
    var r = pendingPerms[id];
    if (r) { delete pendingPerms[id]; r(!!allow); }
  };
  // page info for save-page etc.
  window.__zxTabId = TAB;
})();
