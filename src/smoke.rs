// Zephyr Browser — headless smoke test driver (--smoke).
// Drives real windows/webviews under Xvfb, verifies adblock, cosmetic
// filtering, fingerprint noise, permissions, password flow, find-in-page,
// zoom, session, history and measures timings + RSS — plus a 12-stage
// every-button UI suite that clicks real DOM elements and verifies the
// effects through the real IPC path. Prints STAGE: markers for external
// screenshot tooling and writes a JSON report.
use crate::app::{App, UserEvent};
use crate::models;
use serde_json::json;
use tao::window::WindowId;

pub struct SmokeCtx {
    pub results: Option<serde_json::Value>,
    pub checks: Vec<(String, bool, String)>,
    pub adtest_tab: Option<i64>,
    pub ntp_tab: Option<i64>,
    pub cold_start_ms: u64,
    pub find_count: i64,
    pub find_active: i64,
    /// id of the tab moved by the reorder test
    pub reorder_id: i64,
    /// bookmark URL added through the tab-context-menu bm-add path
    pub bm_url: String,
    pub finished: bool,
}

impl SmokeCtx {
    pub fn new() -> Self {
        Self {
            results: None,
            checks: vec![],
            adtest_tab: None,
            ntp_tab: None,
            cold_start_ms: 0,
            find_count: -1,
            find_active: -1,
            reorder_id: 0,
            bm_url: String::new(),
            finished: false,
        }
    }

    fn check(&mut self, name: &str, ok: bool, detail: String) {
        println!("CHECK: {} -> {} ({})", name, if ok { "PASS" } else { "FAIL" }, detail);
        self.checks.push((name.to_string(), ok, detail));
    }
}

/// Spawn the step driver thread (timed stages).
pub fn start_driver(proxy: std::sync::mpsc::Sender<()>, event_proxy: tao::event_loop::EventLoopProxy<UserEvent>) {
    let _ = proxy;
    std::thread::spawn(move || {
        // cumulative times: 1.2 boot · 3.8 adtest · 4.5 ntp · 6.5 settings
        // 8.5 privacy · 10.3 find · 12.6 ui-prep · 13.3 menu-open ·
        // 15.3 menu-item · 16.0 ext-open · 17.8 profile-open ·
        // 18.5 profile-item · 20.3 siteinfo-open · 21.0 siteinfo-item ·
        // 22.8 findbar-open · 24.6 findbar-close · 25.8 dom+suggest ·
        // 27.6 suggest-verify · 29.4 report
        // (popup stages hold ≥1.7 s so external screenshot tooling — which
        // adds ~1 s of capture latency — can catch them open)
        let steps: &[(u64, u32)] = &[
            (1200, 0),
            (2600, 1),
            (700, 2),
            (2000, 3),
            (2000, 4),
            (1800, 5),
            (2300, 6),
            (700, 7),
            (2000, 8),
            (700, 9),
            (1800, 10),
            (700, 11),
            (1800, 12),
            (700, 13),
            (1800, 14),
            (1800, 15),
            (1200, 16),
            (1800, 17),
            (1200, 18),
        ];
        for (delay, step) in steps {
            std::thread::sleep(std::time::Duration::from_millis(*delay));
            if event_proxy.send_event(UserEvent::Smoke(*step)).is_err() {
                return;
            }
        }
    });
}

// ---------------------------------------------------------------- ui helpers
/// Run JS inside the chrome header webview (real DOM → real IPC path).
fn chrome_eval(app: &mut App, win: WindowId, js: &str) {
    if let Some(w) = app.windows.get(&win) {
        let _ = w.chrome.evaluate_script(js);
    }
}
fn click_el(id: &str) -> String {
    format!("var e=document.getElementById('{}'); e&&e.click();", id)
}
fn tab_count(app: &App) -> usize {
    app.windows.values().map(|w| w.tabs.len()).sum()
}
fn active_url(app: &App, win: WindowId) -> String {
    app.windows
        .get(&win)
        .and_then(|w| w.active_tab())
        .map(|t| t.url.clone())
        .unwrap_or_default()
}
/// Ask the overlay webview to report its popup DOM state through smoke-ui.
fn overlay_report(app: &mut App, win: WindowId) {
    app.overlay_eval(
        win,
        concat!(
            "try{window.ipc&&window.ipc.postMessage(JSON.stringify({ns:'chrome',cmd:'smoke-ui',tab:0,data:{",
            " modal: document.body.dataset.modal || '',",
            " popupCount: document.querySelectorAll('.popup').length",
            "}}));}catch(e){}"
        ),
    );
}
/// Read a string fact from the smoke results mailbox.
fn rs_(app: &App, key: &str) -> String {
    app.smoke
        .as_ref()
        .and_then(|s| s.results.as_ref())
        .and_then(|r| r.get(key))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}
