// Zephyr visual capture — renders the SHIPPING UI assets in real browser
// surfaces (chrome / content / overlay), drives them into comparison states
// through the same IPC contract as the Rust core, and screenshots each layer
// for window composition (chrome top + content below + overlay on top).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'assets');
const PORT = 18393;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = '/home/z/shots/zeph';
const WIN_W = 1280, WIN_H = 820;

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      const marks = ['/ui/', '/ntp/', '/pages/', '/find/', '/img/', '/content/'];
      for (const m of marks) { const i = p.indexOf(m); if (i > 0) { p = p.slice(i); break; } }
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('nope'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
      res.end(fs.readFileSync(file));
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

const DEFAULT_PREFS = {
  theme: 'light', accent: '#4b7bec', density: 'normal', show_home_button: false,
  show_bookmarks_bar: true, search_engine: 'duckduckgo', adblock_enabled: true,
  weather_enabled: true, download_dir: '', suspend_background_tabs: true,
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
  if (lower.startsWith('zephyr://') || lower.startsWith('http://') || lower.startsWith('https://')) return s;
  const first = s.split(/\s+/)[0];
  if (/^localhost/.test(first) || /^\d+\.\d+\.\d+\.\d+$/.test(first)) return 'http://' + first;
  if (!s.includes(' ') && s.includes('.')) return 'https://' + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}

class Core {
  constructor() {
    this.tabs = [{ id: 1, kind: 'internal', url: 'zephyr://newtab', title: 'New Tab', favicon: null, pinned: false, muted: false, loading: false, suspended: false, canBack: false, canFwd: false, blocked: 7, active: true }];
    this.active = 0; this.nextId = 2;
    this.prefs = { ...DEFAULT_PREFS };
    this.bookmarks = DEFAULT_BMS.map(b => ({ ...b }));
    this.history = [{ title: 'Example Domain', url: 'https://example.com/' }];
    this.stats = { ads: 12, trackers: 5, cosmetic: 30, params: 2 };
    this.shortcuts = [
      { id: 1, url: 'https://www.google.com/', title: 'Google', host: 'google.com' },
      { id: 2, url: 'https://www.youtube.com/', title: 'YouTube', host: 'youtube.com' },
      { id: 3, url: 'https://mail.google.com/', title: 'Gmail', host: 'mail.google.com' },
      { id: 4, url: 'https://maps.google.com/', title: 'Maps', host: 'maps.google.com' },
      { id: 5, url: 'https://drive.google.com/', title: 'Drive', host: 'drive.google.com' },
    ];
    this.surfaces = {}; this.suggestItems = []; this.chromeH = 118; this.maximized = false;
  }
  statePayload() {
    const at = this.tabs[this.active];
    return {
      tabs: this.tabs.map((t, i) => ({ id: t.id, title: t.title, url: t.url, favicon: t.favicon, pinned: t.pinned, muted: t.muted, loading: t.loading, suspended: t.suspended, zoom: 1, canBack: t.canBack, canFwd: t.canFwd, active: i === this.active, blocked: t.blocked, internal: t.kind === 'internal', kind: t.kind })),
      active: this.active, activeUrl: at ? at.url : '', activeTitle: at ? at.title : '', activeBlocked: at ? at.blocked : 0,
      downloadsActive: false, sessionStats: this.stats, prefs: this.prefs, serverBase: BASE,
      ntpUrl: 'zephyr://newtab', chromeReady: true,
      platform: 'windows', frameless: true, maximized: this.maximized, profileName: 'Me',
    };
  }
  async emitTo(surface, ev, payload) {
    const page = this.surfaces[surface];
    if (!page) return;
    try { await page.evaluate(([e, p]) => { window.__zx && window.__zx.emit(e, p); }, [ev, payload]); } catch (e) {}
  }
  async pushState() { await this.emitTo('chrome', 'state', this.statePayload()); }
  async sendBmData() { await this.emitTo('chrome', 'bm-data', { items: this.bookmarks.map(b => ({ url: b.url, title: b.title })) }); }
  resolveUrl(url) {
    if (url === 'zephyr://newtab') return BASE + '/ntp/index.html';
    if (url === 'zephyr://settings') return BASE + '/pages/settings.html';
    return url;
  }
  async navigateContent(url) {
    const page = this.surfaces.content;
    const r = this.resolveUrl(url);
    if (page && r.startsWith('http')) {
      try { await page.goto(r, { waitUntil: 'load', timeout: 20000 }); } catch (e) {}
      await page.evaluate(() => { window.__ZX_TAB = 0; }).catch(() => {});
    }
    const t = this.tabs[this.active];
    if (t) { t.loading = false; await this.pushState(); }
  }
  async openTab(url) {
    this.tabs.push({ id: this.nextId++, kind: url.startsWith('zephyr://') ? 'internal' : 'content', url, title: url === 'zephyr://newtab' ? 'New Tab' : url, favicon: null, pinned: false, muted: false, loading: false, suspended: false, canBack: false, canFwd: false, blocked: 0, active: true });
    this.active = this.tabs.length - 1;
    await this.pushState(); await this.syncContent();
  }
  async syncContent() { const t = this.tabs[this.active]; if (t) await this.navigateContent(t.url); }
  async handle(ns, cmd, data) {
    data = data || {};
    switch (cmd) {
      case 'hello': await this.pushState(); await this.sendBmData(); break;
      case 'bm-list': await this.sendBmData(); break;
      case 'chrome-height': this.chromeH = data.h; break;
      case 'nav': {
        const url = smartUrl(data.url);
        const t = this.tabs[this.active];
        if (t) { t.canBack = true; t.canFwd = false; t.url = url; t.title = url === 'zephyr://newtab' ? 'New Tab' : url; t.loading = true; }
        await this.pushState(); await this.navigateContent(url); break;
      }
      case 'tab-new': await this.openTab('zephyr://newtab'); break;
      case 'tab-activate': {
        const idx = this.tabs.findIndex(t => t.id === data.id);
        if (idx >= 0) { this.active = idx; await this.pushState(); await this.syncContent(); }
        break;
      }
      case 'addr-query': {
        const q = (data.q || '').toLowerCase();
        this.suggestItems = [];
        if (q) {
          this.suggestItems.push({ kind: 'search', title: q, url: 'https://duckduckgo.com/?q=' + encodeURIComponent(q), host: 'duckduckgo.com' });
          for (const b of this.bookmarks) if (b.title.toLowerCase().includes(q)) this.suggestItems.push({ kind: 'bookmark', title: b.title, url: b.url, host: b.url.replace(/^https?:\/\//, '').split('/')[0] });
          for (const h of this.history) if (h.title.toLowerCase().includes(q)) this.suggestItems.push({ kind: 'history', title: h.title, url: h.url, host: h.url.replace(/^https?:\/\//, '').split('/')[0] });
          this.suggestItems.push({ kind: 'search', title: q + ' engine', url: 'https://duckduckgo.com/?q=x', host: 'duckduckgo.com' });
        }
        await this.emitTo('chrome', 'suggest', { q, items: this.suggestItems, sel: -1 });
        break;
      }
      case 'bm-toggle': {
        const at = this.tabs[this.active];
        const url = data.url || (at && at.url);
        const existing = this.bookmarks.find(b => b.url === url);
        if (existing) this.bookmarks = this.bookmarks.filter(b => b !== existing);
        else this.bookmarks.push({ url, title: data.title || url });
        await this.sendBmData(); await this.pushState(); break;
      }
      case 'prefs-get': await this.emitTo('chrome', 'prefs-data', this.prefs); break;
      case 'win-max-toggle': this.maximized = !this.maximized; await this.emitTo('chrome', 'win-state', { maximized: this.maximized }); break;
      case 'overlay-open':
        await this.emitTo('overlay', 'popup-open', { kind: data.kind, x: data.x, y: data.y, w: data.w, payload: data.payload, theme: this.prefs.theme });
        break;
      case 'overlay-close':
        await this.emitTo('overlay', 'popup-hide', {});
        break;
      case 'overlay-hide': await this.emitTo('chrome', 'popup-closed', {}); break;
      case 'ntp-data': {
        await this.emitTo('content', 'ntp-data', {
          topSites: [{ host: 'example.com', url: 'https://example.com/', title: 'Example', color: '#4b7bec', visits: 4 }],
          shortcuts: this.shortcuts,
          stats: this.stats, searchEngine: this.prefs.search_engine,
          defaults: [
            { url: 'https://www.google.com/', label: 'Google' },
            { url: 'https://www.youtube.com/', label: 'YouTube' },
            { url: 'https://mail.google.com/', label: 'Gmail' },
            { url: 'https://maps.google.com/', label: 'Maps' },
            { url: 'https://drive.google.com/', label: 'Drive' },
          ],
          serverBase: BASE,
          weather: { err: 'offline' },
        });
        break;
      }
      case 'weather': await this.emitTo('content', 'weather-data', { weather: { err: 'offline' } }); break;
      default: break;
    }
  }
}

const IPC_SHIM = `
  window.ipc = {
    postMessage: function (raw) { window.__surface(raw); }
  };
`;

async function newSurface(browser, ctx, url, surface, onIpc) {
  const page = await ctx.newPage();
  await page.addInitScript(IPC_SHIM);
  await page.exposeFunction('__surface', (raw) => { onIpc(raw); });
  await page.goto(url, { waitUntil: 'load' });
  return page;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: WIN_W, height: WIN_H }, deviceScaleFactor: 1 });

  const onIpc = (raw) => { let m; try { m = JSON.parse(raw); } catch (e) { return; } core.handle(m.ns, m.cmd, m.data || {}); };
  const core = new Core();

  const chrome = await newSurface(browser, ctx, BASE + '/ui/index.html', 'chrome', onIpc);
  const overlay = await newSurface(browser, ctx, BASE + '/ui/overlay.html', 'overlay', onIpc);
  const content = await newSurface(browser, ctx, BASE + '/ntp/index.html', 'content', onIpc);
  core.surfaces = { chrome, overlay, content };
  await sleep(500);
  await core.handle('chrome', 'hello', {});
  await core.handle('chrome', 'bm-list', {});
  await sleep(400);
  // the NTP requests ntp-data at page load, before surfaces are wired — replay it
  await core.handle('chrome', 'ntp-data', {});
  await sleep(400);
  console.log('chromeH =', core.chromeH);

  const CH = core.chromeH || 118;
  // resize surfaces to their real in-window rects
  await chrome.setViewportSize({ width: WIN_W, height: CH });
  await content.setViewportSize({ width: WIN_W, height: WIN_H - CH });
  await sleep(400);
  await core.pushState();
  await sleep(400);

  const grab = async (name) => {
    await chrome.screenshot({ path: `${OUT}/${name}-chrome.png`, clip: { x: 0, y: 0, width: WIN_W, height: CH } });
    await content.screenshot({ path: `${OUT}/${name}-content.png`, clip: { x: 0, y: 0, width: WIN_W, height: WIN_H - CH } });
    await overlay.screenshot({ path: `${OUT}/${name}-overlay.png`, omitBackground: true });
  };

  // ---- STATE 1: NTP ----------------------------------------------------------
  await grab('1-ntp');
  console.log('state 1 (NTP) done');

  // ---- STATE 2: omnibox typed -> suggestions ---------------------------------
  await chrome.evaluate(() => {
    const inp = document.getElementById('url-input');
    inp.focus();
    inp.value = 'wikipedia';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(700);
  await grab('2-omnibox');
  console.log('state 2 (omnibox) done');
  await chrome.evaluate(() => { document.getElementById('url-input').blur(); });
  await core.handle('chrome', 'overlay-close', {});
  await sleep(200);

  // ---- STATE 3: main menu open ------------------------------------------------
  await chrome.click('#menu-btn');
  await sleep(600);
  await grab('3-menu');
  console.log('state 3 (menu) done');
  await core.handle('chrome', 'overlay-close', {});
  await sleep(200);

  // ---- STATE 4: real site loaded ----------------------------------------------
  await core.handle('chrome', 'nav', { url: 'example.com' });
  await sleep(1500);
  await core.handle('chrome', 'bm-list', {});
  await sleep(300);
  await grab('4-site');
  console.log('state 4 (site) done');

  await browser.close();
  srv.close();
  console.log('ALL ZEPHYR STATES CAPTURED');
}

main().catch(e => { console.error(e); process.exit(1); });
