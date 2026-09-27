# Zephyr Browser

**Privacy-first, ultra-light web browser built in Rust.**

Zephyr is a 2026-era desktop browser engineered around three non-negotiables: **speed**, **privacy**, and **lean resource use**. The Rust core drives the platform web engine (WebView2 on Windows, WebKitGTK on Linux) through [wry](https://github.com/tauri-apps/wry), and layers a complete browsing experience on top — tabs, an omnibox with real suggestions, bookmarks, history, downloads, a full settings surface, a privacy dashboard, and an ad/tracker/fingerprint protection stack that blocks before requests leave the page.

```
┌────────────────────────────────────────────────────────────────┐
│  Zephyr core (Rust)                                            │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ tao/wry  │ │ filter    │ │ SQLite   │ │ loopback UI      │  │
│  │ windows/ │ │ engine    │ │ profile  │ │ server (chrome,  │  │
│  │ tabs/IPC │ │ EasyList  │ │ history/ │ │ NTP, settings,   │  │
│  │ layout   │ │ parser    │ │ prefs/   │ │ manager pages)   │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────────┘  │
│  ┌────────────────────┐ ┌──────────────────────────────────┐   │
│  │ password vault     │ │ downloads / session / stats      │   │
│  │ AES-256-GCM        │ │ suspension / list updater        │   │
│  └────────────────────┘ └──────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
        │                                       │
   content scripts (JS, injected at document start)
   network filter · cosmetic filter · fingerprint noise
   permission shims · gestures · find-in-page · mute
```

## Feature highlights

**Browsing**
- Tab management: create, close, restore (Ctrl+Shift+T), pin, mute, duplicate, reorder, suspend, close-others; middle-click close; multi-window (Ctrl+N)
- Smart omnibox: URL vs. search detection, history + bookmark suggestions, security indicator (https/http/internal), tracking-block counter chip
- Navigation stack tracked in Rust (back/forward survives session restore), SPA navigation tracking (pushState/popstate)
- Session restore, per-site zoom persistence, find-in-page with match count, print, save page, view source, per-tab DevTools (F12), fullscreen
- Mouse gestures: hold right button and drag — ← back · → forward · ↑ reload · ↓ new tab (with trail overlay)
- New tab page: clock + greeting, private search field, frequent sites, quick links, live privacy counter

**Privacy & protection**
- **Host-level blocking** — navigations and subframe requests to known ad/tracker hosts are cancelled inside the engine's navigation policy before any network activity
- **Script-level filtering** — `fetch`, `XMLHttpRequest`, `sendBeacon`, element `src`/`href` setters and `setAttribute` are wrapped in every page; parser-inserted blocked resources are removed via MutationObserver
- **Element-level hiding** — thousands of cosmetic rules from EasyList hide ad placeholders; a size-heuristic layer catches classic ad shapes
- **Tracking-parameter stripping** — 45+ parameters (utm_*, fbclid, gclid, msclkid…) removed from outgoing requests
- **Fingerprint protection** — deterministic per-session noise on canvas readbacks (`toDataURL`/`toBlob`/`getImageData`), audio (AnalyserNode/AudioBuffer), WebGL vendor/renderer masking, navigator clamping (CPU cores, memory, UA client hints)
- **Malicious-site interstitial** with per-session "allow once"
- **Permission system** — geolocation, notifications, camera/microdrive with default ask/block and per-site exceptions; autoplay policy applied at the engine level
- Third-party `document.cookie` isolation in cross-site iframes; Do-Not-Track signal
- **Privacy dashboard** — live session/day totals, per-page blocked host list, filter-rule counts, layer status

**Data & platform**
- Filter lists: bundled EasyList + EasyPrivacy snapshots (~143k rules) + curated malicious-domain list, with in-app updating and custom list URLs
- Encrypted password vault (AES-256-GCM, per-profile key), save/fill flows
- Real downloads with progress (file polling), open/show-in-folder, history
- Bookmarks manager, history manager with search, bookmarks bar
- Memory saver: background tabs suspend after an idle period or beyond a live-tab cap and reload on demand
- Full settings surface — every visible toggle is wired to real behavior
- Themes: dark/light/system + accent colors + compact density

## Building

```bash
# Linux
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev
cargo build --release

# Windows (WebView2 SDK via visual studio)
cargo build --release
```

Useful commands:
```bash
cargo test                     # unit tests (incl. filter-list parsing against real EasyList)
cargo run --release -- --filter-check   # parse bundled lists, print stats, verify spot-checks
./scripts/smoke-headless.sh    # headless functional smoke test under Xvfb with screenshots
```

Run headless / software rendering (Linux): `ZEPHYR_SOFTWARE_RENDER=1 zephyr`

## Verification

`zephyr --smoke` runs a scripted, self-verifying session (used by CI): it opens real
windows/webviews under Xvfb, loads an instrumentation fixture that exercises every
protection layer, and asserts cold-start time, blocked-request counts, cosmetic
hides, canvas-noise effectiveness, parameter stripping, permission default-deny,
password save, find-in-page, zoom, session persistence, history recording, stats
persistence, and process-tree RSS. Screenshots are captured per stage.

## Architecture notes & honest limitations

- **Engine**: Zephyr deliberately builds on the platform web engine (Chromium-class via WebView2 on Windows, WebKit via WebKitGTK on Linux) instead of shipping a bespoke renderer — this is how it stays fully compatible with the modern web while the Rust core owns privacy, performance and UX policy. (On Linux some sites may still ask for Chrome; the *Compatibility user agent* setting addresses this.)
- Filter-list matching is host-based (with suffix matching and broad exceptions). Path-scoped whitelist rules (`@@||host/path`) and `$document`-scoped exceptions are intentionally *not* honored for subresources — this errs on the side of blocking and is documented in `src/filters.rs`.
- Script-level filtering intercepts JS-initiated requests; parser-inserted resources are removed after insertion. This covers the great majority of ad/tracker traffic; a proxy-level interceptor is a natural future hardening step.
- WebRTC IP leakage is governed by the platform engine's own ICE policy; per-site override is not exposed in v0.1.
- Downloads: `ask-where-to-save` re-fetches through the Rust HTTP client (no engine cookies); direct downloads use the engine's downloader.
- Cookies & site data clearing operates on the engine profile, which Zephyr isolates inside its own data directory on Linux (XDG redirection) — a complete, real clear.

## License

All rights reserved — license TBD during the draft stage.

---
*Zephyr is a engineering draft of a commercial-grade browser, built end-to-end in Rust with a no-fake-UI policy: every control you can see is connected to real backend behavior.*
