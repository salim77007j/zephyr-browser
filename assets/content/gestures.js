// Zephyr mouse gestures — right-button drag: ← back, → forward, ↑ reload, ↓ new tab.
(function () {
  var P = window.__ZXP || {};
  if (P.gestures_enabled === false) return;
  var isTop = (function () { try { return window.top === window.self; } catch (e) { return false; } })();
  if (!isTop) return;

  var tracking = false, sx = 0, sy = 0, moved = false;
  var trail = null, tctx = null;

  function trailStart(x, y) {
    try {
      trail = document.createElement('canvas');
      trail.width = window.innerWidth; trail.height = window.innerHeight;
      trail.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
      (document.body || document.documentElement).appendChild(trail);
      tctx = trail.getContext('2d');
      tctx.lineWidth = 3; tctx.lineCap = 'round';
      tctx.strokeStyle = 'rgba(91,124,250,0.85)';
      tctx.shadowColor = 'rgba(91,124,250,0.6)'; tctx.shadowBlur = 6;
      tctx.beginPath(); tctx.moveTo(x, y);
    } catch (e) { trail = null; }
  }
  function trailMove(x, y) {
    if (tctx) { try { tctx.lineTo(x, y); tctx.stroke(); } catch (e) {} }
  }
  function trailEnd() {
    if (trail && trail.parentNode) trail.parentNode.removeChild(trail);
    trail = null; tctx = null;
  }

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 2) return;
    tracking = true; moved = false; sx = e.clientX; sy = e.clientY;
  }, true);

  document.addEventListener('mousemove', function (e) {
    if (!tracking) return;
    var dx = e.clientX - sx, dy = e.clientY - sy;
    if (!moved && Math.abs(dx) + Math.abs(dy) > 9) {
      moved = true;
      trailStart(sx, sy);
    }
    if (moved) trailMove(e.clientX, e.clientY);
  }, true);

  document.addEventListener('contextmenu', function (e) {
    if (moved) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener('mouseup', function (e) {
    if (e.button !== 2 || !tracking) return;
    tracking = false;
    var wasMoved = moved;
    moved = false;
    trailEnd();
    if (!wasMoved) return; // normal context menu
    var dx = e.clientX - sx, dy = e.clientY - sy;
    var ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 24 && ay < 24) return;
    if (ax > ay * 1.6) {
      if (dx < 0) history.back();
      else history.forward();
    } else if (ay > ax * 1.6) {
      if (dy < 0) location.reload();
      else if (window.__zx) window.__zx.post('gesture-newtab', {});
    }
  }, true);
})();
