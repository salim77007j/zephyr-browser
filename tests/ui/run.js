// Zephyr UI test harness — full browser-shell simulation.
// Spins up: chrome page (/ui/index.html), overlay page (/ui/overlay.html),
// find page (/find/find.html), and content page(s). The Node router plays the
// role of the Rust core: every IPC command from any surface is dispatched
// against a state model that mirrors src/commands.rs, and events are pushed
// back into the right surface via window.__zx.emit (same as push_js()).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'assets');
const PORT = 18391;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- static server
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      const marks = ['/ui/', '/ntp/', '/pages/', '/find/', '/img/', '/content/', '/fixtures/'];
      for (const m of marks) {
        const i = p.indexOf(m);
        if (i > 0) { p = p.slice(i); break; }
      }
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        res.writeHead(404); res.end('nope'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ---------------------------------------------------------------- core model (mirrors commands.rs)
const DEFAULT_PREFS = {
  theme: 'light', accent: '#4b7bec', density: 'normal',
  show_home_button: false, show_bookmarks_bar: true,
  startup_mode: 'session', homepage: 'zephyr://newtab', search_engine: 'duckduckgo',
  download_dir: '', ask_download_path: false,
  adblock_enabled: true, netfilter_enabled: true, cosmetic_enabled: true, heuristic_cosmetic: true,
  strip_tracking_params: true, fp_canvas: true, fp_audio: true, fp_webgl: true, fp_navigator: true,
  block_malicious: true, do_not_track: true, block_thirdparty_js_cookies: true,
  geo_default: 'ask', notifications_default: 'ask', autoplay_default: 'block', camera_default: 'ask',
  password_autofill: true, weather_enabled: true,
  suspend_background_tabs: true, suspend_after_minutes: 15, max_live_webviews: 12,
  devtools_enabled: true, gestures_enabled: true, compat_ua: false,
};
const DEFAULT_BMS = [
  { url: 'https://www.google.com/', title: 'Google' },
  { url: 'https://www.youtube.com/', title: 'YouTube' },
  { url: 'https://mail.google.com/', title: 'Gmail' },
  { url: 'https://maps.google.com/', title: 'Maps' },
  { url: 'https://drive.google.com/', title: 'Drive' },
];

function smartUrl(input) {
  const s = (input || '').trim();
  if (!s) return 'zephyr://newtab';
  const lower = s.toLowerCase();
  if (lower.startsWith('zephyr://') || lower.startsWith('http://') || lower.startsWith('https://') ||
      lower.startsWith('file://') || lower.startsWith('about:') || lower.startsWith('view-source:')) return s;
  const first = s.split(/\s+/)[0];
  if (/^localhost/.test(first) || /^\d+\.\d+\.\d+\.\d+$/.test(first)) return 'http://' + first;
  if (!s.includes(' ') && s.includes('.')) {
    const host = s.split('/')[0].split('?')[0].split(':')[0];
    if (/^[a-z0-9.-]+$/i.test(host) && /^[a-z]{2,}$/i.test(host.split('.').pop() || '')) return 'https://' + s;
  }
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}

class Core {
  constructor() {
    this.tabs = [{ id: 1, kind: 'internal', url: 'zephyr://newtab', title: 'New Tab', favicon: null, pinned: false, muted: false, loading: false, suspended: false, canBack: false, canFwd: false, blocked: 0, active: true }];
    this.active = 0; this.nextId = 2; this.closed = [];
    this.prefs = { ...DEFAULT_PREFS };
    this.bookmarks = DEFAULT_BMS.map(b => ({ ...b }));
    this.history = []; this.downloads = [];
    this.stats = { ads: 12, trackers: 5, cosmetic: 30, params: 2 };
    // mirror the core: fresh profiles are seeded with the 5 design shortcuts
    this.shortcuts = [
      { id: 1, url: 'https://www.google.com/', title: 'Google', host: 'google.com' },
      { id: 2, url: 'https://www.youtube.com/', title: 'YouTube', host: 'youtube.com' },
      { id: 3, url: 'https://mail.google.com/', title: 'Gmail', host: 'mail.google.com' },
      { id: 4, url: 'https://maps.google.com/', title: 'Maps', host: 'maps.google.com' },
      { id: 5, url: 'https://drive.google.com/', title: 'Drive', host: 'drive.google.com' },
    ];
    this.overlayOpen = false; this.findOpen = false; this.maximized = false;
    this.log = [];
    this.surfaces = {};
    this.suggestItems = [];
  }

  async pushState() {
    await this.emitTo('chrome', 'state', this.statePayload());
  }
  statePayload() {
    const at = this.tabs[this.active];
    return {
      tabs: this.tabs.map((t, i) => ({
        id: t.id, title: t.title, url: t.url, favicon: t.favicon, pinned: t.pinned, muted: t.muted,
        loading: t.loading, suspended: t.suspended, zoom: 1,
        canBack: t.canBack, canFwd: t.canFwd, active: i === this.active,
        blocked: t.blocked, internal: t.kind === 'internal', kind: t.kind,
      })),
      active: this.active,
      activeUrl: at ? at.url : '', activeTitle: at ? at.title : '', activeBlocked: at ? at.blocked : 0,
      downloadsActive: this.downloads.some(d => d.status === 'active'),
      sessionStats: this.stats,
      prefs: this.prefs,
      serverBase: BASE,
      ntpUrl: 'zephyr://newtab',
      chromeReady: true,
      platform: process.platform === 'win32' ? 'windows' : 'linux',
      frameless: true, // simulate the Windows target
      maximized: this.maximized,
      profileName: 'Me',
    };
  }
  async emitTo(surface, ev, payload) {
    const page = this.surfaces[surface];
    if (!page) return;
    try { await page.evaluate(([e, p]) => { window.__zx && window.__zx.emit(e, p); }, [ev, payload]); } catch (e) {}
  }

  async handle(ns, cmd, data) {
    this.log.push({ ns, cmd, data });
    data = data || {};
    switch (cmd) {
      case 'hello': {
        if (this.bookmarks.length === 0) this.bookmarks = DEFAULT_BMS.map(b => ({ ...b }));
        await this.pushState();
        await this.sendBmData();
        break;
      }
      case 'bm-list': await this.sendBmData(); break;
      case 'chrome-height': this.chromeH = data.h; break;
      case 'nav': {
        const url = smartUrl(data.url);
        const t = this.tabs[this.active];
        if (t) { t.canBack = true; t.canFwd = false; t.url = url; t.title = url === 'zephyr://newtab' ? 'New Tab' : url; t.loading = true; }
        await this.pushState();
        await this.navigateContent(url);
        break;
      }
      case 'nav-new-tab': { await this.openTab(smartUrl(data.url)); break; }
      case 'nav-back': { const t = this.tabs[this.active]; if (t && t.canBack) { t.canBack = false; t.canFwd = true; t.url = 'zephyr://newtab'; t.title = 'New Tab'; await this.pushState(); await this.navigateContent('zephyr://newtab'); } break; }
      case 'nav-forward': { const t = this.tabs[this.active]; if (t && t.canFwd) { t.canFwd = false; t.canBack = true; t.url = 'https://example.com/'; t.title = 'Example'; await this.pushState(); await this.navigateContent('https://example.com/'); } break; }
      case 'nav-reload': { await this.navigateContent(this.tabs[this.active].url); break; }
      case 'nav-home': { const t = this.tabs[this.active]; t.url = 'zephyr://newtab'; t.title = 'New Tab'; await this.pushState(); await this.navigateContent('zephyr://newtab'); break; }
      case 'tab-new': await this.openTab('zephyr://newtab'); break;
      case 'tab-close': {
        const id = data.id || this.tabs[this.active].id;
        const idx = this.tabs.findIndex(t => t.id === id);
        if (idx >= 0) { this.closed.unshift({ url: this.tabs[idx].url, title: this.tabs[idx].title }); this.tabs.splice(idx, 1); }
        if (!this.tabs.length) { await this.openTab('zephyr://newtab'); break; }
        this.active = Math.min(this.active, this.tabs.length - 1);
        await this.pushState(); await this.syncContent();
        break;
      }
      case 'tab-activate': {
        const idx = this.tabs.findIndex(t => t.id === data.id);
        if (idx >= 0) { this.active = idx; await this.pushState(); await this.syncContent(); }
        break;
      }
      case 'tab-pin': { const t = this.tabs.find(t => t.id === data.id); if (t) t.pinned = data.pinned; await this.pushState(); break; }
      case 'tab-mute': { const t = this.tabs.find(t => t.id === data.id); if (t) t.muted = data.muted; await this.pushState(); break; }
      case 'tab-move': {
        const idx = this.tabs.findIndex(t => t.id === data.id);
        if (idx >= 0) {
          const activeId = this.tabs[this.active].id;
          const target = Math.max(0, Math.min(this.tabs.length - 1, data.index | 0));
          const [tab] = this.tabs.splice(idx, 1);
          this.tabs.splice(target, 0, tab);
          this.active = this.tabs.findIndex(t => t.id === activeId);
        }
        await this.pushState(); break;
      }
      case 'tab-suspend': break;
      case 'tab-close-others': {
        const keep = data.id;
        for (const t of this.tabs.filter(t => t.id !== keep)) { this.closed.unshift({ url: t.url, title: t.title }); }
        this.tabs = this.tabs.filter(t => t.id === keep);
        this.active = 0; await this.pushState();
        break;
      }
      case 'tab-duplicate': { const t = this.tabs.find(t => t.id === data.id); if (t) await this.openTab(t.url); break; }
      case 'tab-restore-closed': { const c = this.closed.shift(); if (c) await this.openTab(c.url); break; }
      case 'addr-query': {
        const q = (data.q || '').toLowerCase();
        this.suggestItems = [];
        if (q) {
          this.suggestItems.push({ kind: 'search', title: q, url: 'https://duckduckgo.com/?q=' + encodeURIComponent(q), host: 'duckduckgo.com' });
          for (const b of this.bookmarks) if (b.title.toLowerCase().includes(q)) this.suggestItems.push({ kind: 'bookmark', title: b.title, url: b.url, host: b.url.replace(/^https?:\/\//, '').split('/')[0] });
          for (const h of this.history) if (h.title.toLowerCase().includes(q)) this.suggestItems.push({ kind: 'history', title: h.title, url: h.url, host: h.url.replace(/^https?:\/\//, '').split('/')[0] });
        }
        await this.emitTo('chrome', 'suggest', { q, items: this.suggestItems, sel: -1 });
        break;
      }
      case 'bm-toggle': case 'bm-add': {
        const at = this.tabs[this.active];
        const url = data.url || (at && at.url);
        const title = data.title || (at && at.title) || url;
        const existing = this.bookmarks.find(b => b.url === url);
        if (existing) this.bookmarks = this.bookmarks.filter(b => b !== existing);
        else this.bookmarks.push({ url, title });
        await this.sendBmData(); await this.pushState();
        break;
      }
      case 'bm-remove': { this.bookmarks = this.bookmarks.filter(b => b.url !== data.url); await this.sendBmData(); break; }
      case 'prefs-set': {
        const k = data.key; let v = data.value;
        if (typeof v === 'string') { if (v === '1') v = true; else if (v === '0') v = false; }
        this.prefs[k] = v;
        await this.pushState();
        await this.emitTo('chrome', 'prefs-changed', { key: k, value: v });
        break;
      }
      case 'prefs-get': await this.emitTo('content', 'prefs-data', this.prefs); break; // only internal pages send prefs-get; requester routing (push_to_requester)
      // ---- internal pages (ns is 'chrome' from pages.js — route replies to content webview)
      case 'page-hello': {
        if (data.page === 'settings') {
          await this.emitTo('content', 'prefs-data', this.prefs);
          await this.emitTo('content', 'search-engines', { items: [{ key: 'duckduckgo', name: 'DuckDuckGo' }, { key: 'google', name: 'Google' }, { key: 'bing', name: 'Bing' }, { key: 'brave', name: 'Brave' }] });
          await this.emitTo('content', 'lists-data', { items: [{ name: 'Zephyr EasyList', url: 'https://zephyr.local/easylist.txt', kind: 'ads', builtin: true, enabled: true, lastUpdated: 0, ruleCount: 64102 }, { name: 'EasyPrivacy', url: 'https://zephyr.local/easyprivacy.txt', kind: 'trackers', builtin: true, enabled: true, lastUpdated: 0, ruleCount: 52110 }], totalRules: 116212 });
          await this.emitTo('content', 'dl-dir', { dir: this.prefs.download_dir || '' });
        }
        break;
      }
      case 'search-engines': await this.emitTo('content', 'search-engines', { items: [{ key: 'duckduckgo', name: 'DuckDuckGo' }, { key: 'google', name: 'Google' }, { key: 'bing', name: 'Bing' }, { key: 'brave', name: 'Brave' }] }); break;
      case 'lists-list': await this.emitTo('content', 'lists-data', { items: [], totalRules: 0 }); break;
      case 'perm-list': await this.emitTo('content', 'perm-data', { items: [] }); break;
      case 'pw-list': await this.emitTo('content', 'pw-data', { items: [], autofill: this.prefs.password_autofill }); break;
      case 'hist-list': await this.emitTo('content', 'hist-data', { items: this.history.map(h => ({ id: 1, url: h.url, title: h.title, lastVisit: Date.now(), count: 1 })) }); break;
      case 'dl-list': await this.emitTo('content', 'dl-data', { items: [] }); break;
      case 'stats-get': await this.emitTo('content', 'stats', { session: this.stats, today: { ads: 40, trackers: 18, cosmetic: 90, params: 5 }, activeHost: '', layers: this.prefs }); break;
      // window controls
      case 'win-min': this.minimized = true; break;
      case 'win-max-toggle': this.maximized = !this.maximized; await this.emitTo('chrome', 'win-state', { maximized: this.maximized }); break;
      case 'win-close': this.closeRequested = true; break;
      case 'win-drag': this.dragged = true; break;
      case 'win-resize': this.resized = (this.resized || []).concat([data.dir]); break;
      // overlay
      case 'overlay-open': {
        this.overlayOpen = true;
        await this.emitTo('overlay', 'popup-open', { kind: data.kind, x: data.x, y: data.y, w: data.w, payload: data.payload, theme: this.prefs.theme });
        break;
      }
      case 'overlay-close': {
        // from chrome (Esc / explicit close): clear the overlay too
        this.overlayOpen = false;
        await this.emitTo('overlay', 'popup-hide', {});
        break;
      }
      case 'overlay-hide': {
        // from overlay itself: do NOT echo popup-hide back (would loop);
        // just inform chrome the popup is gone
        this.overlayOpen = false;
        await this.emitTo('chrome', 'popup-closed', {});
        break;
      }
      case 'overlay-need': this.overlayOpen = !!data.on; break;
      // find
      case 'find-open': this.findOpen = true; await this.emitTo('find', 'theme', { theme: this.prefs.theme }); break;
      case 'find-query': this.findQuery = data.q; break;
      case 'find-next': case 'find-prev': this.findNav = cmd; break;
      case 'find-close': this.findOpen = false; break;
      // ntp
      case 'ntp-data': {
        await this.emitTo('content', 'ntp-data', {
          topSites: [{ host: 'example.com', url: 'https://example.com/', title: 'Example', color: '#4b7bec', visits: 4 }],
          shortcuts: this.shortcuts,
          stats: this.stats,
          searchEngine: this.prefs.search_engine,
          defaults: [
            { url: 'https://www.google.com/', label: 'Google' },
            { url: 'https://www.youtube.com/', label: 'YouTube' },
            { url: 'https://mail.google.com/', label: 'Gmail' },
            { url: 'https://drive.google.com/', label: 'Drive' },
          ],
          serverBase: BASE,
          weather: { err: 'offline' },
        });
        break;
      }
      case 'shortcut-add': { this.shortcuts.push({ id: this.shortcuts.length + 2, url: smartUrl(data.url), title: data.title || data.url, host: (data.url || '').replace(/^https?:\/\//, '').split('/')[0] }); break; }
      case 'shortcut-remove': { this.shortcuts = this.shortcuts.filter(s => s.id !== data.id); break; }
      case 'weather': { await this.emitTo('content', 'weather-data', { weather: { err: 'offline' } }); break; }
      case 'perm-answer': { this.permAnswered = { reqId: data.reqId, allow: data.allow }; break; }
      case 'pw-save-confirm': case 'pw-save-dismiss': { this.pwAnswered = cmd; break; }
      // credential / permission prompts: core → chrome webview → app.js relays to overlay
      case 'pw-prompt': await this.emitTo('chrome', 'pw-prompt', data); break;
      case 'perm-prompt': await this.emitTo('chrome', 'perm-prompt', data); break;
      case 'zoom-inc': case 'zoom-dec': case 'zoom-reset': case 'fullscreen': case 'print-page': case 'save-page':
      case 'view-source': case 'devtools': case 'session-save': this.voidCmd = cmd; break;
      case 'hist-clear': this.history = []; break;
      case 'dl-clear': this.downloads = []; break;
      case 'clear-data': this.lastClearData = data; break;
      default: this.unhandled = (this.unhandled || []).concat([cmd]);
    }
  }

  async sendBmData() {
    await this.emitTo('chrome', 'bm-data', { items: this.bookmarks.map(b => ({ url: b.url, title: b.title })) });
  }
  async openTab(url) {
    this.tabs.push({ id: this.nextId++, kind: url.startsWith('zephyr://') ? 'internal' : 'content', url, title: url === 'zephyr://newtab' ? 'New Tab' : url, favicon: null, pinned: false, muted: false, loading: false, suspended: false, canBack: false, canFwd: false, blocked: 0, active: true });
    this.active = this.tabs.length - 1;
    await this.pushState();
    await this.syncContent();
  }
  resolveUrl(url) {
    if (url === 'zephyr://newtab') return BASE + '/ntp/index.html';
    if (url === 'zephyr://settings') return BASE + '/pages/settings.html';
    if (url === 'zephyr://bookmarks') return BASE + '/pages/bookmarks.html';
    if (url === 'zephyr://history') return BASE + '/pages/history.html';
    if (url === 'zephyr://downloads') return BASE + '/pages/downloads.html';
    if (url === 'zephyr://privacy') return BASE + '/pages/privacy.html';
    return url;
  }
  async navigateContent(url) {
    const page = this.surfaces.content;
    const r = this.resolveUrl(url);
    if (page && r.startsWith('http')) {
      try { await page.goto(r, { waitUntil: 'load' }); } catch (e) {}
      const cur = this.tabs[this.active];
      await page.evaluate((id) => { window.__ZX_TAB = id; }, cur ? cur.id : 0).catch(() => {});
    }
    const t = this.tabs[this.active];
    if (t) { t.loading = false; await this.pushState(); }
  }
  async syncContent() {
    const t = this.tabs[this.active];
    if (t) await this.navigateContent(t.url);
  }
}

// ---------------------------------------------------------------- ipc shims
const IPC_SHIM = (surface) => `
  window.__ipcCalls = [];
  window.ipc = {
    postMessage: function (raw) {
      window.__ipcCalls.push(raw);
      window.__surface && window.__surface(${JSON.stringify(surface)}, raw);
    }
  };
`;

async function newSurface(browser, ctx, url, surface, onIpc) {
  const page = await ctx.newPage();
  await page.addInitScript(IPC_SHIM(surface));
  await page.addInitScript(`
    window.addEventListener('error', function (e) {
      window.__jsErrors = (window.__jsErrors || []).concat([String(e.message)]);
    });
  `);
  await page.exposeFunction('__surface', (surf, raw) => { onIpc(surf, raw); });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

// ---------------------------------------------------------------- assertions
const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail || '' });
  console.log((cond ? '  PASS ' : '  FAIL ') + name + (cond ? '' : '  → ' + (detail || '')));
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const core = new Core();

  const onIpc = (surface, raw) => {
    let msg; try { msg = JSON.parse(raw); } catch (e) { return; }
    if (process.env.DEBUG_IPC) console.log(`IPC[${surface}]> ${msg.cmd}`);
    core.handle(msg.ns, msg.cmd, msg.data || {});
  };

  const chrome = await newSurface(browser, ctx, BASE + '/ui/index.html', 'chrome', onIpc);
  const overlay = await newSurface(browser, ctx, BASE + '/ui/overlay.html', 'overlay', onIpc);
  const find = await newSurface(browser, ctx, BASE + '/find/find.html', 'find', onIpc);
  const content = await newSurface(browser, ctx, BASE + '/ntp/index.html', 'content', onIpc);
  core.surfaces = { chrome, overlay, find, content };
  await sleep(700);
  // replay the boot handshake now that all surfaces are wired (the real core
  // receives 'hello' while pages are already connected)
  await core.handle('chrome', 'hello', {});
  await core.handle('chrome', 'bm-list', {});
  await sleep(400);

  const shot = (name) => `/home/z/shots/${name}.png`;

  // ================================================================ chrome basics
  console.log('\n== chrome layout & tabs ==');
  const stripBg = await chrome.evaluate(() => getComputedStyle(document.getElementById('tabstrip')).backgroundColor);
  check('tabstrip is light gray (design)', stripBg === 'rgb(222, 227, 232)', stripBg);
  const theme = await chrome.evaluate(() => document.getElementById('chrome').dataset.theme);
  check('default theme light', theme === 'light', theme);
  const winCtrlVisible = await chrome.evaluate(() => !document.getElementById('win-controls').classList.contains('hidden'));
  check('window controls visible (frameless Windows)', winCtrlVisible);
  const h = await chrome.evaluate(() => {
    const s = document.getElementById('tabstrip').offsetHeight + document.getElementById('toolbar').offsetHeight +
      (document.getElementById('bookmarksbar').classList.contains('hidden') ? 0 : document.getElementById('bookmarksbar').offsetHeight);
    return s;
  });
  check('chrome reports true height (tabstrip+toolbar+bmbar)', core.chromeH === h, `core=${core.chromeH} dom=${h}`);
  check('chrome height includes bookmarks bar (no overlap)', h >= 118, h);

  // tabs
  await chrome.click('#newtab');
  await sleep(250);
  check('new tab button creates tab', core.tabs.length === 2, JSON.stringify(core.tabs.map(t => t.url)));
  const tabCount = await chrome.evaluate(() => document.querySelectorAll('.tab').length);
  check('tab strip renders 2 tabs', tabCount === 2, tabCount);
  await chrome.click('#newtab');
  await sleep(250);
  const thirdTabId = core.tabs[2].id;
  await chrome.click(`.tab[data-id="${thirdTabId}"] .close`);
  await sleep(250);
  check('tab close button closes tab', core.tabs.length === 2, core.tabs.length);
  await chrome.evaluate((id) => { document.querySelector(`.tab[data-id="${id}"]`).click(); }, String(core.tabs[0].id));
  await sleep(200);
  check('clicking tab activates it', core.tabs[core.active].id === core.tabs[0].id);
  await chrome.keyboard.press('Control+t');
  await sleep(200);
  check('Ctrl+T opens tab', core.tabs.length === 3, core.tabs.length);
  await chrome.keyboard.press('Control+w');
  await sleep(200);
  check('Ctrl+W closes tab', core.tabs.length === 2, core.tabs.length);
  await chrome.keyboard.press('Control+t');
  await sleep(250);
  const midId = core.tabs[core.active].id;
  await chrome.evaluate((id) => {
    const el = document.querySelector(`.tab[data-id="${id}"]`);
    el.dispatchEvent(new MouseEvent('mousedown', { button: 1, bubbles: true }));
  }, String(midId));
  await sleep(250);
  check('middle-click closes tab', core.tabs.length === 2, core.tabs.length);

  // ================================================================ toolbar buttons
  console.log('\n== toolbar ==');
  await chrome.evaluate(() => { document.getElementById('nav-back').click(); });
  await sleep(150);
  check('back button navigates back', core.tabs[core.active].url === 'zephyr://newtab');
  const homeHidden = await chrome.evaluate(() => document.getElementById('nav-home').classList.contains('visible') === false);
  check('home button hidden by default (design)', homeHidden);
  await chrome.evaluate(() => { document.getElementById('nav-reload').click(); });
  check('reload button issues reload', core.log.some(l => l.cmd === 'nav-reload'));
  await chrome.click('#url-input');
  await chrome.fill('#url-input', 'example.org');
  await chrome.press('#url-input', 'Enter');
  await sleep(350);
  check('omnibox navigates (smart URL)', core.tabs[core.active].url === 'https://example.org', core.tabs[core.active].url);
  await chrome.click('#url-input');
  await chrome.fill('#url-input', 'goo');
  await sleep(400);
  check('typing opens suggestion popup in overlay', core.overlayOpen === true && core.suggestItems.length > 0, `open=${core.overlayOpen} items=${core.suggestItems.length}`);
  const sugVisible = await overlay.evaluate(() => !!document.querySelector('.sug-item'));
  check('overlay renders suggestion items', sugVisible);
  await overlay.click('.sug-item');
  await sleep(300);
  check('clicking suggestion navigates', (core.tabs[core.active].url || '').includes('duckduckgo.com') || core.overlayOpen === false, core.tabs[core.active].url);
  await chrome.evaluate(() => { document.getElementById('bm-star').click(); });
  await sleep(250);
  const bookmarked = core.bookmarks.some(b => b.url === core.tabs[core.active].url);
  check('star bookmarks current page', bookmarked);
  const starActive = await chrome.evaluate(() => document.getElementById('bm-star').classList.contains('active'));
  check('star shows active state', starActive);
  await chrome.evaluate(() => { document.getElementById('bm-star').click(); });
  await sleep(250);
  check('star toggles bookmark off', !core.bookmarks.some(b => b.url === core.tabs[core.active].url));

  // ================================================================ bookmarks bar
  console.log('\n== bookmarks bar ==');
  const bmVisible = await chrome.evaluate(() => !document.getElementById('bookmarksbar').classList.contains('hidden'));
  check('bookmarks bar visible by default (design)', bmVisible);
  const bmTexts = await chrome.evaluate(() => [...document.querySelectorAll('.bm-item')].map(e => e.textContent.trim()));
  check('bookmarks bar shows default shortcuts', ['Google', 'YouTube', 'Gmail', 'Maps', 'Drive'].every(t => bmTexts.some(x => x.includes(t))), JSON.stringify(bmTexts));
  const brandImgs = await chrome.evaluate(() => [...document.querySelectorAll('.bm-item img')].length);
  check('brand favicons render in bar', brandImgs >= 5, brandImgs);
  await chrome.evaluate(() => { [...document.querySelectorAll('.bm-item')].find(e => e.textContent.includes('YouTube')).click(); });
  await sleep(300);
  check('bookmark click navigates', core.tabs[core.active].url.includes('youtube.com'), core.tabs[core.active].url);
  for (const [url, title] of [['https://news.ycombinator.com/', 'Hacker News'], ['https://github.com/', 'GitHub'], ['https://z.ai/', 'Z.ai'], ['https://rust-lang.org/', 'Rust'], ['https://sqlite.org/', 'SQLite'], ['https://openbsd.org/', 'OpenBSD'], ['https://debian.org/', 'Debian'], ['https://kernel.org/', 'kernel.org'], ['https://gnu.org/', 'GNU']]) {
    await core.handle('chrome', 'bm-add', { url, title });
  }
  await sleep(200);
  const folderBtn = await chrome.evaluate(() => !!document.querySelector('.bm-item.folder'));
  check('Other Bookmarks folder appears with >12 bookmarks', folderBtn);
  if (folderBtn) {
    await chrome.evaluate(() => { document.querySelector('.bm-item.folder').click(); });
    await sleep(300);
    const folderPopup = await overlay.evaluate(() => [...document.querySelectorAll('.menu-item span')].map(e => e.textContent));
    check('folder popup lists overflow bookmarks', folderPopup.some(t => t.includes('kernel.org')), JSON.stringify(folderPopup.slice(0, 4)));
    await overlay.click('#backdrop');
    await sleep(200);
    check('backdrop click closes popup', core.overlayOpen === false);
  }

  // ================================================================ menus & panels (overlay)
  console.log('\n== menu / panels ==');
  await chrome.evaluate(() => { document.getElementById('menu-btn').click(); });
  await sleep(300);
  const menuItems = await overlay.evaluate(() => [...document.querySelectorAll('.menu-item')].map(e => e.dataset.cmd));
  const expected = ['tab-new', 'win-new', 'open-history', 'open-downloads', 'open-bookmarks', 'open-passwords', 'open-privacy', 'save-page', 'print-page', 'find-open', 'fullscreen', 'view-source', 'devtools', 'open-settings', 'open-about'];
  check('main menu has all commands wired', expected.every(c => menuItems.includes(c)), JSON.stringify(menuItems));
  const zoomRow = await overlay.evaluate(() => {
    const row = document.querySelector('.zoom-row');
    return row ? { pct: row.querySelector('.zv').textContent, btns: row.querySelectorAll('.zb').length } : null;
  });
  check('menu shows zoom stepper row', zoomRow && zoomRow.pct === '100%' && zoomRow.btns === 2, JSON.stringify(zoomRow));
  // real user clicks produce mousedown — overlay popups act on mousedown
  await overlay.click('.menu-item[data-cmd="open-settings"]');
  await sleep(400);
  check('menu → Settings navigates content', core.tabs[core.active].url === 'zephyr://settings', core.tabs[core.active].url);
  check('menu click closes popup', core.overlayOpen === false);

  // reopen menu and exercise the delete-data dialog end-to-end
  await chrome.evaluate(() => { document.getElementById('menu-btn').click(); });
  await sleep(250);
  await overlay.click('.menu-item[data-cmd="open-cleardata"]');
  await sleep(250);
  check('delete browsing data dialog opens', await overlay.evaluate(() => !!document.querySelector('.cleardata')));
  await overlay.click('.cd-row[data-cd="downloads"]');
  await overlay.click('.cd-row[data-cd="permissions"]');
  await overlay.click('[data-cdok]');
  await sleep(250);
  check('clear-data sent with toggled flags', core.lastClearData && core.lastClearData.downloads === true && core.lastClearData.history === true, JSON.stringify(core.lastClearData));

  await chrome.evaluate(() => { document.getElementById('ext-btn').click(); });
  await sleep(300);
  const switches = await overlay.evaluate(() => [...document.querySelectorAll('.switch[data-key]')].map(e => e.dataset.key));
  check('protection panel lists all layers', ['adblock_enabled', 'fp_canvas', 'do_not_track'].every(k => switches.includes(k)), JSON.stringify(switches));
  const before = core.prefs.fp_canvas;
  await overlay.click('.switch[data-key="fp_canvas"]');
  await sleep(300);
  check('protection toggle flips pref', core.prefs.fp_canvas === !before, `${before}→${core.prefs.fp_canvas}`);
  await overlay.click('#backdrop');
  await sleep(150);

  await chrome.evaluate(() => { document.getElementById('profile-btn').click(); });
  await sleep(300);
  const profileItems = await overlay.evaluate(() => [...document.querySelectorAll('.menu-item')].map(e => e.dataset.cmd));
  check('profile menu opens with entries', profileItems.includes('open-passwords') && profileItems.includes('open-settings'), JSON.stringify(profileItems));
  await overlay.click('#backdrop');
  await sleep(150);

  await core.handle('chrome', 'nav', { url: 'https://example.com/' });
  await sleep(300);
  await chrome.evaluate(() => { document.getElementById('sec-icon').click(); });
  await sleep(300);
  const siteInfo = await overlay.evaluate(() => ({ t: document.querySelector('.si-t') && document.querySelector('.si-t').textContent, chips: document.querySelectorAll('.si-chip').length }));
  check('site info popup shows security state', siteInfo.t && siteInfo.chips >= 1, JSON.stringify(siteInfo));
  await overlay.click('#backdrop');
  await sleep(150);

  core.tabs[core.active].blocked = 7;
  await core.pushState();
  await sleep(200);
  const badgeVisible = await chrome.evaluate(() => {
    const b = document.getElementById('ext-badge');
    return b && !b.classList.contains('hidden') && b.textContent.length > 0;
  });
  check('protection badge shows blocked count', badgeVisible);
  await chrome.evaluate(() => { document.getElementById('ext-btn').click(); });
  await sleep(250);
  await overlay.click('.menu-item[data-cmd="open-privacy"]');
  await sleep(300);
  check('privacy entry opens dashboard', core.tabs[core.active].url === 'zephyr://privacy', core.tabs[core.active].url);

  // ================================================================ window controls & drag
  console.log('\n== window controls ==');
  await chrome.evaluate(() => { document.getElementById('win-max').click(); });
  await sleep(150);
  check('maximize button toggles state', core.maximized === true);
  await chrome.evaluate(() => { document.getElementById('win-min').click(); });
  check('minimize button issues minimize', core.minimized === true);
  await chrome.evaluate(() => {
    const ds = document.getElementById('drag-strip');
    const r = ds.getBoundingClientRect();
    // centre of the strip — away from the 6px window-edge resize zones
    ds.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, detail: 1, clientX: r.left + Math.max(10, r.width / 2), clientY: r.top + r.height / 2 }));
  });
  check('drag strip initiates window drag', core.dragged === true);
  await chrome.evaluate(() => { document.getElementById('win-close').click(); });
  await sleep(100);
  check('close button requests window close', core.closeRequested === true);

  // ================================================================ find bar
  console.log('\n== find bar ==');
  await core.handle('chrome', 'find-open', {});
  await sleep(200);
  check('find-open shows find bar', core.findOpen === true);
  await find.fill('#find-input', 'privacy');
  await sleep(150);
  check('find typing emits find-query', core.findQuery === 'privacy', core.findQuery);
  await find.click('#find-next');
  check('find next button works', core.findNav === 'find-next');
  await find.click('#find-close');
  await sleep(100);
  check('find close button hides bar', core.findOpen === false);

  // ================================================================ NTP
  console.log('\n== new tab page ==');
  await core.handle('chrome', 'nav', { url: 'zephyr://newtab' });
  await sleep(500);
  const greeting = await content.evaluate(() => document.getElementById('greeting').textContent);
  check('NTP greeting is real (time-based)', /Good (morning|afternoon|evening|night)/.test(greeting), greeting);
  const clock = await content.evaluate(() => document.getElementById('clock').textContent);
  check('NTP clock shows real time (12h)', /^\d{1,2}:\d{2} (AM|PM)$/.test(clock), clock);
  const date = await content.evaluate(() => document.getElementById('date').textContent);
  check('NTP date is real', /\d{4}/.test(date), date);
  const ntpBg = await content.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('NTP background matches design (light)', ntpBg === 'rgb(251, 251, 252)', ntpBg);
  const tiles = await content.evaluate(() => [...document.querySelectorAll('.tile .lbl')].map(e => e.textContent));
  check('NTP shows Google/YouTube/Gmail/Drive/Add shortcut tiles', ['Google', 'YouTube', 'Gmail', 'Drive', 'Add shortcut'].every(t => tiles.includes(t)), JSON.stringify(tiles));
  const weatherHidden = await content.evaluate(() => document.getElementById('weather').classList.contains('hidden'));
  check('weather hides gracefully when offline', weatherHidden);
  await content.fill('#q', 'rust programming');
  await content.press('#q', 'Enter');
  await sleep(300);
  check('NTP search submits via smart URL', core.tabs[core.active].url.includes('duckduckgo.com'), core.tabs[core.active].url);
  await core.handle('chrome', 'nav', { url: 'zephyr://newtab' });
  await sleep(400);
  await content.evaluate(() => { [...document.querySelectorAll('.tile')].find(t => t.textContent.includes('Google')).click(); });
  await sleep(300);
  check('NTP tile opens site', core.tabs[core.active].url.includes('google.com'), core.tabs[core.active].url);
  await core.handle('chrome', 'nav', { url: 'zephyr://newtab' });
  await sleep(400);
  await content.evaluate(() => { document.querySelector('#add-shortcut').click(); });
  await sleep(150);
  const dlgShown = await content.evaluate(() => !document.getElementById('dlg').classList.contains('hidden'));
  check('Add shortcut opens in-page dialog (no broken JS prompt)', dlgShown);
  await content.fill('#dlg-name', 'Lobsters');
  await content.fill('#dlg-url', 'lobste.rs');
  await content.evaluate(() => { document.getElementById('dlg-ok').click(); });
  await sleep(400);
  check('shortcut dialog persists shortcut', core.shortcuts.some(s => (s.url || '').includes('lobste.rs')), JSON.stringify(core.shortcuts));
  await content.evaluate(() => { document.getElementById('gear').click(); });
  await sleep(300);
  check('NTP gear opens settings', core.tabs[core.active].url === 'zephyr://settings', core.tabs[core.active].url);

  // ================================================================ internal pages
  console.log('\n== internal pages ==');
  await core.handle('chrome', 'nav', { url: 'zephyr://settings' });
  await sleep(600);
  const setBg = await content.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('settings page uses light design', setBg === 'rgb(251, 251, 252)', setBg);
  const swBefore = await content.evaluate(() => { const el = document.querySelectorAll('.switch[data-key="show_bookmarks_bar"]')[0]; return el ? el.classList.contains('on') : null; });
  check('settings bookmarks-bar switch exists', swBefore !== null);
  if (swBefore !== null) {
    await content.evaluate(() => { document.querySelectorAll('.switch[data-key="show_bookmarks_bar"]')[0].click(); });
    await sleep(300);
    const swAfter = await content.evaluate(() => { const el = document.querySelectorAll('.switch[data-key="show_bookmarks_bar"]')[0]; return el.classList.contains('on'); });
    check('settings toggle fires prefs-set + updates UI', swAfter !== swBefore, `${swBefore}→${swAfter}`);
    const bmBarGone = await chrome.evaluate(() => document.getElementById('bookmarksbar').classList.contains('hidden'));
    check('bookmarks bar toggle reaches the chrome', bmBarGone === swBefore);
    await content.evaluate(() => { document.querySelectorAll('.switch[data-key="show_bookmarks_bar"]')[0].click(); });
    await sleep(250);
  }
  for (const p of ['zephyr://history', 'zephyr://downloads', 'zephyr://bookmarks', 'zephyr://privacy']) {
    await core.handle('chrome', 'nav', { url: p });
    await sleep(450);
    const ok = await content.evaluate(() => document.body.innerText.length > 10 && !document.body.innerText.includes('404'));
    check(`${p} renders`, ok);
    const light = await content.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`${p} light theme`, light === 'rgb(251, 251, 252)', light);
  }

  // ================================================================ layout overlap checks
  console.log('\n== layout integrity (overlaps) ==');
  await core.handle('chrome', 'nav', { url: 'zephyr://newtab' });
  await sleep(300);
  const overlap = await chrome.evaluate(() => {
    const ids = ['nav-back', 'nav-fwd', 'nav-reload', 'omnibox', 'bm-star', 'ext-btn', 'profile-btn', 'menu-btn', 'newtab'];
    const rects = ids.map(id => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return { id, l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    const bad = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      // containment = parent/child relationship, not an overlap defect
      const aInB = a.l >= b.l - 1 && a.r <= b.r + 1 && a.t >= b.t - 1 && a.b <= b.b + 1;
      const bInA = b.l >= a.l - 1 && b.r <= a.r + 1 && b.t >= a.t - 1 && b.b <= a.b + 1;
      if (aInB || bInA) continue;
      const overlapW = Math.min(a.r, b.r) - Math.max(a.l, b.l);
      const overlapH = Math.min(b.b, a.b) - Math.max(a.t, b.t);
      if (overlapW > 1 && overlapH > 1) bad.push([a.id, b.id]);
    }
    return bad;
  });
  check('no toolbar controls overlap', overlap.length === 0, JSON.stringify(overlap));
  const noHScroll = await chrome.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  check('chrome has no horizontal overflow', noHScroll);
  for (let i = 0; i < 8; i++) await core.handle('chrome', 'tab-new', {});
  await sleep(350);
  const stripOk = await chrome.evaluate(() => {
    const tabs = document.getElementById('tabs');
    const fits = tabs.scrollWidth <= tabs.clientWidth + 2;
    const controls = document.getElementById('win-controls').getBoundingClientRect();
    const lastTab = [...document.querySelectorAll('.tab')].pop();
    const t = lastTab ? lastTab.getBoundingClientRect() : { right: 0 };
    return { fits, clearOfControls: t.right <= controls.left + 2 };
  });
  check('many tabs: strip scrolls, no overlap with controls', stripOk.fits && stripOk.clearOfControls, JSON.stringify(stripOk));
  const barOk = await chrome.evaluate(() => {
    const bar = document.getElementById('bookmarksbar');
    const tb = document.getElementById('toolbar').getBoundingClientRect();
    const bb = bar.getBoundingClientRect();
    return bb.top >= tb.bottom - 1;
  });
  check('bookmarks bar sits below toolbar (no overlap)', barOk);

  // ================================================================ prompts (pw/perm) via overlay
  console.log('\n== prompts ==');
  await core.handle('chrome', 'pw-prompt', { origin: 'example.com', username: 'sam', tab: 1 });
  await sleep(250);
  const pwShown = await overlay.evaluate(() => !!document.querySelector('[data-act="pw-save"]'));
  check('password save prompt renders', pwShown);
  await overlay.click('[data-act="pw-save"]');
  await sleep(200);
  check('pw save button answers core', core.pwAnswered === 'pw-save-confirm', String(core.pwAnswered));
  await core.handle('chrome', 'perm-prompt', { origin: 'maps.example.com', kind: 'geolocation', reqId: 42 });
  await sleep(250);
  await overlay.click('[data-act="perm-allow"]');
  await sleep(200);
  check('permission allow answers core', core.permAnswered && core.permAnswered.allow === true && core.permAnswered.reqId === 42, JSON.stringify(core.permAnswered));

  // ================================================================ health + screenshots
  console.log('\n== health ==');
  for (const [name, page] of [['chrome', chrome], ['overlay', overlay], ['find', find], ['content', content]]) {
    const errs = await page.evaluate(() => window.__jsErrors || []);
    check(`${name} surface: no JS errors`, errs.length === 0, JSON.stringify(errs));
  }
  check('no unhandled IPC commands', !core.unhandled || core.unhandled.length === 0, JSON.stringify(core.unhandled || []));

  console.log('\n== screenshots ==');
  await core.handle('chrome', 'tab-activate', { id: core.tabs[0].id });
  await core.handle('chrome', 'nav', { url: 'zephyr://newtab' });
  await sleep(600);
  await chrome.screenshot({ path: shot('v2-chrome-light') });
  await content.screenshot({ path: shot('v2-ntp') });
  await chrome.evaluate(() => { document.getElementById('menu-btn').click(); });
  await sleep(400);
  await chrome.screenshot({ path: shot('v2-menu') });
  await overlay.click('#backdrop');
  await sleep(200);
  await core.handle('chrome', 'nav', { url: 'zephyr://settings' });
  await sleep(600);
  await content.screenshot({ path: shot('v2-settings') });
  await core.handle('chrome', 'nav', { url: 'zephyr://privacy' });
  await sleep(600);
  await content.screenshot({ path: shot('v2-privacy') });
  await core.handle('chrome', 'prefs-set', { key: 'theme', value: 'dark' });
  await core.handle('chrome', 'nav', { url: 'zephyr://newtab' });
  await sleep(500);
  await chrome.screenshot({ path: shot('v2-chrome-dark') });

  await browser.close();
  srv.close();

  const fails = results.filter(r => !r.ok);
  console.log(`\n========================\nTOTAL: ${results.length}  PASS: ${results.length - fails.length}  FAIL: ${fails.length}`);
  if (fails.length) {
    console.log('FAILED:');
    fails.forEach(f => console.log(' - ' + f.name + (f.detail ? ' (' + f.detail + ')' : '')));
  }
  fs.writeFileSync('/home/z/shots/ui-report.json', JSON.stringify({ results, fails: fails.length, total: results.length }, null, 2));
  process.exit(fails.length ? 1 : 0);
}

main().catch(e => { console.error('HARNESS ERROR:', e); process.exit(2); });
