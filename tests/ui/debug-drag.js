// Minimal drag-strip debug: does the mousedown dispatch reach IPC?
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join('/home/z/zephyr', 'assets');
const PORT = 18397;
const BASE = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
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

async function main() {
  const srv = await serve();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  page.on('console', m => console.log('[console]', m.text()));
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  await page.addInitScript(`
    window.__msgs = [];
    window.ipc = { postMessage: function (raw) { window.__msgs.push(JSON.parse(raw)); } };
  `);
  await page.goto(BASE + '/ui/index.html', { waitUntil: 'load' });
  // feed state with frameless true like the harness does
  await page.evaluate((base) => {
    window.__zx.emit('state', {
      tabs: [{ id: 1, title: 'New Tab', url: 'zephyr://newtab', active: true, kind: 'internal', internal: true, canBack: false, canFwd: false, blocked: 0, loading: false, favicon: null, pinned: false, muted: false, suspended: false, zoom: 1 }],
      active: 0, activeUrl: 'zephyr://newtab', activeTitle: 'New Tab', activeBlocked: 0,
      downloadsActive: false, sessionStats: {}, prefs: { theme: 'light', show_bookmarks_bar: true },
      serverBase: base, ntpUrl: 'zephyr://newtab', chromeReady: true,
      platform: 'windows', frameless: true, maximized: false, profileName: 'Me',
    });
    window.__zx.emit('bm-data', { items: [{ url: 'https://www.google.com/', title: 'Google' }] });
  }, BASE);
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => {
    const ds = document.getElementById('drag-strip');
    console.log('drag-strip exists:', !!ds);
    ds.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, detail: 1 }));
  });
  await new Promise(r => setTimeout(r, 200));
  const msgs = await page.evaluate(() => window.__msgs.map(m => m.cmd));
  console.log('IPC cmds:', msgs);
  console.log('win-drag sent:', msgs.includes('win-drag'));
  await browser.close(); srv.close();
}
main().catch(e => { console.error(e); process.exit(1); });
