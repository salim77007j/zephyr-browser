// Zephyr fingerprint protection + permission shims.
// Canvas / audio / WebGL noise, navigator hardening, doNotTrack,
// third-party document.cookie policy, geolocation / notifications /
// getUserMedia default-deny with per-site prompts via the Rust core.
(function () {
  var P = window.__ZXP || {};
  var PERM = window.__ZX_PERM || {};
  var ALLOW = window.__ZX_ALLOW || {};
  var isTop = (function () { try { return window.top === window.self; } catch (e) { return false; } })();
  var origin = location.origin;

  function allowHas(kind) {
    var arr = ALLOW[kind];
    return !!(arr && arr.indexOf && arr.indexOf(origin) !== -1);
  }

  // deterministic per-session PRNG seed (stable across reloads in a tab session)
  var seed = ((window.__ZX_TAB || 1) * 2654435761) % 4294967296;
  function rand() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // ------------------------------------------------------------- canvas noise
  if (P.fp_canvas) {
    try {
      var origGetCtx = HTMLCanvasElement.prototype.getContext;
      var origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      var origToBlob = HTMLCanvasElement.prototype.toBlob;
      // capture the ORIGINAL getImageData BEFORE any hooking
      var origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      function noisyPixels(canvas) {
        var ctx = origGetCtx.call(canvas, '2d', { willReadFrequently: true });
        if (!ctx) return;
        var w = canvas.width, h = canvas.height;
        if (!w || !h || w * h > 16 * 1024 * 1024) return;
        var img = origGetImageData.call(ctx, 0, 0, w, h);
        var d = img.data;
        var n = Math.max(1, Math.floor(d.length / 4 / 200));
        for (var i = 0; i < n; i++) {
          var px = (Math.floor(rand() * (d.length / 4))) * 4;
          d[px] = d[px] ^ 1;
          d[px + 1] = d[px + 1] ^ 1;
        }
        ctx.putImageData(img, 0, 0);
      }
      HTMLCanvasElement.prototype.toDataURL = function () {
        try { noisyPixels(this); } catch (e) {}
        return origToDataURL.apply(this, arguments);
      };
      HTMLCanvasElement.prototype.toBlob = function (cb) {
        try { noisyPixels(this); } catch (e) {}
        return origToBlob.apply(this, arguments);
      };
      CanvasRenderingContext2D.prototype.getImageData = function () {
        var img = origGetImageData.apply(this, arguments);
        try {
          var d = img.data;
          var n = Math.max(1, Math.floor(d.length / 4 / 200));
          for (var i = 0; i < n; i++) {
            var px = (Math.floor(rand() * (d.length / 4))) * 4;
            d[px] = d[px] ^ 1;
          }
        } catch (e) {}
        return img;
      };
      // WebGL readback noise
      var getParamHook = function (proto) {
        if (!proto) return;
        var orig = proto.prototype.getParameter;
        var UNMASKED_VENDOR = 0x9245, UNMASKED_RENDERER = 0x9246;
        proto.prototype.getParameter = function (p) {
          if (p === UNMASKED_VENDOR) return 'Zephyr';
          if (p === UNMASKED_RENDERER) return 'Zephyr WebGL Engine';
          return orig.apply(this, arguments);
        };
      };
      if (P.fp_webgl) {
        getParamHook(window.WebGLRenderingContext);
        getParamHook(window.WebGL2RenderingContext);
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------- audio noise
  if (P.fp_audio) {
    try {
      var hookFloat = function (proto, name) {
        if (!proto) return;
        var orig = proto.prototype[name];
        proto.prototype[name] = function (arr) {
          var r = orig.apply(this, arguments);
          try {
            for (var i = 0; i < arr.length; i += 97) {
              arr[i] = arr[i] + (rand() - 0.5) * 1e-7;
            }
          } catch (e) {}
          return r;
        };
      };
      hookFloat(window.AnalyserNode, 'getFloatFrequencyData');
      hookFloat(window.AnalyserNode, 'getFloatTimeDomainData');
      if (window.AudioBuffer) {
        var origGC = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function (ch) {
          var d = origGC.apply(this, arguments);
          try {
            for (var i = 0; i < d.length; i += 211) d[i] = d[i] + (rand() - 0.5) * 1e-7;
          } catch (e) {}
          return d;
        };
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------- navigator
  if (P.fp_navigator) {
    try {
      if (navigator.hardwareConcurrency && navigator.hardwareConcurrency > 4) {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: function () { return 4; }, configurable: true });
      }
      if (navigator.deviceMemory) {
        Object.defineProperty(navigator, 'deviceMemory', { get: function () { return 4; }, configurable: true });
      }
      if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
        var origHEV = navigator.userAgentData.getHighEntropyValues.bind(navigator.userAgentData);
        navigator.userAgentData.getHighEntropyValues = function (hints) {
          return origHEV(hints).then(function (v) {
            v.platform = 'Windows';
            v.platformVersion = '15.0.0';
            v.architecture = 'x86';
            v.bitness = '64';
            v.model = '';
            v.fullVersionList = [{ brand: 'Chromium', version: '131.0.0.0' }];
            return v;
          });
        };
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------- DNT
  if (P.do_not_track) {
    try {
      Object.defineProperty(navigator, 'doNotTrack', { get: function () { return '1'; }, configurable: true });
    } catch (e) {}
  }

  // ------------------------------------------------------------- 3rd-party document.cookie
  if (P.block_thirdparty_js_cookies && !isTop) {
    try {
      var d = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
        Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
      if (d) {
        Object.defineProperty(document, 'cookie', {
          get: function () { return ''; },
          set: function () { /* dropped */ },
          configurable: true
        });
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------- permission shims
  // geolocation
  if (navigator.geolocation) {
    var realGeo = {
      getCurrentPosition: navigator.geolocation.getCurrentPosition.bind(navigator.geolocation),
      watchPosition: navigator.geolocation.watchPosition.bind(navigator.geolocation)
    };
    function geoDenied(cb) {
      try {
        var err = new GeolocationPositionError ? new GeolocationPositionError() : null;
      } catch (e) {}
      var ev = { code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 };
      try { if (cb) cb({ code: 1, message: 'User denied Geolocation' }); } catch (e) {}
      var errEv = new Event('error');
      if (navigator.geolocation.onerror) navigator.geolocation.onerror(errEv);
    }
    function decideGeo(kind, onAllow, onDeny) {
      var eff = PERM.geolocation || 'ask';
      if (allowHas('geolocation')) eff = 'allow';
      if (eff === 'allow') onAllow();
      else if (eff === 'block') onDeny();
      else {
        if (window.__zxPermRequest) {
          window.__zxPermRequest('geolocation').then(function (ok) { if (ok) onAllow(); else onDeny(); });
        } else onDeny();
      }
    }
    navigator.geolocation.getCurrentPosition = function (ok, err) {
      decideGeo('geolocation', function () { realGeo.getCurrentPosition(ok, err); }, function () { if (err) err({ code: 1, message: 'User denied Geolocation' }); });
    };
    navigator.geolocation.watchPosition = function (ok, err) {
      var denied = false;
      decideGeo('geolocation', function () { return realGeo.watchPosition(ok, err); }, function () { if (err) err({ code: 1, message: 'User denied Geolocation' }); return -1; });
    };
  }

  // notifications
  if (window.Notification) {
    var origReq = Notification.requestPermission;
    Notification.requestPermission = function () {
      var eff = PERM.notifications || 'ask';
      if (allowHas('notifications')) return Promise.resolve('granted');
      if (eff === 'block') return Promise.resolve('denied');
      if (window.__zxPermRequest) {
        return window.__zxPermRequest('notifications').then(function (ok) { return ok ? 'granted' : 'denied'; });
      }
      return Promise.resolve('denied');
    };
  }

  // camera / microphone
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    var origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function (constraints) {
      var kind = (constraints && (constraints.audio || constraints.video && !constraints.audio)) ? 'camera' : 'camera';
      var eff = PERM.camera || 'ask';
      if (allowHas('camera')) eff = 'allow';
      if (eff === 'allow') return origGUM(constraints);
      if (eff === 'block') {
        return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      }
      if (window.__zxPermRequest) {
        return window.__zxPermRequest('camera').then(function (ok) {
          if (ok) return origGUM(constraints);
          return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
        });
      }
      return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    };
  }
})();
