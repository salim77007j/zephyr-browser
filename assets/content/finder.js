// Zephyr find-in-page — highlight engine with count + active match.
(function () {
  var wraps = [];
  var activeIdx = -1;
  var query = '';
  var count = 0;

  function report() {
    if (window.__zx) window.__zx.post('find-result', { count: count, active: activeIdx + 1 });
  }

  function clearHighlights() {
    for (var i = 0; i < wraps.length; i++) {
      var s = wraps[i];
      if (!s.parentNode) continue;
      try {
        var parent = s.parentNode;
        while (s.firstChild) parent.insertBefore(s.firstChild, s);
        parent.removeChild(s);
        parent.normalize();
      } catch (e) {}
    }
    wraps = [];
    activeIdx = -1;
    count = 0;
  }

  function textNodes() {
    var out = [];
    var walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentNode;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tn = p.nodeName;
        if (tn === 'SCRIPT' || tn === 'STYLE' || tn === 'NOSCRIPT' || tn === 'TEXTAREA') return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('[data-zx-cosmetic],[data-zx-blocked],[data-zx-findbar]')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  function highlight(q) {
    clearHighlights();
    query = q;
    if (!q || q.length < 1) { report(); return; }
    var lq = q.toLowerCase();
    var nodes = textNodes();
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var text = node.nodeValue;
      var lower = text.toLowerCase();
      var idx = lower.indexOf(lq);
      if (idx === -1) continue;
      var frag = document.createDocumentFragment();
      var pos = 0;
      while (idx !== -1) {
        if (idx > pos) frag.appendChild(document.createTextNode(text.slice(pos, idx)));
        var s = document.createElement('span');
        s.setAttribute('data-zx-find', '1');
        s.style.cssText = 'background-color:#ffe28a;color:#111;border-radius:2px;';
        s.appendChild(document.createTextNode(text.slice(idx, idx + q.length)));
        frag.appendChild(s);
        wraps.push(s);
        pos = idx + q.length;
        idx = lower.indexOf(lq, pos);
      }
      if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
      try {
        node.parentNode.replaceChild(frag, node);
      } catch (e) {}
    }
    count = wraps.length;
    activeIdx = count > 0 ? 0 : -1;
    paintActive();
    report();
  }

  function paintActive() {
    for (var i = 0; i < wraps.length; i++) {
      wraps[i].style.cssText = i === activeIdx
        ? 'background-color:#ff9f2e;color:#111;border-radius:2px;box-shadow:0 0 0 2px rgba(255,159,46,.5);'
        : 'background-color:#ffe28a;color:#111;border-radius:2px;';
    }
    if (activeIdx >= 0 && wraps[activeIdx]) {
      try { wraps[activeIdx].scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (e) {
        try { wraps[activeIdx].scrollIntoView(); } catch (e2) {}
      }
    }
  }

  function next() {
    if (!count) return;
    activeIdx = (activeIdx + 1) % count;
    paintActive(); report();
  }
  function prev() {
    if (!count) return;
    activeIdx = (activeIdx - 1 + count) % count;
    paintActive(); report();
  }

  window.__zxFinder = {
    open: function () {},
    query: function (q) {
      highlight(q);
    },
    next: next,
    prev: prev,
    close: function () {
      clearHighlights();
      query = '';
      report();
    }
  };
  window.__zxTestFind = function () { report(); };
})();
