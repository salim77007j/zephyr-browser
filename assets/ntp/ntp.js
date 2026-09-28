// Zephyr new tab page controller — greeting, weather, clock, search, shortcuts.
/* global document, window */
(function () {
  'use strict';
  function ZX(cmd, data) {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'chrome', cmd: cmd, tab: window.__ZX_TAB || 0, data: data || {} })); }
    catch (e) {}
  }
  var listeners = {};
  window.__zx = {
    on: function (ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    emit: function (ev, payload) {
      var a = listeners[ev];
      if (a) { for (var i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) {} } }
    }
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function hostOf(u) {
    try { return new URL(u).hostname; } catch (e) { return ''; }
  }

  // ------------------------------------------------------------ clock + greeting
  var SUBS = {
    morning: 'Hope you have a great day.',
    afternoon: 'Hope your afternoon is going well.',
    evening: 'Winding down for a good evening.',
    night: 'It’s late — browse gently.'
  };
  function tick() {
    var d = new Date();
    var h = d.getHours();
    var g = h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : h < 22 ? 'evening' : 'night';
    document.getElementById('greeting').textContent =
      g === 'night' ? 'Good night' : g === 'afternoon' ? 'Good afternoon' : g === 'evening' ? 'Good evening' : 'Good morning!';
    document.getElementById('greet-sub').textContent = SUBS[g];
    var ampm = h >= 12 ? 'PM' : 'AM';
    var hh = h % 12; if (hh === 0) hh = 12;
    document.getElementById('clock').textContent = hh + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ' ' + ampm;
    var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    document.getElementById('date').textContent =
      days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  tick();
  setInterval(tick, 15000);

  // ------------------------------------------------------------ weather
  var WICONS = {
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="#f4b400" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.4" fill="#feda5c" stroke="#f4b400"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M19.1 4.9l-1.7 1.7M6.6 17.4l-1.7 1.7"/></svg>',
    cloudy: '<svg viewBox="0 0 24 24" fill="#c7d2e0"><path d="M6.5 19a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.7 8.6 4.3 4.3 0 0 1 17 19H6.5z"/></svg>',
    rain: '<svg viewBox="0 0 24 24" fill="#c7d2e0" stroke="#4b7bec" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.7 4.6 4.3 4.3 0 0 1 17 15H6.5z"/><path d="M8 18l-1 2.6M12.5 18l-1 2.6M17 18l-1 2.6"/></svg>',
    snow: '<svg viewBox="0 0 24 24" fill="#c7d2e0"><path d="M6.5 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.7 4.6 4.3 4.3 0 0 1 17 15H6.5z"/><circle cx="8" cy="19" r="1.1" fill="#4b7bec"/><circle cx="12.5" cy="20.5" r="1.1" fill="#4b7bec"/><circle cx="17" cy="19" r="1.1" fill="#4b7bec"/></svg>',
    storm: '<svg viewBox="0 0 24 24" fill="#c7d2e0"><path d="M6.5 15a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 17.7 4.6 4.3 4.3 0 0 1 17 15H6.5z"/><path d="M12.8 14.5l-3 4.2h2l-1.2 3.6 4-4.8h-2.2l1.7-3z" fill="#f4b400"/></svg>'
  };
  function wxGroup(code) {
    if (code === 0) return 'clear';
    if (code <= 3) return 'cloudy';
    if (code <= 67 || (code >= 80 && code <= 82)) return 'rain';
    if (code <= 77 || code >= 85) return 'snow';
    return 'storm';
  }
  function wxText(code) {
    var t = {
      0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 48: 'Icy fog',
      51: 'Light drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 71: 'Light snow', 73: 'Snow',
      75: 'Heavy snow', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 95: 'Thunderstorm', 96: 'Storm + hail', 99: 'Storm + hail'
    };
    return t[code] || (code === 0 ? 'Clear' : code <= 3 ? 'Partly cloudy' : code <= 65 ? 'Rain' : code <= 77 ? 'Snow' : 'Storm');
  }
  function renderWeather(w) {
    var box = document.getElementById('weather');
    if (!w || w.err) { box.classList.add('hidden'); document.getElementById('wx-sep').classList.add('hidden'); return; }
    box.classList.remove('hidden');
    document.getElementById('wx-sep').classList.remove('hidden');
    document.getElementById('wx-ico').innerHTML = WICONS[wxGroup(w.code)] || WICONS.clear;
    document.getElementById('wx-temp').textContent = Math.round(w.temp_c) + '°C';
    document.getElementById('wx-desc').textContent = wxText(w.code);
  }
  function loadWeather() { ZX('weather', {}); }

  // ------------------------------------------------------------ theme
  window.__zx.on('theme', function (p) {
    document.getElementById('ntp').setAttribute('data-theme', p.theme || 'light');
  });

  // ------------------------------------------------------------ search
  document.getElementById('search').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = document.getElementById('q').value.trim();
    if (q) ZX('nav', { url: q });
  });
  document.getElementById('lens').addEventListener('click', function () {
    ZX('nav', { url: 'https://lens.google.com' });
  });
  document.getElementById('mic').addEventListener('click', function () {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var hint = document.getElementById('mic-hint');
    if (!SR) {
      hint.classList.remove('hidden');
      setTimeout(function () { hint.classList.add('hidden'); }, 4000);
      return;
    }
    try {
      var rec = new SR();
      rec.lang = navigator.language || 'en-US';
      hint.textContent = 'Listening…';
      hint.classList.remove('hidden');
      rec.onresult = function (ev) {
        var said = ev.results[0][0].transcript;
        document.getElementById('q').value = said;
        ZX('nav', { url: said });
      };
      rec.onend = function () { hint.classList.add('hidden'); };
      rec.onerror = function () {
        hint.textContent = 'Voice search isn’t supported by this engine.';
        hint.classList.remove('hidden');
        setTimeout(function () { hint.classList.add('hidden'); }, 4000);
      };
      rec.start();
    } catch (e) {
      hint.classList.remove('hidden');
      setTimeout(function () { hint.classList.add('hidden'); }, 4000);
    }
  });

  // ------------------------------------------------------------ tiles
  var BRAND = {
    'www.google.com': '/img/google.svg', 'google.com': '/img/google.svg',
    'www.youtube.com': '/img/youtube.svg', 'youtube.com': '/img/youtube.svg',
    'mail.google.com': '/img/gmail.svg',
    'maps.google.com': '/img/maps.svg',
    'drive.google.com': '/img/drive.svg'
  };
  var base = '';
  function tileHtml(url, label, removable, id) {
    var h = hostOf(url);
    var icon;
    if (BRAND[h]) icon = '<img src="' + base + BRAND[h] + '" alt="">';
    else {
      var letter = (label.replace(/^www\./, '')[0] || '?').toUpperCase();
      var x = 0;
      for (var i = 0; i < h.length; i++) x = (x * 31 + h.charCodeAt(i)) % 360;
      icon = '<span class="letter" style="background:hsl(' + x + ',58%,46%)">' + letter + '</span>';
    }
    return '<button class="tile" data-url="' + esc(url) + '"' + (removable ? ' data-id="' + id + '"' : '') + ' title="' + esc(url) + '">' +
      '<span class="disc">' + icon + '</span><span class="lbl">' + esc(label) + '</span></button>';
  }
  function renderTiles(p) {
    var host = document.getElementById('tiles');
    var html = '';
    var seen = {};
    (p.shortcuts || []).slice(0, 4).forEach(function (s) {
      if (!s.url || seen[s.url]) return;
      seen[s.url] = 1;
      html += tileHtml(s.url, s.title || s.host, true, s.id);
    });
    (p.topSites || []).forEach(function (t) {
      if (html.split('</button>').length >= 5) return;
      if (seen[t.url]) return;
      seen[t.url] = 1;
      html += tileHtml(t.url, t.title || t.host, false, 0);
    });
    // Fill with the product defaults so a fresh profile matches the design
    // (wed1.png shows the round Google/YouTube/Gmail/Maps/Drive tiles).
    (p.defaults || []).forEach(function (d) {
      if (html.split('</button>').length - 1 >= 5) return;
      if (!d.url || seen[d.url]) return;
      seen[d.url] = 1;
      html += tileHtml(d.url, d.label, false, 0);
    });
    // Always offer the Add shortcut tile (Chrome-style), after up to 5 data tiles.
    if (html.split('</button>').length - 1 <= 5) {
      html += '<button class="tile add" id="add-shortcut" title="Add shortcut">' +
        '<span class="disc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></span>' +
        '<span class="lbl">Add shortcut</span></button>';
    }
    host.innerHTML = html;
  }

  window.__zx.on('ntp-data', function (p) {
    base = p.serverBase || base;
    renderTiles(p);
    renderWeather(p.weather);
  });

  // tiles interactions
  document.getElementById('tiles').addEventListener('click', function (e) {
    var add = e.target.closest && e.target.closest('#add-shortcut');
    if (add) { openDialog(); return; }
    var tile = e.target.closest && e.target.closest('.tile[data-url]');
    if (tile) ZX('nav', { url: tile.dataset.url });
  });
  document.getElementById('tiles').addEventListener('contextmenu', function (e) {
    var tile = e.target.closest && e.target.closest('.tile[data-id]');
    if (tile) {
      e.preventDefault();
      ZX('shortcut-remove', { id: parseInt(tile.dataset.id, 10) });
    }
  });

  // add-shortcut dialog
  function openDialog() {
    document.getElementById('dlg').classList.remove('hidden');
    document.getElementById('dlg-err').classList.add('hidden');
    document.getElementById('dlg-name').value = '';
    document.getElementById('dlg-url').value = '';
    setTimeout(function () { document.getElementById('dlg-url').focus(); }, 50);
  }
  function closeDialog() { document.getElementById('dlg').classList.add('hidden'); }
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  document.getElementById('dlg').addEventListener('click', function (e) {
    if (e.target.id === 'dlg') closeDialog();
  });
  document.getElementById('dlg-ok').addEventListener('click', submitDialog);
  document.getElementById('dlg-url').addEventListener('keydown', function (e) { if (e.key === 'Enter') submitDialog(); });
  function submitDialog() {
    var url = document.getElementById('dlg-url').value.trim();
    var name = document.getElementById('dlg-name').value.trim();
    if (!url || (!/^[a-z]+:\/\//i.test(url) && !/^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(url))) {
      document.getElementById('dlg-err').classList.remove('hidden');
      return;
    }
    if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
    ZX('shortcut-add', { url: url, title: name || hostOf(url) });
    closeDialog();
    setTimeout(function () { ZX('ntp-data', {}); }, 250);
  }

  // footer
  document.getElementById('leaf').addEventListener('click', function () { ZX('nav', { url: 'zephyr://privacy' }); });
  document.getElementById('gear').addEventListener('click', function () { ZX('nav', { url: 'zephyr://settings' }); });

  // collapse chrome popups when clicking into the page
  document.addEventListener('mousedown', function () {
    try { window.ipc.postMessage(JSON.stringify({ ns: 'content', cmd: 'chrome-collapse', tab: window.__ZX_TAB || 0, data: {} })); } catch (e) {}
  }, true);

  // core pushes {weather: {...}} — unwrap before rendering (both shapes tolerated)
  window.__zx.on('weather-data', function (p) { renderWeather(p && p.weather ? p.weather : p); });

  ZX('page-hello', { page: 'ntp' });
  ZX('ntp-data', {});
  loadWeather();
  setInterval(loadWeather, 30 * 60 * 1000);
})();
