const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = '/home/z/zephyr/assets'; const PORT = 18399; const BASE = `http://127.0.0.1:${PORT}`;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  for (const m of ['/ui/']) { const i = p.indexOf(m); if (i > 0) { p = p.slice(i); break; } }
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'text/plain' }); res.end(fs.readFileSync(f));
});
srv.listen(PORT, '127.0.0.1', async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 820 } });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('[pageerror]', e.message));
  pg.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
  await pg.addInitScript(`window.ipc = { postMessage: function (raw) { window.__m = (window.__m||[]).concat(raw); } };`);
  await pg.goto(BASE + '/ui/index.html', { waitUntil: 'load' });
  await pg.evaluate(() => {
    window.__zx.emit('state', {
      tabs: [{ id: 1, title: 'New Tab', url: 'zephyr://newtab', active: true, kind: 'internal', internal: true, canBack: false, canFwd: false, blocked: 0, loading: false, favicon: null, pinned: false, muted: false, suspended: false, zoom: 1 }],
      active: 0, activeUrl: 'zephyr://newtab', activeTitle: 'New Tab', activeBlocked: 0,
      downloadsActive: false, sessionStats: { ads: 12, trackers: 5, cosmetic: 30, params: 2 }, prefs: { theme: 'light', show_bookmarks_bar: true },
      serverBase: 'x', ntpUrl: 'zephyr://newtab', chromeReady: true, platform: 'windows', frameless: true, maximized: false, profileName: 'Me',
    });
  });
  await new Promise(r => setTimeout(r, 300));
  const info = await pg.evaluate(() => {
    const b = document.getElementById('ext-badge');
    return { exists: !!b, html: b ? b.outerHTML : null, cls: b ? b.className : null, txt: b ? b.textContent : null };
  });
  console.log(JSON.stringify(info, null, 1));
  await b.close(); srv.close(); process.exit(0);
});