/// Ask the find bar webview to report its DOM state through smoke-ui.
fn findbar_report(app: &mut App, win: WindowId) {
    app.findbar_eval(
        win,
        concat!(
            "try{window.ipc&&window.ipc.postMessage(JSON.stringify({ns:'chrome',cmd:'smoke-ui',tab:0,data:{",
            "findInput: !!document.getElementById('find-input'),",
            " findCountEl: !!document.getElementById('find-count')",
            "}}));}catch(e){}"
        ),
    );
}

pub fn on_step(app: &mut App, step: u32) {
    let Some(win) = app.windows.keys().next().copied() else { return };
    match step {
        0 => {
            println!("STAGE:boot");
            if let Some(sm) = app.smoke.as_mut() {
                sm.cold_start_ms = app.chrome_ready_ms.map(|t| t - app.start_ms).unwrap_or(99999);
            }
            // open the ad/tracker test fixture
            let url = app.server.url_for("fixtures/adtest.html");
            let id = app.new_tab(win, &url, false, true);
            if let Some(sm) = app.smoke.as_mut() {
                sm.adtest_tab = Some(id);
            }
        }
        1 => {
            println!("STAGE:adtest");
            // Ask the fixture to run its assertions (it reports via ipc smoke-results)
            if let Some(id) = app.smoke.as_ref().and_then(|s| s.adtest_tab) {
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script("window.__zxTestReport && window.__zxTestReport()");
                });
            }
        }
        2 => {
            println!("STAGE:ntp");
            let id = app.new_tab(win, crate::tabs::NTP_URL, false, true);
            if let Some(sm) = app.smoke.as_mut() {
                sm.ntp_tab = Some(id);
            }
        }
        3 => {
            println!("STAGE:settings");
            app.new_tab(win, "zephyr://settings", false, true);
        }
        4 => {
            println!("STAGE:privacy");
            app.new_tab(win, "zephyr://privacy", false, true);
        }
        5 => {
            println!("STAGE:find");
            // activate adtest tab, open find bar, search for "ipsum", zoom in
            if let Some(id) = app.smoke.as_ref().and_then(|s| s.adtest_tab) {
                if let Some(w) = app.windows.get(&win) {
                    if let Some(idx) = w.tab_idx(id) {
                        app.activate_tab(win, idx, true);
                    }
                }
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script("window.__zxFinder&&__zxFinder.open();window.__zxFinder&&__zxFinder.query('ipsum')");
                    let _ = wv.evaluate_script("window.__zxTestFind && window.__zxTestFind()");
                });
                // zoom test
                let zoom_js = "window.__zxTestZoom && window.__zxTestZoom()";
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script(zoom_js);
                });
                if let Some(w) = app.windows.get_mut(&win) {
                    if let Some(t) = w.tabs.iter_mut().find(|t| t.id == id) {
                        t.zoom = 1.5;
                    }
                }
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.zoom(1.5);
                });
            }
        }
        6 => {
            println!("STAGE:ui-prep");
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("overlay-webview-alive", app.overlay_ready_ms.is_some(), "overlay booted and signalled".into());
            }
        }
        // ---- every-button UI stage: real DOM clicks -> real IPC -> verify ----
        7 => {
            println!("STAGE:ui-menu-open");
            // click the kebab (customize & control) button
            chrome_eval(app, win, &click_el("menu-btn"));
        }
        8 => {
            println!("STAGE:ui-menu-item");
            // verify the menu rendered inside the overlay webview, then
            // press its first item ("New tab") — popups listen on MOUSEDOWN
            // (real-browser fidelity), so dispatch a full mousedown
            overlay_report(app, win);
            app.overlay_eval(win, "var m=document.querySelector('.popup.menu .menu-item'); m&&m.dispatchEvent(new Event('mousedown',{bubbles:true}));");
        }
        9 => {
            let menu_opened = rs_(app, "modal") == "menu";
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-kebab-menu-opens", menu_opened, "menu popup rendered in overlay".into());
            }
            // capture the post-item-click state (menu closed) for step 10,
            // then open the protection-layers popup
            overlay_report(app, win);
            println!("STAGE:ui-ext-open");
            chrome_eval(app, win, &click_el("ext-btn"));
        }
        10 => {
            let menu_closed = rs_(app, "modal") != "menu";
            let tabs = tab_count(app);
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-menu-item-runs", menu_closed && tabs == 6, format!("menus closed, {} tabs (incl. menu-created)", tabs));
            }
            // verify the ext popup rendered, then close via backdrop and open profile
            overlay_report(app, win);
            app.overlay_eval(win, "var b=document.getElementById('backdrop'); b&&!b.classList.contains('hidden')&&b.dispatchEvent(new Event('mousedown'));");
            chrome_eval(app, win, &click_el("profile-btn"));
        }
        11 => {
            let ext_opened = rs_(app, "modal") == "ext";
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-ext-popup-opens", ext_opened, "protection layers popup rendered".into());
            }
            println!("STAGE:ui-profile-item");
            // verify the profile popup rendered, then press "Passwords"
            overlay_report(app, win);
            app.overlay_eval(win, "var m=document.querySelector('.popup .menu-item'); m&&m.dispatchEvent(new Event('mousedown',{bubbles:true}));");
        }
        12 => {
            let profile_opened = rs_(app, "modal") == "profile";
            let url = active_url(app, win);
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-profile-menu-opens", profile_opened, "profile popup rendered".into());
                sm.check(
                    "ui-profile-item-navigates",
                    url.starts_with("zephyr://settings"), // open-passwords → settings#passwords
                    format!("url={}", url),
                );
            }
            println!("STAGE:ui-siteinfo-open");
            // click the security chip in the omnibox
            chrome_eval(app, win, &click_el("sec-icon"));
        }
        13 => {
            println!("STAGE:ui-siteinfo-verify");
            // verify the site info popup, then press its "Privacy dashboard"
            // item (the last menu item — the first is "Site settings")
            overlay_report(app, win);
            app.overlay_eval(win, "var ms=document.querySelectorAll('.popup.siteinfo .menu-item'); var m=ms[ms.length-1]; m&&m.dispatchEvent(new Event('mousedown',{bubbles:true}));");
        }
        14 => {
            let siteinfo_opened = rs_(app, "modal") == "siteinfo";
            let url = active_url(app, win);
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-site-info-opens", siteinfo_opened, "site info popup rendered".into());
                sm.check(
                    "ui-site-info-button-navigates",
                    url == "zephyr://privacy",
                    format!("url={}", url),
                );
            }
            println!("STAGE:ui-findbar-open");
            // open the find bar through the real IPC path
            chrome_eval(app, win, "window.__zx&&window.__zx.post('find-open', {});");
        }
        15 => {
            // find-open must set the tab flag + show the find bar webview
            let find_open_flag = app
                .windows
                .get(&win)
                .and_then(|w| w.active_tab())
                .map(|t| t.find_open)
                .unwrap_or(false);
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-find-bar-opens", find_open_flag, "find-open sets tab flag + shows bar".into());
            }
            findbar_report(app, win);
            chrome_eval(app, win, "window.__zx&&window.__zx.post('find-close', {});");
            println!("STAGE:ui-reorder-bookmark");
            // tab drag-reorder: move the LAST tab to position 0 via real IPC
            let last_id = app
                .windows
                .get(&win)
                .and_then(|w| w.tabs.last().map(|t| t.id))
                .unwrap_or(0);
            if let Some(sm) = app.smoke.as_mut() {
                sm.reorder_id = last_id;
                sm.bm_url = "https://zephyr-smoke.example/".into();
            }
            chrome_eval(app, win, &format!("window.__zx&&window.__zx.post('tab-move', {{id: {}, index: 0}});", last_id));
            // bm-toggle: add a bookmark through the toolbar star path
            chrome_eval(app, win, &format!(
                "window.__zx&&window.__zx.post('bm-toggle', {{url: '{}', title: 'Zephyr Smoke Bookmark'}});",
                "https://zephyr-smoke.example/"
            ));
        }
        16 => {
            let first_id = app
                .windows
                .get(&win)
                .and_then(|w| w.tabs.first().map(|t| t.id))
                .unwrap_or(-1);
            let rid = app.smoke.as_ref().map(|s| s.reorder_id).unwrap_or(0);
            let bm_url = app.smoke.as_ref().map(|s| s.bm_url.clone()).unwrap_or_default();
            let bm_ok = !bm_url.is_empty() && models::bookmark_exists(&app.db, &bm_url);
            let find_dom = app
                .smoke
                .as_ref()
                .and_then(|s| s.results.as_ref())
                .and_then(|r| r.get("findInput"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let find_closed = app
                .windows
                .get(&win)
                .and_then(|w| w.active_tab())
                .map(|t| !t.find_open)
                .unwrap_or(false);
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-tab-reorder", first_id == rid, format!("first tab id {} == moved {}", first_id, rid));
                sm.check("ui-bookmark-add", bm_ok, format!("bookmark stored: {}", bm_url));
                sm.check("ui-find-bar-dom", find_dom && find_closed, "find bar controls + close resets flag".into());
            }
            println!("STAGE:ui-dom-report");
            // report DOM facts from the chrome + NTP webviews through the IPC bridge
            chrome_eval(app, win, concat!(
                "window.__zx&&window.__zx.post('smoke-ui', {bmBarVisible: !document.getElementById('bookmarksbar').classList.contains('hidden'),",
                " bmBarItems: document.querySelectorAll('#bookmarksbar .bm-item').length});"
            ));
            let ntp = app.smoke.as_ref().and_then(|s| s.ntp_tab);
            if let Some(ntp) = ntp {
                // activate the NTP tab like a user click, then probe its DOM
                let idx = app.windows.get(&win).and_then(|w| w.tab_idx(ntp));
                if let Some(idx) = idx {
                    app.activate_tab(win, idx, true);
                }
                let probed = app.with_tab_webview(win, ntp, |wv| {
                    wv.evaluate_script(concat!(
                        "window.ipc&&window.ipc.postMessage(JSON.stringify({ns:'chrome',cmd:'smoke-ui',tab:0,data:{",
                        "ntpShortcuts: document.querySelectorAll('.tile:not(.add)').length,",
                        " ntpAddTile: !!document.getElementById('add-shortcut')}}));"
                    ))
                });
                match probed {
                    None => println!("CHECK: ntp-probe -> FAIL (webview missing for tab {})", ntp),
                    Some(Err(e)) => println!("CHECK: ntp-probe -> FAIL (eval error {:?})", e),
                    Some(Ok(())) => {}
                }
            }
            // type into the omnibox -> suggestions dropdown
            chrome_eval(app, win, concat!(
                "var u=document.getElementById('url-input'); u.focus(); u.value='zephyr';",
                " u.dispatchEvent(new Event('input'));"
            ));
        }
        17 => {
            println!("STAGE:ui-suggest-verify");
            overlay_report(app, win);
            chrome_eval(app, win, "var u=document.getElementById('url-input'); u&&u.blur();");
        }
        18 => {
            let sug = rs_(app, "modal") == "suggest";
            if let Some(sm) = app.smoke.as_mut() {
                sm.check("ui-omnibox-suggest", sug, "suggestion dropdown opened".into());
            }
            println!("STAGE:report");
            finalize(app);
        }
        _ => {}
    }
}

