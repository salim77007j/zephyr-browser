// Zephyr cosmetic filter — element-level ad hiding from EasyList cosmetic
// rules (generic + domain-specific selectors), plus size-based heuristics.
(function () {
  var D = window.__ZXD || {};
  if (!D.enabled || !D.cosmetic) return;

  var GEN = (D.gen || []);
  var DOM = (D.dom || {});
  var HEUR = D.heuristic !== false;

  function selectorsForHost(host) {
    var sels = GEN.slice();
    var parts = host.split('.');
    for (var i = 0; i < parts.length - 1; i++) {
      var d = parts.slice(i).join('.');
      var entry = DOM[d];
      if (entry) {
        var hide = entry.h || [];
        for (var j = 0; j < hide.length; j++) {
          var sel = hide[j];
          var exc = (entry.e || []).filter(function (x) { return sel.indexOf(x) !== -1; });
          sels.push(exc.length ? sel + ':not(' + exc.join(',') + ')' : sel);
        }
      }
    }
    return sels;
  }

  var counted = 0;
  var styleEl = null;
  var observer = null;
  var rescanTimer = null;

  function buildCSS(host) {
    var sels = selectorsForHost(host);
    if (!sels.length) return null;
    // validate selectors, drop broken ones
    var ok = [];
    for (var i = 0; i < sels.length; i++) {
      try { document.querySelector(sels[i]); ok.push(sels[i]); } catch (e) {}
    }
    if (!ok.length) return null;
    return ok.join(',') + '{display:none!important;visibility:hidden!important;min-height:0!important;height:0!important}';
  }

  function countHidden() {
    try {
      var n = document.querySelectorAll('[data-zx-hidden="1"]').length;
      if (n > counted) {
        var delta = n - counted;
        counted = n;
        if (window.__zx) window.__zx.post('blocked-batch', { cosmetic: 0, cosmeticTotal: n, ads: 0, trackers: 0, params: 0, hosts: [] });
        return delta;
      }
    } catch (e) {}
    return 0;
  }

  function apply() {
    if (document.documentElement && document.documentElement.dataset && document.documentElement.dataset.zxNoCosmetic) return;
    var host = location.hostname.toLowerCase();
    if (!host) return;
    var css = buildCSS(host);
    if (css) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.setAttribute('data-zx-cosmetic', '1');
        (document.head || document.documentElement).appendChild(styleEl);
      }
      styleEl.textContent = css + '[data-zx-hidden="1"]{display:none!important}';
    }
    markHidden();
    if (HEUR) heuristic();
  }

  function markHidden() {
    try {
      var sels = selectorsForHost(location.hostname.toLowerCase());
      var total = 0;
      for (var i = 0; i < sels.length; i++) {
        var nodes = document.querySelectorAll(sels[i]);
        for (var j = 0; j < nodes.length; j++) {
          if (!nodes[j].getAttribute('data-zx-hidden')) {
            nodes[j].setAttribute('data-zx-hidden', '1');
            total++;
          }
        }
      }
      countHidden();
    } catch (e) {}
  }

  // heuristic: classic ad shapes + obvious ad-ish ids/classes
  function heuristic() {
    try {
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        var f = frames[i];
        if (f.getAttribute('data-zx-hidden') || f.getAttribute('data-zx-blocked')) continue;
        var w = f.width || f.offsetWidth || 0, h = f.height || f.offsetHeight || 0;
        if (isAdSize(w, h) || idLooksAd(f)) {
          f.setAttribute('data-zx-hidden', '1');
        }
      }
      var imgs = document.querySelectorAll('img');
      for (var k = 0; k < imgs.length; k++) {
        var im = imgs[k];
        if (im.getAttribute('data-zx-hidden') || im.getAttribute('data-zx-blocked')) continue;
        var w2 = im.width || 0, h2 = im.height || 0;
        if (isAdSize(w2, h2) && idLooksAd(im)) im.setAttribute('data-zx-hidden', '1');
      }
      countHidden();
    } catch (e) {}
  }

  var AD_SIZES = [[728, 90], [300, 250], [468, 60], [160, 600], [320, 50], [320, 100], [970, 250], [970, 90], [300, 600], [250, 250], [336, 280], [120, 600], [180, 150], [1, 1], [2, 2]];
  function isAdSize(w, h) {
    if (!w || !h) return false;
    if (w < 4 || h < 4) return false;
    for (var i = 0; i < AD_SIZES.length; i++) {
      if (Math.abs(w - AD_SIZES[i][0]) <= 2 && Math.abs(h - AD_SIZES[i][1]) <= 2) return true;
    }
    return false;
  }
  function idLooksAd(el) {
    var s = ((el.id || '') + ' ' + (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '') + ' ' + (el.name || '')).toLowerCase();
    return /(^|[\s_-])(ad|ads|adv|advert|advertisement|banner|promo|sponsor|doubleclick|taboola|outbrain)([\s_-]|$)/.test(s);
  }

  function scheduleRescan() {
    if (rescanTimer !== null) return;
    rescanTimer = setTimeout(function () {
      rescanTimer = null;
      apply();
    }, 350);
  }

  function start() {
    apply();
    try {
      observer = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          if (muts[i].addedNodes && muts[i].addedNodes.length) { scheduleRescan(); break; }
        }
      });
      observer.observe(document.documentElement || document, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { start(); }, true);
  } else {
    start();
  }
})();
