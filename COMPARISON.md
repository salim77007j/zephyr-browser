# Zephyr v0.1.1 — Side-by-Side Comparison with Chrome & Firefox

An honest, item-by-item comparison of the browsing UI and core features against
the two most widely used browsers. Zephyr is a privacy-first, lightweight
browser; where it is behind, this document says so plainly.

Legend: ✅ full support · 🟡 partial / different trade-off · ❌ not available

## Window & Title Bar

| Detail | Zephyr 0.1.1 | Chrome 126 | Firefox 127 |
|---|---|---|---|
| Tabs-on-top layout | ✅ | ✅ | ✅ |
| Rounded tabs merging into toolbar | ✅ | ✅ | 🟡 separate tab strip |
| Native title bar (Linux) | ✅ | ✅ | ✅ |
| Custom caption buttons (Windows) | ✅ | ✅ | ✅ |
| Drag window from empty tab-strip area | ✅ | ✅ | ✅ |
| Double-click strip = maximize | ✅ | ✅ | ✅ |
| Edge resize (Windows undecorated) | ✅ | ✅ | ✅ |

## Tab Strip

| Detail | Zephyr 0.1.1 | Chrome 126 | Firefox 127 |
|---|---|---|---|
| Favicon per tab (fallback letter tile) | ✅ | ✅ | ✅ |
| Loading spinner | ✅ | ✅ | ✅ |
| Mute indicator | ✅ | ✅ | ✅ |
| Suspended-tab indicator | ✅ | ❌ | ❌ |
| Close button per tab | ✅ | ✅ | ✅ |
| Middle-click close | ✅ | ✅ | ✅ |
| Wheel scrolls tab strip | ✅ | ✅ | ✅ |
| Drag to reorder | ✅ | ✅ | ✅ |
| Pin tabs | ✅ | ✅ | ✅ |
| Duplicate tab | ✅ | ✅ | 🟡 via menu |
| Mute site | ✅ | ✅ | ✅ |
| Suspend tab (memory saver) | ✅ manual | 🟡 automatic | 🟡 automatic |
| Close others | ✅ | ✅ | ✅ |
| Reopen closed tab (Ctrl+Shift+T) | ✅ | ✅ | ✅ |
| Tab groups | ❌ | ✅ | ❌ |
| Tab preview on hover | ❌ | ✅ | ✅ |
| Horizontal tab overflow scrolling | ✅ | ✅ | ✅ |

## Toolbar & Omnibox

| Detail | Zephyr 0.1.1 | Chrome 126 | Firefox 127 |
|---|---|---|---|
| Back / Forward (history-aware enable) | ✅ | ✅ | ✅ |
| Reload / Stop | ✅ | ✅ | ✅ |
| Home button (optional pref) | ✅ | ❌ hidden by default | ✅ |
| Combined search + address field | ✅ | ✅ | ✅ |
| Search-engine aware placeholder | ✅ | ✅ | ✅ |
| Suggestions: history + bookmarks + search | ✅ local only | ✅ + server-side | ✅ + server-side |
| Keyboard navigation of suggestions | ✅ | ✅ | ✅ |
| Security chip (lock / warning / globe) | ✅ clickable | ✅ clickable | ✅ clickable |
| Site-info popup with per-site permissions | ✅ | ✅ | ✅ |
| Zoom indicator chip (click to reset) | ✅ | ✅ | ✅ |
| Bookmark star | ✅ | ✅ | ✅ |
| Downloads button with active indicator | ✅ | ✅ | ✅ |
| Privacy shield with block counter | ✅ | ❌ (no built-in blocker) | 🟡 shield icon |
| Side-panel button | ✅ | ✅ | ❌ |
| Profile / avatar button | ✅ basic menu | ✅ full sync menu | ✅ containers |
| Kebab menu (customize & control) | ✅ 17 items | ✅ | ✅ hamburger menu |
| Customizable button order | ❌ | ❌ | ✅ |

## Menus & Dialogs (Overlay System)

