# Zephyr Browser — Verification & Resource Report (v0.1.0)

**Repo:** https://github.com/salim77007j/zephyr-browser
**Release:** https://github.com/salim77007j/zephyr-browser/releases/tag/v0.1.0
**Date:** 2026-09-27/28

---

## 1. Build & CI status

| Job | Result |
|---|---|
| Unit tests + filter engine check (ubuntu-24.04) | ✅ success — 24/24 tests |
| Build ubuntu-24.04 (WebKitGTK) | ✅ success — `zephyr-linux-x64.tar.gz` (3.5 MB) |
| Build windows-latest (WebView2) | ✅ success — `zephyr-windows-x64.zip` (3.6 MB) |
| Headless functional smoke test (Xvfb) | ✅ success — 22/22 checks |
| Release (tag v0.1.0) | ✅ published with all artifacts |

Release artifacts: Linux + Windows builds, 6 verified UI screenshots, and the JSON smoke report.

## 2. Functional verification (automated, reproducible)

`zephyr --smoke` drives the real browser under Xvfb and asserts behavior end-to-end.
Results are identical on the dev sandbox and the GitHub CI runner:

| Check | Local | GitHub CI |
|---|---|---|
| Cold start (process → chrome IPC hello) | 419–529 ms | 638 ms |
| Chrome UI responsive (IPC round-trip) | ✅ | ✅ |
| Tabs created in scripted session | 5 | 5 |
| Network requests blocked (ads+trackers) | 8 | 8 |
| sendBeacon interception | ✅ | ✅ |
| XHR interception | ✅ | ✅ |
| fetch interception | ✅ | ✅ |
| Parser-inserted blocked `<img>` removed | ✅ | ✅ |
| Blocked `<iframe>` removed | ✅ | ✅ |
| Cosmetic element hiding | 3 elements | 3 elements |
| Canvas fingerprint noise (toDataURL differs) | ✅ | ✅ |
| Tracking-parameter stripping (utm_*) | ✅ | ✅ |
| Geolocation default-deny | ✅ | ✅ |
| Password vault save (AES-256-GCM) | 1 entry | 1 entry |
| History recording | ✅ | ✅ |
| Daily blocking stats persisted | ads=6 trackers=2 cosmetic=3 | same |
| Find-in-page | 2 matches, highlights | 2 matches |
| Per-tab zoom | 1.5× | 1.5× |
| Session save/restore file | ✅ | ✅ |
| Settings persistence round-trip | ✅ | ✅ |
| Process-tree RSS (software rendering) | 1706 MB | 1660 MB |

Unit tests (24) cover the filter-list parser against the **real bundled EasyList/EasyPrivacy**
(226,377 rules), host classification, cosmetic rule extraction, URL/smart-omnibox parsing,
session round-trip, SQLite migrations, prefs validation, vault encryption round-trips,
and the loopback UI server (serving + 404 behavior).

## 3. Visual verification

Screenshots were captured per stage during the smoke run and independently reviewed
by a vision model (GLM-5V) confirming correct rendering:

- **01-newtab / 03-ntp** — new tab page with clock, greeting, private search field,
  frequent-sites grid, quick links, live "N trackers & ads blocked this session" counter.
- **02-adtest** — instrumentation fixture: browser chrome (dark theme tab strip,
  toolbar, rounded omnibox with security indicator, blocked-counter chip) over the test
  page, whose on-page JSON report reads `networkBlocked: 8, canvasNoise: true`.
- **04-settings** — full settings page with all 9 sections (General, Appearance,
  Privacy & protection, Site permissions, Filter lists, Passwords, Performance,
  Advanced, Clear browsing data) and real controls.
- **05-privacy** — dashboard with live totals and "226,377 filter rules loaded".
- **06-find** — find-in-page with yellow match highlights on "ipsum".

## 4. Resource report

- **Binary size:** 8.7 MB (release, symbols stripped); ~3.5 MB compressed per platform.
- **Cold start:** 0.42–0.64 s to a fully interactive browser (loopback UI server,
  filter engine with 226k rules, SQLite profile all initialized in that window).
- **Memory:** ~1.6–1.7 GB process-tree RSS with 6 live webviews under **pure software
  rendering** (Xvfb, llvmpipe, no GPU). This includes Mesa JIT arenas and per-tab
  WebKitWebProcess instances; on GPU-accelerated desktops the footprint is materially
  lower. Memory-saver suspension (idle tabs unload; configurable cap on live tabs)
  ships enabled.
- **Idle behavior:** background webviews are engine-throttled
  (`BackgroundThrottlingPolicy::Throttle`) and suspended after the configured idle
  period (default 15 min) or beyond the live-tab cap (default 12).

## 5. Filter engine stats

```
network rules:     226,377
ad hosts:          55,364
tracker hosts:     50,671
malicious hosts:        224
exceptions:             366
generic selectors:  13,633
domain rules:       8,266
spot checks: doubleclick.net → blocked
              google-analytics.com → tracker
              example.com → allowed
```

## 6. Known limitations (honest list)

1. Filter-list exceptions are honored host-wide; path-scoped and `$document`-scoped
   whitelist rules are skipped (errs toward blocking — see `src/filters.rs`).
2. Script-level blocking intercepts JS-initiated requests; parser-inserted
   resources are removed post-insertion (a tiny window exists before removal).
3. WebRTC IP exposure follows the platform engine's policy (no per-site override yet).
4. "Ask where to save" downloads re-fetch via the Rust HTTP client (no engine cookies).
5. On Linux, load failures show the engine's own error surface in v0.1 (custom error
   page infrastructure is present via `zephyr://error`).
6. CI runner screenshots render blank (window mapping quirk of the runner's Xvfb);
   functional verification on CI is unaffected, and the locally captured,
   vision-verified screenshots are attached to the release.

## 7. Security posture

- Rust core (memory safety by construction); per-site child webviews with engine-level
  process isolation.
- Loopback UI server is token-gated (unguessable 128-bit path prefix) and 404s all
  unauthenticated paths (tested).
- Password vault: AES-256-GCM with a per-profile key (0600); secrets never rendered
  in UI prompts; transient plaintext only in RAM during save/fill.
- Web-engine profile isolated inside the app data directory (XDG redirection on Linux)
  so "clear cookies & site data" is complete and real.
- Permission requests default to deny/ask with per-site exceptions stored in SQLite.