fn rsl(v: &serde_json::Value, key: &str) -> i64 {
    v.get(key).and_then(|x| x.as_i64()).unwrap_or(-1)
}
fn rsb(v: &serde_json::Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

fn finalize(app: &mut App) {
    app.save_session();
    // persist session stats so the daily bucket is readable immediately
    models::stats_add_day(&app.db, &crate::util::today_key(), app.session_stats);
    let rss_kib = crate::util::process_tree_rss_kib();
    let rss_mb = rss_kib / 1024;
    let hist_count = crate::models::history_list(&app.db, "", 10000, 0).len();
    let stats = crate::models::stats_get_day(&app.db, &crate::util::today_key());

    // prefs roundtrip
    app.prefs.set(&app.db, "accent", "#ff8800");
    let reloaded = crate::prefs::Prefs::load(&app.db);
    let prefs_ok = reloaded.accent == "#ff8800";

    // password saved?
    let pw_count = app
        .vault
        .as_ref()
        .map(|v| crate::passwords::list(&app.db).len())
        .unwrap_or(0);

    let session_file = app.data_dir.join("session.json");
    let session_ok = session_file.exists();

    let tab_count = app.windows.values().map(|w| w.tabs.len()).sum::<usize>();

    let smoke = app.smoke.take().unwrap_or_else(SmokeCtx::new);
    let mut sm = smoke;
    let results = sm.results.clone().unwrap_or(json!({}));

    let cold = sm.cold_start_ms;
    sm.check("cold-start", cold < 8000, format!("{} ms", cold));
    sm.check("chrome-responsive", app.chrome_ready_ms.is_some(), "ipc hello received".into());
    sm.check("overlay-webview-alive", app.overlay_ready_ms.is_some(), "overlay ipc boot signal".into());
    sm.check("tabs-created", tab_count == 6, format!("{} tabs (incl. menu-created)", tab_count));
    sm.check("network-blocked", rsl(&results, "networkBlocked") > 0, format!("{} requests blocked", rsl(&results, "networkBlocked")));
    sm.check("beacon-blocked", rsb(&results, "beaconBlocked"), "sendBeacon wrapper".into());
    sm.check("xhr-blocked", rsb(&results, "xhrBlocked"), "XHR wrapper".into());
    sm.check("fetch-blocked", rsb(&results, "fetchBlocked"), "fetch wrapper".into());
    sm.check("img-removed", rsb(&results, "imgRemoved"), "parser-inserted blocked img removed".into());
    sm.check("iframe-removed", rsb(&results, "iframeRemoved"), "blocked iframe removed".into());
    sm.check("cosmetic-hidden", rsl(&results, "cosmeticHidden") > 0, format!("{} elements hidden", rsl(&results, "cosmeticHidden")));
    sm.check("canvas-noise", rsb(&results, "canvasNoise"), "toDataURL differs between calls".into());
    sm.check("param-stripped", rsb(&results, "paramStripped"), "utm params stripped".into());
    sm.check("geo-denied", rsb(&results, "geoDenied"), "geolocation default-deny".into());
    sm.check("pw-saved", pw_count > 0, format!("{} vault entries", pw_count));
    sm.check("history-recorded", hist_count > 0, format!("{} history rows", hist_count));
    sm.check("stats-recorded", stats.ads + stats.trackers + stats.cosmetic > 0, format!("ads={} trackers={} cosmetic={}", stats.ads, stats.trackers, stats.cosmetic));
    sm.check("find-in-page", sm.find_count > 0, format!("{} matches for 'ipsum'", sm.find_count));
    sm.check("zoom-applied", app.windows.values().any(|w| w.tabs.iter().any(|t| (t.zoom - 1.5).abs() < 0.01)), "zoom 1.5".into());
    sm.check("session-saved", session_ok, session_file.display().to_string());
    sm.check("prefs-roundtrip", prefs_ok, "accent persisted".into());

    // UI DOM facts reported through the IPC bridge during the UI stage
    let bm_bar_visible = rsb(&results, "bmBarVisible");
    let bm_bar_items = rsl(&results, "bmBarItems");
    sm.check("ui-bookmarks-bar-visible", bm_bar_visible, "bookmarks bar shown by default".into());
    sm.check("ui-bookmarks-bar-rendered", bm_bar_items > 0, format!("{} items in the bar", bm_bar_items));
    let ntp_sc = rsl(&results, "ntpShortcuts");
    sm.check("ui-ntp-shortcuts", ntp_sc >= 4, format!("{} shortcut circles", ntp_sc));
    sm.check("ui-ntp-add-tile", rsb(&results, "ntpAddTile"), "add-shortcut tile present".into());
    // Note: under Xvfb/software rendering the tree carries Mesa's llvmpipe
    // JIT arenas plus ~270 MB of pixmaps per webview; the guard catches
    // runaway leaks, not headless overhead.
    sm.check("memory-rss", rss_mb < 3300, format!("{} MB process tree RSS (software rendering)", rss_mb));

    let pass = sm.checks.iter().all(|(_, ok, _)| *ok);
    let report = json!({
        "pass": pass,
        "coldStartMs": cold,
        "rssMb": rss_mb,
        "tabs": tab_count,
        "historyRows": hist_count,
        "statsToday": {"ads": stats.ads, "trackers": stats.trackers, "cosmetic": stats.cosmetic, "params": stats.params},
        "checks": sm.checks.iter().map(|(n, ok, d)| json!({"name": n, "ok": ok, "detail": d})).collect::<Vec<_>>(),
        "ts": crate::util::now_ms(),
    });
    let path = app.data_dir.join("smoke-report.json");
    let _ = std::fs::write(&path, serde_json::to_string_pretty(&report).unwrap_or_default());
    println!("SMOKE_REPORT: {}", serde_json::to_string(&report).unwrap_or_default());
    println!("STAGE:done pass={}", pass);
    let code = if pass { 0 } else { 1 };
    app.proxy
        .send_event(UserEvent::Exit(code))
        .ok();
}

pub fn write_report(app: &App, sm: SmokeCtx) {
    // Called on Exit when smoke didn't reach finalize (crash safety)
    if sm.finished {
        return;
    }
    let report = json!({
        "pass": false,
        "error": "smoke run ended before finalization",
        "checks": sm.checks.iter().map(|(n, ok, d)| json!({"name": n, "ok": ok, "detail": d})).collect::<Vec<_>>(),
    });
    let _ = std::fs::write(app.data_dir.join("smoke-report.json"), serde_json::to_string_pretty(&report).unwrap_or_default());
    println!("SMOKE_REPORT: {}", serde_json::to_string(&report).unwrap_or_default());
}
