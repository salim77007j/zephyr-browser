// Zephyr edge-resize for frameless windows (Windows).
// Injected into every page (content bundle + internal pages). On non-frameless
// platforms (native window decorations) this is a no-op.
(function () {
  'use strict';
  if (window.__ZX_EDGE__) return;
  window.__ZX_EDGE__ = 1;
  var FRAMELESS = /Windows/.test(navigator.userAgent);
  if (!FRAMELESS) return;
  var E = 6;
  var CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', sw: 'nesw-resize' };
  function dirFor(x, y, w, h, allowNorth) {
    var n = y <= E, s = y >= h - E, west = x <= E, east = x >= w - E;
    if (allowNorth && n && west) return 'nw';
    if (allowNorth && n && east) return 'ne';
    if (s && west) return 'sw';
    if (s && east) return 'se';
    if (allowNorth && n) return 'n';
    if (s) return 's';
    if (west) return 'w';
    if (east) return 'e';
    return null;
  }
  var allowNorth = true; // chrome + overlay webviews cover the window top; content pages override
  document.addEventListener('mousemove', function (e) {
    var d = dirFor(e.clientX, e.clientY, window.innerWidth, window.innerHeight, allowNorth);
    document.body.style.cursor = d ? CURSORS[d] : '';
  }, true);
  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    var d = dirFor(e.clientX, e.clientY, window.innerWidth, window.innerHeight, allowNorth);
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    function post() {
      try {
        window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: 'win-resize', tab: null, data: { dir: d } }));
      } catch (err) {}
    }
    post();
  }, true);
})();