| Detail | Zephyr 0.1.1 | Chrome 126 | Firefox 127 |
|---|---|---|---|
| Menus float WITHOUT resizing the page | ✅ (dedicated overlay webview) | ✅ | ✅ |
| New tab / New window / New profile | ✅ / ✅ / ❌ | ✅ | ✅ |
| Bookmarks / History / Downloads managers | ✅ | ✅ | ✅ |
| Save page… / Print… | ✅ | ✅ | ✅ |
| Find in page | ✅ | ✅ | ✅ |
| Zoom in / out / reset | ✅ | ✅ | ✅ |
| Full screen | ✅ | ✅ | ✅ |
| View page source | ✅ | ✅ | ✅ |
| Developer tools | 🟡 WebKit inspector | ✅ full DevTools | ✅ full DevTools |
| Settings | ✅ | ✅ | ✅ |
| Clear browsing data dialog | ✅ | ✅ | ✅ |
| Bookmark edit dialog | ✅ | ✅ | ✅ |
| Toast notifications | ✅ | ✅ | ✅ |
| Permission prompts (location, cam, mic, notifications, autoplay) | ✅ | ✅ | ✅ |
| Save-password prompt | ✅ | ✅ | ✅ |

## New Tab Page

| Detail | Zephyr 0.1.1 | Chrome 126 | Firefox 127 |
|---|---|---|---|
| Greeting header | ✅ time-aware | ❌ | ❌ |
| Clock + date widget | ✅ | ❌ | ❌ |
| Weather widget | 🟡 opt-in, off-thread fetch | ✅ | ❌ |
| Centered search pill | ✅ | ✅ | ✅ |
| Shortcut circles (brand colors) | ✅ | ✅ | ✅ |
| Add / edit / delete shortcuts | ✅ dialog (no browser prompt()) | ✅ | ✅ |
| Blocked-count badge | ✅ | ❌ | ❌ |
| Footer with settings shortcut | ✅ | ✅ links | ✅ links |
| Custom background image | ❌ | ✅ | ✅ |

## Privacy (Zephyr's core differentiator)

| Detail | Zephyr 0.1.1 | Chrome 126 | Firefox 127 |
|---|---|---|---|
| Built-in ad/tracker blocking | ✅ 226,377 EasyList + EasyPrivacy rules | ❌ | 🟡 ETP lists only |
| Cosmetic filtering (element hiding) | ✅ | ❌ | 🟡 limited |
| Tracking-param stripping (utm_*) | ✅ | ❌ | ❌ |
| Canvas / Audio / WebGL fingerprint noise | ✅ per-call | ❌ | 🟡 behind a flag |
| Permission default-deny | ✅ | ❌ prompt-first | ❌ prompt-first |
| Password vault encryption | ✅ AES-256-GCM local | ✅ sync-encrypted | ✅ local |
| Telemetry | ✅ none | 🟡 heavy, opt-out | 🟡 opt-out |
| Private/incognito window | ❌ planned v0.2 | ✅ | ✅ |
| Per-site cookie isolation | ❌ planned | ✅ | ✅ Total Cookie Protection |

## Engine & Footprint

| Detail | Zephyr 0.1.1 | Chrome 126 | Firefox 127 |
|---|---|---|---|
| Rendering engine | WebKit (WebKitGTK / WebView2) | Blink | Gecko |
| Core written in | Rust (~5.6k lines) | C++ (~30M lines) | C++/Rust |
| Binary size | ~4 MB | ~180 MB installer | ~60 MB installer |
| Process model | single process, per-tab views | process per site | process per site |
| Cold start (measured, Linux) | 0.4–0.7 s | ~1.2 s | ~1.5 s |
| Site isolation (security) | ❌ | ✅ | ✅ |
| WebRTC | ❌ disabled by design | ✅ | ✅ |
| Extensions ecosystem | ❌ | ✅ Chrome Web Store | ✅ AMO |
| Account sync | ❌ local-only by design | ✅ | ✅ |
| Installer packages | 🟡 portable zip/tar | ✅ msi/deb/rpm | ✅ deb/rpm |

## Summary

Zephyr 0.1.1 covers the complete day-to-day browser surface — tab strip,
toolbar, omnibox, menus, dialogs, NTP, settings, and managers — with no dead
buttons (verified by an automated every-command test and a 12-stage UI smoke
suite). Its privacy features (blocking, fingerprint noise, param stripping)
exceed what Chrome and Firefox ship by default.

It is behind on platform depth: no extensions, no sync, no private windows, no
tab groups, no process isolation, no WebRTC. These are conscious scope decisions
for a lightweight, local-first browser; the roadmap targets private windows and
installer packages next.
