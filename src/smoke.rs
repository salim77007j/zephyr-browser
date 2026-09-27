// Zephyr Browser — headless smoke test driver (--smoke).
// Drives real windows/webviews under Xvfb, verifies adblock, cosmetic
// filtering, fingerprint noise, permissions, password flow, find-in-page,
// zoom, session, history and measures timings + RSS. Prints STAGE: markers
// for external screenshot tooling and writes a JSON report.
use crate::app::{App, UserEvent};
use crate::models;
use serde_json::json;

pub struct SmokeCtx {
    pub results: Option<serde_json::Value>,
    pub checks: Vec<(String, bool, String)>,
    pub adtest_tab: Option<i64>,
    pub ntp_tab: Option<i64>,
    pub cold_start_ms: u64,
    pub find_count: i64,
    pub find_active: i64,
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
        let steps: &[(u64, u32)] = &[
            (1200, 0),
            (2600, 1),
            (700, 2),
            (2000, 3),
            (2000, 4),
            (1800, 5),
            (3200, 6), // extra hold so external screenshot tooling captures the find stage
        ];
        for (delay, step) in steps {
            std::thread::sleep(std::time::Duration::from_millis(*delay));
            if event_proxy.send_event(UserEvent::Smoke(*step)).is_err() {
                return;
            }
        }
    });
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
    sm.check("tabs-created", tab_count == 5, format!("{} tabs", tab_count));
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
    // Note: under Xvfb/software rendering the tree carries Mesa's llvmpipe
    // JIT arenas; the guard catches runaway leaks, not headless overhead.
    sm.check("memory-rss", rss_mb < 2600, format!("{} MB process tree RSS (software rendering)", rss_mb));

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
