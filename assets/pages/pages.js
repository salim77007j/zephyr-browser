// Zephyr internal pages shared helpers
/* global document, window */
window.ZX = function (cmd, data) {
  try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: cmd, tab: window.__ZX_TAB || 0, data: data || {} })); }
  catch (e) {}
};
window.__zx = (function () {
  var listeners = {};
  return {
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, payload) {
      var a = listeners[ev];
      if (a) { for (var i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) {} } }
    }
  };
})();
window.esc = function (s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};
window.hostOf = function (u) {
  try { return new URL(u).hostname; } catch (e) { return ''; }
};
window.letterColor = function (h) {
  var x = 0;
  for (var i = 0; i < h.length; i++) { x = (x * 31 + h.charCodeAt(i)) % 360; }
  return 'hsl(' + x + ', 55%, 45%)';
};
window.timeAgo = function (ms) {
  if (!ms) return '';
  var d = Date.now() - ms;
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + ' min ago';
  if (d < 86400000) return Math.floor(d / 3600000) + ' h ago';
  return Math.floor(d / 86400000) + ' d ago';
};
window.humanBytes = function (n) {
  if (!n) return '';
  var u = ['B', 'KB', 'MB', 'GB'];
  var v = n, i = 0;
  while (v >= 1024 && i < 3) { v /= 1024; i++; }
  return i === 0 ? v + ' ' + u[0] : v.toFixed(1) + ' ' + u[i];
};

// toggle switch helper: field(label, sub, key, kind)
window.mkSwitch = function (key, on, cb) {
  return '<div class="switch' + (on ? ' on' : '') + '" data-key="' + key + '"></div>';
};

document.addEventListener('mousedown', function () {
  try { window.ipc.postMessage(JSON.stringify({ ns: 'content', cmd: 'chrome-collapse', tab: window.__ZX_TAB || 0, data: {} })); } catch (e) {}
}, true);

// shared switch click delegation
document.addEventListener('click', function (e) {
  var sw = e.target.closest && e.target.closest('.switch[data-key]');
  if (!sw) return;
  var key = sw.dataset.key;
  var nowOn = !sw.classList.contains('on');
  sw.classList.toggle('on', nowOn);
  ZX('prefs-set', { key: key, value: nowOn ? '1' : '0' });
});
