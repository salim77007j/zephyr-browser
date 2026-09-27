// Zephyr network filter — script-level request interception.
// Wraps fetch / XHR / sendBeacon / element src setters / setAttribute and
// removes parser-inserted blocked resources. Strips tracking parameters.
(function () {
  var D = window.__ZXD || {};
  if (!D.enabled || !D.net) return;

  var ADS = '\n' + (D.ads || '') + '\n';
  var TRK = '\n' + (D.trackers || '') + '\n';
  var MAL = '\n' + (D.mal || '') + '\n';
  var EXC = '\n' + (D.exc || '') + '\n';
  var STRIP = D.stripParams !== false;
  var MAL_ON = D.malicious !== false;

  var batch = { ads: 0, trackers: 0, params: 0, hosts: {}, cosmetic: 0 };
  var totals = { ads: 0, trackers: 0, params: 0, imgRemoved: 0, iframeRemoved: 0 };
  var flushTimer = null;

  // exposed for diagnostics / smoke tests
  window.__zxFilterStats = function () {
    return {
      ads: totals.ads, trackers: totals.trackers, params: totals.params,
      imgRemoved: totals.imgRemoved, iframeRemoved: totals.iframeRemoved
    };
  };

  function flush() {
    flushTimer = null;
    var hosts = [];
    for (var h in batch.hosts) hosts.push({ host: h, class: batch.hosts[h] });
    var payload = {
      ads: batch.ads, trackers: batch.trackers, params: batch.params,
      cosmetic: batch.cosmetic, hosts: hosts
    };
    totals.ads += batch.ads;
    totals.trackers += batch.trackers;
    totals.params += batch.params;
    batch = { ads: 0, trackers: 0, params: 0, hosts: {}, cosmetic: 0 };
    if (window.__zx) window.__zx.post('blocked-batch', payload);
  }
  function scheduleFlush() {
    if (flushTimer === null) {
      flushTimer = setTimeout(flush, 800);
    }
  }
  function note(host, cls) {
    if (cls === 'ads') batch.ads++;
    else if (cls === 'trackers') batch.trackers++;
    else batch.trackers++;
    if (batch.hosts[host] === undefined) batch.hosts[host] = cls;
    scheduleFlush();
  }
  function hit(set, host) {
    if (host.length > 250) return false;
    return set.indexOf('\n' + host + '\n') !== -1;
  }
  function suffixHit(set, host) {
    if (hit(set, host)) return true;
    var parts = host.split('.');
    for (var i = 1; i < parts.length - 1; i++) {
      if (hit(set, parts.slice(i).join('.'))) return true;
    }
    return false;
  }
  function classify(host) {
    if (suffixHit(EXC, host)) return null;
    if (suffixHit(ADS, host)) return 'ads';
    if (suffixHit(TRK, host)) return 'trackers';
    if (MAL_ON && suffixHit(MAL, host)) return 'malicious';
    return null;
  }
  function hostOf(u) {
    try {
      if (u.indexOf('//') === -1) return location.hostname;
      return new URL(u, location.href).hostname.toLowerCase();
    } catch (e) { return null; }
  }

  var STRIP_PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_name', 'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    'fbclid', 'gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid', 'twclid', 'ttclid',
    'igshid', 'igsh', 'yclid', 'ysclid', 'vmcid', 'mc_cid', 'mc_eid',
    '_hsenc', '_hsmi', 'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id',
    'wickedid', 'marto_id', 's_kwcid', 'pk_campaign', 'pk_kwd', 'piwik_campaign',
    'matomo_campaign', 'matomo_kwd', 'mtm_campaign', 'mtm_kwd', 'spm', 'scm',
    'trk_contact', 'trk_msg', 'trk_module', 'trk_sid', 'gclsrc', 'gcl_aw',
    'rdt_cid', 'lrtrk', '_openstat', 'action_object_map', 'action_type_map', 'action_ref_map'
  ];
  function stripParams(url) {
    if (!STRIP || url.indexOf('?') === -1) return url;
    try {
      var u = new URL(url, location.href);
      var changed = false;
      for (var i = 0; i < STRIP_PARAMS.length; i++) {
        if (u.searchParams.has(STRIP_PARAMS[i])) { u.searchParams.delete(STRIP_PARAMS[i]); changed = true; }
      }
      if (!changed) return url;
      batch.params++;
      scheduleFlush();
      return u.href;
    } catch (e) { return url; }
  }

  // ---- fetch
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || String(input);
        var host = hostOf(url);
        if (host) {
          var cls = classify(host);
          if (cls) {
            note(host, cls);
            return Promise.reject(new TypeError('NetworkError when attempting to fetch resource.'));
          }
          var cleaned = stripParams(url);
          if (cleaned !== url) {
            if (typeof input === 'string') input = cleaned;
            else { input = new Request(cleaned, input); }
          }
        }
      } catch (e) {}
      return origFetch.call(this, input, init);
    };
  }

  // ---- XMLHttpRequest
  var xo = XMLHttpRequest.prototype;
  var origOpen = xo.open;
  xo.open = function (method, url) {
    try {
      this.__zx_blocked = false;
      var host = hostOf(String(url));
      if (host) {
        var cls = classify(host);
        if (cls) {
          this.__zx_blocked = true;
          note(host, cls);
          arguments[1] = 'about:blank';
        } else {
          arguments[1] = stripParams(String(url));
        }
      }
    } catch (e) {}
    return origOpen.apply(this, arguments);
  };
  var origSend = xo.send;
  xo.send = function () {
    if (this.__zx_blocked) {
      try {
        var ev = new Event('error');
        this.dispatchEvent(ev);
        if (this.onerror) this.onerror(new ProgressEvent('error'));
      } catch (e) {}
      return;
    }
    return origSend.apply(this, arguments);
  };

  // ---- sendBeacon
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      try {
        var host = hostOf(String(url));
        if (host) {
          var cls = classify(host);
          if (cls) { note(host, cls); return true; }
        }
        return origBeacon(stripParams(String(url)), data);
      } catch (e) { return true; }
    };
  }

  // ---- element src setters (catch dynamically-created elements)
  var SRC_TAGS = {
    HTMLImageElement: 'src', HTMLScriptElement: 'src', HTMLIFrameElement: 'src',
    HTMLMediaElement: 'src', HTMLSourceElement: 'src', HTMLTrackElement: 'src',
    HTMLLinkElement: 'href', HTMLEmbedElement: 'src', HTMLObjectElement: 'data'
  };
  Object.keys(SRC_TAGS).forEach(function (tag) {
    var proto = window[tag];
    var prop = SRC_TAGS[tag];
    if (!proto || !proto.prototype) return;
    try {
      var desc = Object.getOwnPropertyDescriptor(proto.prototype, prop);
      if (!desc || !desc.set) return;
      Object.defineProperty(proto.prototype, prop, {
        get: function () { return desc.get.call(this); },
        set: function (v) {
          try {
            var host = hostOf(String(v));
            if (host) {
              var cls = classify(host);
              if (cls) {
                note(host, cls);
                if (tag === 'HTMLImageElement' || tag === 'HTMLIFrameElement' || tag === 'HTMLScriptElement') {
                  this.setAttribute('data-zx-blocked', '1');
                  return; // never start the load
                }
              }
            }
          } catch (e) {}
          return desc.set.call(this, v);
        },
        configurable: true, enumerable: desc.enumerable
      });
    } catch (e) {}
  });

  // ---- setAttribute wrapper
  var origSetAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    try {
      var n = String(name).toLowerCase();
      if (n === 'src' || n === 'href' || n === 'data') {
        var host = hostOf(String(value));
        if (host) {
          var cls = classify(host);
          if (cls) {
            note(host, cls);
            this.setAttribute('data-zx-blocked', '1');
            return;
          }
        }
        value = stripParams(String(value));
      }
    } catch (e) {}
    return origSetAttr.call(this, name, value);
  };

  // ---- MutationObserver: remove parser-inserted blocked resources
  try {
    var mo = new MutationObserver(function (muts) {
      for (var m = 0; m < muts.length; m++) {
        var added = muts[m].addedNodes;
        for (var i = 0; i < added.length; i++) {
          var node = added[i];
          if (node.nodeType !== 1) continue;
          checkRemove(node);
          // shallow scan of subtree
          if (node.querySelectorAll) {
            var kids = node.querySelectorAll('[src],[href]');
            for (var k = 0; k < kids.length; k++) checkRemove(kids[k]);
          }
        }
      }
    });
    function checkRemove(node) {
      try {
        var url = node.getAttribute && (node.getAttribute('src') || node.getAttribute('href'));
        if (!url) return;
        var host = hostOf(String(url));
        if (!host) return;
        var cls = classify(host);
        if (!cls) return;
        note(host, cls);
        var tag = node.tagName;
        if (tag === 'IMG' || tag === 'IFRAME' || tag === 'SCRIPT' || tag === 'EMBED') {
          node.setAttribute('data-zx-blocked', '1');
          if (node.parentNode) node.parentNode.removeChild(node);
          if (tag === 'IMG') totals.imgRemoved++;
          if (tag === 'IFRAME') totals.iframeRemoved++;
        }
      } catch (e) {}
    }
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}
})();
