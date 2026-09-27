// Zephyr media control — tab mute enforcement + playing indicator.
(function () {
  var muted = window.__ZX_MUTED === true;

  function muteEl(el) {
    try {
      el.muted = true;
      el.volume = 0;
      if (el.pause && el.autoplay) { /* keep playing but silent */ }
    } catch (e) {}
  }
  function applyAll() {
    try {
      var els = document.querySelectorAll('audio,video');
      for (var i = 0; i < els.length; i++) muteEl(els[i]);
    } catch (e) {}
  }
  function suspendAudioCtx() {
    try {
      if (window.__zxAudioCtxs) {
        window.__zxAudioCtxs.forEach(function (c) { try { c.suspend(); } catch (e) {} });
      }
    } catch (e) {}
  }

  // track AudioContexts
  try {
    if (window.AudioContext || window.webkitAudioContext) {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      window.__zxAudioCtxs = [];
      var wrap = function (Orig) {
        return function () {
          var ctx = new Orig();
          window.__zxAudioCtxs.push(ctx);
          if (muted) { try { ctx.suspend(); } catch (e) {} }
          return ctx;
        };
      };
      window.AudioContext = wrap(Ctor);
      if (window.webkitAudioContext && window.webkitAudioContext !== Ctor) {
        window.webkitAudioContext = wrap(window.webkitAudioContext);
      }
    }
  } catch (e) {}

  // media playing indicator
  try {
    var anyPlaying = false;
    function report() {
      var playing = false;
      var els = document.querySelectorAll('audio,video');
      for (var i = 0; i < els.length; i++) {
        if (!els[i].paused && !els[i].ended) { playing = true; break; }
      }
      if (playing !== anyPlaying) {
        anyPlaying = playing;
        if (window.__zx) window.__zx.post('media-state', { playing: playing });
      }
    }
    document.addEventListener('play', report, true);
    document.addEventListener('pause', report, true);
    document.addEventListener('ended', report, true);
  } catch (e) {}

  // mute new media as it appears
  try {
    var mo = new MutationObserver(function () { if (muted) applyAll(); });
    mo.observe(document.documentElement || document, { childList: true, subtree: true });
  } catch (e) {}

  if (muted) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyAll, true);
    } else applyAll();
    suspendAudioCtx();
  }

  // Rust toggles mute via this hook
  window.__zxMuted = function (m) {
    muted = !!m;
    if (muted) { applyAll(); suspendAudioCtx(); }
    else {
      try {
        var els = document.querySelectorAll('audio,video');
        for (var i = 0; i < els.length; i++) { els[i].muted = false; els[i].volume = 1; }
      } catch (e) {}
    }
  };
})();
