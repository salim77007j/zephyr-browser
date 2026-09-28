// Zephyr Browser — IPC command dispatch. All chrome-UI and content-script
// messages are routed here. Every visible control maps to a real command.
use crate::app::{download_dir, App, UserEvent};
use crate::messages::{push_js, IpcMsg};
use crate::models;
use crate::prefs::SEARCH_ENGINES;
use crate::tabs::{self, TabKind};
use crate::util::{now_ms, url_host, url_origin};
use serde_json::json;
use tao::event_loop::EventLoopWindowTarget;
use tao::window::WindowId;
use std::sync::Arc;

pub fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub fn dispatch(app: &mut App, target: &EventLoopWindowTarget<UserEvent>, win: WindowId, tab: Option<i64>, msg: IpcMsg) {
    match msg.ns.as_str() {
        "chrome" | "internal" => dispatch_chrome(app, target, win, tab, msg),
        "content" => dispatch_content(app, target, win, tab, msg),
        _ => {}
    }
}

/// Fetch current weather for the machine's public IP location.
/// Two unauthenticated free services, 30-minute upstream cache handled by the caller.
fn fetch_weather() -> serde_json::Value {
    use std::io::Read;
    let mut read_json = |url: &str| -> Option<serde_json::Value> {
        let mut buf = String::new();
        let resp = ureq::get(url).timeout(std::time::Duration::from_secs(6)).call().ok()?;
        resp.into_reader().take(2_000_000).read_to_string(&mut buf).ok()?;
        serde_json::from_str(&buf).ok()
    };
    let (lat, lon) = {
        let v = match read_json("https://ipwho.is/") {
            Some(v) => v,
            None => return serde_json::json!({"err": "geo"}),
        };
        let lat = v.get("latitude").and_then(|x| x.as_f64());
        let lon = v.get("longitude").and_then(|x| x.as_f64());
        match (lat, lon) {
            (Some(a), Some(b)) => (a, b),
            _ => return serde_json::json!({"err": "geo"}),
        }
    };
    let url = format!(
        "https://api.open-meteo.com/v1/forecast?latitude={}&longitude={}&current=temperature_2m,weather_code",
        lat, lon
    );
    match read_json(&url) {
        Some(v) => {
            let cur = v.get("current").cloned().unwrap_or_default();
            let temp = cur.get("temperature_2m").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let code = cur.get("weather_code").and_then(|x| x.as_i64()).unwrap_or(0);
            serde_json::json!({"temp_c": temp, "code": code})
        }
        None => serde_json::json!({"err": "weather"}),
    }
}

fn active_content_tab(app: &App, win: WindowId) -> Option<(i64, String)> {
    let w = app.windows.get(&win)?;
    let t = w.tabs.get(w.active)?;
    Some((t.id, t.url.clone()))
}

/// Parse omnibox input into a URL or search.
pub fn smart_url(input: &str, prefs: &crate::prefs::Prefs) -> String {
    let s = input.trim();
    if s.is_empty() {
        return tabs::NTP_URL.to_string();
    }
    let lower = s.to_lowercase();
    if lower.starts_with("zephyr://") {
        return s.to_string();
    }
    if lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("file://")
        || lower.starts_with("about:") || lower.starts_with("data:") || lower.starts_with("view-source:")
        || lower.starts_with("http:") || lower.starts_with("https:")
    {
        return s.to_string();
    }
    // localhost / IPv4
    let first = s.split_whitespace().next().unwrap_or("");
    if first.starts_with("localhost") || is_ipv4(first) {
        return format!("http://{}", first);
    }
    // bare domain heuristic: no spaces, has a dot, valid host chars, has a TLD-ish suffix
    if !s.contains(' ') && s.contains('.') {
        let host_part = s.split('/').next().unwrap_or(s);
        let host_part = host_part.split('?').next().unwrap_or(host_part);
        let host_part = host_part.split(':').next().unwrap_or(host_part);
        if !host_part.is_empty()
            && host_part.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
            && host_part.split('.').last().map(|tld| tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic())).unwrap_or(false)
        {
            return format!("https://{}", s);
        }
    }
    prefs.search_url_for(s)
}

fn is_ipv4(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 4
        && parts.iter().all(|p| p.parse::<u8>().is_ok())
}

// ---------------------------------------------------------------------------
// chrome / internal page commands
// ---------------------------------------------------------------------------
#[allow(clippy::too_many_lines)]
fn dispatch_chrome(app: &mut App, target: &EventLoopWindowTarget<UserEvent>, win: WindowId, tab: Option<i64>, msg: IpcMsg) {
    let cmd = msg.cmd.as_str();
    match cmd {
        // ---- boot
        "hello" => {
            if app.chrome_ready_ms.is_none() {
                app.chrome_ready_ms = Some(crate::util::now_ms());
            }
            // Seed default bookmarks on a fresh profile so the bookmarks bar
            // matches the product design out of the box.
            if app.db.exec(|c| {
                let mut stmt = c.prepare("SELECT COUNT(*) FROM bookmarks").unwrap();
                stmt.query_row([], |r| r.get::<_, i64>(0)).unwrap_or(0)
            }) == 0
            {
                for (url, title) in [
                    ("https://www.google.com/", "Google"),
                    ("https://www.youtube.com/", "YouTube"),
                    ("https://mail.google.com/", "Gmail"),
                    ("https://maps.google.com/", "Maps"),
                    ("https://drive.google.com/", "Drive"),
                ] {
                    models::bookmark_add(&app.db, url, title);
                }
            }
            // Seed the NTP shortcut tiles on a fresh profile (wed1.png design).
            if app.db.exec(|c| {
                let mut stmt = c.prepare("SELECT COUNT(*) FROM shortcuts").unwrap();
                stmt.query_row([], |r| r.get::<_, i64>(0)).unwrap_or(0)
            }) == 0
            {
                for (url, title) in [
                    ("https://www.google.com/", "Google"),
                    ("https://www.youtube.com/", "YouTube"),
                    ("https://mail.google.com/", "Gmail"),
                    ("https://maps.google.com/", "Maps"),
                    ("https://drive.google.com/", "Drive"),
                ] {
                    models::shortcut_add(&app.db, url, title);
                }
            }
            app.push_state(win);
        }
        "page-hello" => {
            page_hello(app, win, tab, &msg.s("page"));
        }

        // ---- navigation
        "nav" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                let url = smart_url(&msg.s("url"), &app.prefs);
                app.navigate_tab(win, id, &url);
            }
        }
        "nav-new-tab" => {
            let url = smart_url(&msg.s("url"), &app.prefs);
            app.new_tab(win, &url, msg.b("background"), true);
        }
        "nav-back" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                if let Some(url) = {
                    let w = app.windows.get_mut(&win).unwrap();
                    let t = w.tabs.iter_mut().find(|t| t.id == id).unwrap();
                    t.go_back()
                } {
                    app.navigate_tab(win, id, &url);
                }
            }
        }
        "nav-forward" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                if let Some(url) = {
                    let w = app.windows.get_mut(&win).unwrap();
                    let t = w.tabs.iter_mut().find(|t| t.id == id).unwrap();
                    t.go_forward()
                } {
                    app.navigate_tab(win, id, &url);
                }
            }
        }
        "nav-reload" => {
            if let Some((id, url)) = active_content_tab(app, win) {
                app.navigate_tab(win, id, &url);
            }
        }
        "nav-home" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                let home = app.prefs.homepage.clone();
                app.navigate_tab(win, id, &home);
            }
        }

        // ---- tabs
        "tab-new" => {
            app.new_tab(win, tabs::NTP_URL, false, true);
        }
        "tab-close" => {
            app.close_tab(win, msg.i("id"));
        }
        "tab-activate" => {
            if let Some(w) = app.windows.get(&win) {
                if let Some(idx) = w.tab_idx(msg.i("id")) {
                    app.activate_tab(win, idx, true);
                }
            }
        }
        "tab-pin" => {
            if let Some(w) = app.windows.get_mut(&win) {
                if let Some(t) = w.tabs.iter_mut().find(|t| t.id == msg.i("id")) {
                    t.pinned = msg.b("pinned");
                }
            }
            app.push_state(win);
        }
        "tab-mute" => {
            let muted = msg.b("muted");
            let tid = msg.i("id");
            if let Some(w) = app.windows.get_mut(&win) {
                if let Some(t) = w.tabs.iter_mut().find(|t| t.id == tid) {
                    t.muted = muted;
                }
            }
            let _ = app.with_tab_webview(win, tid, |wv| {
                let _ = wv.evaluate_script(&format!("window.__zxMuted&&__zxMuted({})", if muted { "true" } else { "false" }));
            });
            app.push_state(win);
        }
        "tab-move" => {
            let id = msg.i("id");
            let index = msg.i("index");
            if let Some(w) = app.windows.get_mut(&win) {
                let active_id = w.tabs.get(w.active).map(|t| t.id);
                if let Some(idx) = w.tab_idx(id) {
                    let len = w.tabs.len() as i64;
                    let target = index.clamp(0, len - 1) as usize;
                    if target != idx {
                        let tab = w.tabs.remove(idx);
                        w.tabs.insert(target, tab);
                    }
                }
                w.active = w.tabs.iter().position(|t| Some(t.id) == active_id).unwrap_or(0);
            }
            app.push_state(win);
        }
        "tab-suspend" => {
            app.suspend_tab(win, msg.i("id"));
        }
        "tab-close-others" => {
            let keep = msg.i("id");
            let ids: Vec<i64> = {
                let w = app.windows.get(&win).unwrap();
                w.tabs.iter().filter(|t| t.id != keep).map(|t| t.id).collect()
            };
            for id in ids {
                app.close_tab(win, id);
            }
        }
        "tab-duplicate" => {
            let id = msg.i("id");
            if let Some(w) = app.windows.get(&win) {
                if let Some(t) = w.tabs.iter().find(|t| t.id == id) {
                    let url = t.url.clone();
                    app.new_tab(win, &url, false, true);
                }
            }
        }
        "tab-restore-closed" => {
            let popped = {
                let w = app.windows.get_mut(&win).unwrap();
                w.closed.pop_front()
            };
            if let Some((url, _title)) = popped {
                app.new_tab(win, &url, false, true);
            }
        }

        // ---- omnibox
        "addr-query" => {
            addr_query(app, win, &msg.s("q"));
        }

        // ---- bookmarks
        "bm-add" | "bm-toggle" => {
            let (url, title) = match (msg.s("url").is_empty(), msg.s("title").is_empty()) {
                (false, _) => (msg.s("url"), msg.s("title")),
                _ => {
                    if let Some((_, u)) = active_content_tab(app, win) {
                        let t = {
                            let w = app.windows.get(&win).unwrap();
                            w.active_tab().map(|t| t.title.clone()).unwrap_or_default()
                        };
                        (u, t)
                    } else {
                        return;
                    }
                }
            };
            let exists = models::bookmark_exists(&app.db, &url);
            if cmd == "bm-toggle" && exists {
                models::bookmark_remove_url(&app.db, &url);
            } else {
                models::bookmark_add(&app.db, &url, &title);
            }
            app.push_state(win);
            push_to_requester(app, win, tab, "bm-changed", &json!({"url": url, "bookmarked": !exists}));
        }
        "bm-remove" => {
            let id = msg.i("id");
            if id > 0 {
                models::bookmark_remove(&app.db, id);
            } else if !msg.s("url").is_empty() {
                models::bookmark_remove_url(&app.db, &msg.s("url"));
            }
            push_to_requester(app, win, tab, "bm-changed", &json!({}));
        }
        "bm-list" => {
            let items: Vec<serde_json::Value> = models::bookmarks_list(&app.db, &msg.s("q"))
                .into_iter()
                .map(|b| json!({"id": b.id, "url": b.url, "title": b.title, "added": b.added}))
                .collect();
            push_to_requester(app, win, tab, "bm-data", &json!({"items": items}));
        }

        // ---- history
        "hist-list" => {
            let items: Vec<serde_json::Value> = models::history_list(&app.db, &msg.s("q"), 300, 0)
                .into_iter()
                .map(|h| json!({"id": h.id, "url": h.url, "title": h.title, "lastVisit": h.last_visit, "count": h.visit_count}))
                .collect();
            push_to_requester(app, win, tab, "hist-data", &json!({"items": items}));
        }
        "hist-remove" => {
            models::history_remove(&app.db, msg.i("id"));
            push_to_requester(app, win, tab, "hist-changed", &json!({}));
        }
        "hist-clear" => {
            models::history_clear(&app.db);
            push_to_requester(app, win, tab, "hist-changed", &json!({}));
        }

        // ---- downloads
        "dl-list" => {
            let items: Vec<serde_json::Value> = models::downloads_list(&app.db)
                .into_iter()
                .map(|d| json!({
                    "id": d.id, "url": d.url, "path": d.path, "size": d.size,
                    "state": d.state, "started": d.started, "finished": d.finished, "mime": d.mime
                }))
                .collect();
            push_to_requester(app, win, tab, "dl-data", &json!({"items": items}));
        }
        "dl-remove" => {
            models::download_remove(&app.db, msg.i("id"));
        }
        "dl-clear" => {
            models::downloads_clear(&app.db);
        }
        "dl-open" | "dl-show" => {
            let path = msg.s("path");
            if !path.is_empty() {
                open_path(&path, cmd == "dl-show");
            }
        }

        // ---- prefs
        "prefs-get" => {
            push_to_requester(app, win, tab, "prefs-data", &app.prefs.to_json());
        }
        "prefs-set" => {
            let key = msg.s("key");
            let value = msg.s("value");
            let result = app.prefs.set(&app.db, &key, &value);
            push_to_requester(app, win, tab, "prefs-changed", &json!({"key": key, "ok": result.is_some(), "value": result}));
            app.push_state(win);
        }

        // ---- permissions
        "perm-list" => {
            let items: Vec<serde_json::Value> = models::perm_list(&app.db)
                .into_iter()
                .map(|(o, k, v)| json!({"origin": o, "kind": k, "value": v}))
                .collect();
            push_to_requester(app, win, tab, "perm-data", &json!({"items": items}));
        }
        "perm-set" => {
            models::perm_set(&app.db, &msg.s("origin"), &msg.s("kind"), &msg.s("value"));
        }
        "perm-clear" => {
            let origin = msg.s("origin");
            models::perm_clear(&app.db, if origin.is_empty() { None } else { Some(&origin) });
        }
        "perm-answer" => {
            let req_id = msg.i("reqId");
            let allow = msg.b("allow");
            if let Some((win_id, tab_id, kind, origin)) = app.pending_perm.remove(&req_id) {
                models::perm_set(&app.db, &origin, &kind, if allow { "allow" } else { "block" });
                let js = format!("window.__zxPermReply&&__zxPermReply({}, {})", req_id, if allow { "true" } else { "false" });
                let _ = app.with_tab_webview(win_id, tab_id, |wv| {
                    let _ = wv.evaluate_script(&js);
                });
                app.push_state(win_id);
            }
        }

        // ---- passwords
        "pw-list" => {
            let items: Vec<serde_json::Value> = crate::passwords::list(&app.db)
                .into_iter()
                .map(|p| json!({"id": p.id, "origin": p.origin, "username": p.username, "created": p.created}))
                .collect();
            push_to_requester(app, win, tab, "pw-data", &json!({"items": items, "autofill": app.prefs.password_autofill}));
        }
        "pw-remove" => {
            crate::passwords::remove(&app.db, msg.i("id"));
        }
        "pw-save-confirm" => {
            let tid = msg.i("tab");
            if let Some((origin, user, secret)) = app.pending_pw.remove(&tid) {
                if let Some(vault) = &app.vault {
                    crate::passwords::save(&app.db, vault, &origin, &user, &secret);
                }
                for id in app.windows.keys().copied().collect::<Vec<_>>() {
                    app.chrome_push(id, "pw-saved", &json!({"origin": origin, "username": user}));
                }
            }
        }
        "pw-save-dismiss" => {
            app.pending_pw.remove(&msg.i("tab"));
        }

        // ---- filter lists
        "lists-list" => {
            let engine = &app.engine;
            let items: Vec<serde_json::Value> = engine
                .lists_meta
                .iter()
                .map(|m| {
                    json!({
                        "name": m.name, "url": m.url, "kind": m.kind, "builtin": m.builtin,
                        "enabled": m.enabled, "lastUpdated": m.last_updated, "ruleCount": m.rule_count,
                    })
                })
                .collect();
            push_to_requester(app, win, tab, "lists-data", &json!({"items": items, "totalRules": engine.rule_count}));
        }
        "lists-update" => {
            let db = app.db.clone();
            let data_dir = app.data_dir.clone();
            let proxy = app.proxy.clone();
            let metas: Vec<(String, String, String)> = app
                .engine
                .lists_meta
                .iter()
                .filter(|m| m.enabled && !m.url.is_empty())
                .map(|m| (m.name.clone(), m.url.clone(), m.kind.clone()))
                .collect();
            std::thread::spawn(move || {
                let mut ok = 0;
                let mut fail: Vec<String> = vec![];
                for (name, url, kind) in metas {
                    match crate::filters::update_list(&db, &data_dir, &name, &url, &kind) {
                        Ok(_) => ok += 1,
                        Err(e) => fail.push(format!("{}: {}", name, e)),
                    }
                }
                let summary = if fail.is_empty() {
                    format!("{} list(s) updated", ok)
                } else {
                    format!("{} updated; failed: {}", ok, fail.join("; "))
                };
                let _ = proxy.send_event(UserEvent::ListUpdateDone(if fail.is_empty() { Ok(summary) } else { Err(summary) }));
            });
        }
        "lists-add" => {
            let name = if msg.s("name").is_empty() {
                format!("custom-{}", crate::util::now_ms() % 100000)
            } else {
                msg.s("name")
            };
            let url = msg.s("url");
            if url.starts_with("https://") {
                let db = app.db.clone();
                let data_dir = app.data_dir.clone();
                let proxy = app.proxy.clone();
                let kind = msg.s("kind");
                let (n, u, k) = (name.clone(), url.clone(), kind.clone());
                std::thread::spawn(move || {
                    let res = crate::filters::update_list(&db, &data_dir, &n, &u, &k)
                        .map(|c| format!("{} rules", c))
                        .map_err(|e| e);
                    let _ = proxy.send_event(UserEvent::ListUpdateDone(res));
                });
            }
        }
        "lists-remove" => {
            app.db.exec(|c| {
                let _ = c.execute("DELETE FROM filter_lists WHERE name=?1 AND builtin=0", rusqlite::params![msg.s("name")]);
            });
            let p = app.data_dir.join("lists").join(format!("{}.txt", msg.s("name")));
            let _ = std::fs::remove_file(p);
            app.rebuild_engine();
        }
        "lists-toggle" => {
            let name = msg.s("name");
            let enabled = msg.b("enabled");
            app.db.exec(|c| {
                let _ = c.execute("UPDATE filter_lists SET enabled=?2 WHERE name=?1", rusqlite::params![name, enabled as i64]);
            });
            app.rebuild_engine();
        }

        // ---- stats
        "stats-get" => {
            let today = models::stats_get_day(&app.db, &crate::util::today_key());
            let (active_host, recent): (Option<String>, Vec<serde_json::Value>) = {
                match app.windows.get(&win).and_then(|w| w.active_tab()) {
                    Some(t) => (
                        url_host(&t.url),
                        t.blocked_recent.iter().rev().take(120).map(|(h, c)| json!({"host": h, "class": c})).collect(),
                    ),
                    None => (None, vec![]),
                }
            };
            let payload = json!({
                "session": {
                    "ads": app.session_stats.ads, "trackers": app.session_stats.trackers,
                    "cosmetic": app.session_stats.cosmetic, "params": app.session_stats.params,
                    "malicious": app.session_stats.malicious,
                },
                "today": {
                    "ads": today.ads, "trackers": today.trackers, "cosmetic": today.cosmetic,
                    "params": today.params,
                },
                "activeHost": active_host,
                "layers": {
                    "adblock_enabled": app.prefs.adblock_enabled,
                    "netfilter_enabled": app.prefs.netfilter_enabled,
                    "cosmetic_enabled": app.prefs.cosmetic_enabled,
                    "strip_tracking_params": app.prefs.strip_tracking_params,
                    "block_malicious": app.prefs.block_malicious,
                    "fp_canvas": app.prefs.fp_canvas,
                    "fp_audio": app.prefs.fp_audio,
                    "fp_webgl": app.prefs.fp_webgl,
                    "fp_navigator": app.prefs.fp_navigator,
                },
                "recent": recent,
                "ruleCount": app.engine.rule_count,
                "lists": app.engine.lists_meta.iter().map(|m| json!({"name": m.name, "enabled": m.enabled, "rules": m.rule_count})).collect::<Vec<_>>(),
            });
            push_to_requester(app, win, tab, "stats-data", &payload);
        }

        // ---- NTP
        "ntp-data" => {
            let top: Vec<serde_json::Value> = models::top_sites(&app.db, 12)
                .into_iter()
                .map(|t| {
                    json!({"host": t.host, "url": t.url, "title": if t.title.is_empty() { t.host.clone() } else { t.title },
                           "color": models::host_color(&t.host), "visits": t.visit_count})
                })
                .collect();
            let shortcuts: Vec<serde_json::Value> = models::shortcuts_list(&app.db)
                .into_iter()
                .map(|s| json!({"id": s.id, "url": s.url, "title": s.title, "host": url_host(&s.url).unwrap_or_default()}))
                .collect();
            push_to_requester(app, win, tab, "ntp-data", &json!({
                "topSites": top, "shortcuts": shortcuts,
                "stats": {
                    "ads": app.session_stats.ads, "trackers": app.session_stats.trackers,
                    "cosmetic": app.session_stats.cosmetic, "params": app.session_stats.params,
                },
                "searchEngine": app.prefs.search_engine,
            }));
        }
        "shortcut-add" => {
            models::shortcut_add(&app.db, &msg.s("url"), &msg.s("title"));
        }
        "shortcut-remove" => {
            models::shortcut_remove(&app.db, msg.i("id"));
        }

        // ---- find in page
        "find-open" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                if let Some(w) = app.windows.get_mut(&win) {
                    if let Some(t) = w.tabs.iter_mut().find(|t| t.id == id) {
                        t.find_open = true;
                    }
                }
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script("window.__zxFinder&&__zxFinder.open()");
                });
                app.show_findbar(win);
                app.push_state(win);
            }
        }
        "find-query" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                let q = msg.s("q").replace('\\', "\\\\").replace('\'', "\\'");
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script(&format!("window.__zxFinder&&__zxFinder.query('{}')", q));
                });
            }
        }
        "find-next" | "find-prev" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                let m = if cmd == "find-next" { "next" } else { "prev" };
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script(&format!("window.__zxFinder&&__zxFinder.{}()", m));
                });
            }
        }
        "find-close" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                if let Some(w) = app.windows.get_mut(&win) {
                    if let Some(t) = w.tabs.iter_mut().find(|t| t.id == id) {
                        t.find_open = false;
                    }
                }
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script("window.__zxFinder&&__zxFinder.close()");
                });
                app.hide_findbar(win);
                app.push_state(win);
            }
        }

        // ---- window / page actions
        "win-new" => {
            let _ = app.create_window(target, None);
        }
        "win-close" => {
            app.close_window(win);
        }
        "win-min" => {
            if let Some(w) = app.windows.get(&win) {
                w.window.set_minimized(true);
            }
        }
        "win-max-toggle" => {
            if let Some(w) = app.windows.get(&win) {
                let m = w.window.is_maximized();
                w.window.set_maximized(!m);
                let maxed = w.window.is_maximized();
                app.chrome_push(win, "win-state", &json!({"maximized": maxed}));
                app.relayout(win);
            }
        }
        "win-drag" => {
            if let Some(w) = app.windows.get(&win) {
                let _ = w.window.drag_window();
            }
        }
        "win-resize" => {
            use tao::window::ResizeDirection;
            let dir = msg.s("dir");
            if let Some(w) = app.windows.get(&win) {
                let d = match dir.as_str() {
                    "n" => Some(ResizeDirection::North),
                    "s" => Some(ResizeDirection::South),
                    "e" => Some(ResizeDirection::East),
                    "w" => Some(ResizeDirection::West),
                    "ne" => Some(ResizeDirection::NorthEast),
                    "nw" => Some(ResizeDirection::NorthWest),
                    "se" => Some(ResizeDirection::SouthEast),
                    "sw" => Some(ResizeDirection::SouthWest),
                    _ => None,
                };
                if let Some(d) = d {
                    let _ = w.window.drag_resize_window(d);
                }
            }
        }

        // ---- overlay layer (menus / suggestions / prompts / toasts)
        "overlay-open" | "overlay-close" | "overlay-hide" | "overlay-need" => {
            if cmd == "overlay-open" {
                let theme = if app.prefs.theme == "system" {
                    if std::env::var("ZEPHYR_DARK").map(|v| v == "1").unwrap_or(false) { "dark".to_string() } else { "light".to_string() }
                } else {
                    app.prefs.theme.clone()
                };
                let payload = json!({
                    "kind": msg.s("kind"),
                    "x": msg.f("x"),
                    "y": msg.f("y"),
                    "w": msg.f("w"),
                    "payload": msg.data.get("payload").cloned().unwrap_or(json!({})),
                    "theme": theme,
                });
                app.show_overlay(win);
                app.overlay_eval(win, &push_js("popup-open", &payload));
            } else if cmd == "overlay-need" {
                if msg.b("on") {
                    app.show_overlay(win);
                } else {
                    app.hide_overlay(win);
                }
            } else {
                app.hide_overlay(win);
                app.chrome_push(win, "popup-closed", &json!({}));
            }
        }

        // ---- weather for the new tab page (open-meteo, IP-located, 30 min cache)
        "weather" => {
            if !app.prefs.weather_enabled {
                let _ = app.proxy.send_event(UserEvent::WeatherData {
                    win,
                    tab,
                    data: json!({"err": "disabled"}),
                });
            } else {
                let cached = app.weather_cache.lock().unwrap().clone();
                let fresh = matches!(&cached, Some((t, _)) if now_ms() - *t < 30 * 60 * 1000);
                if let (true, Some((_, v))) = (fresh, cached) {
                    let _ = app.proxy.send_event(UserEvent::WeatherData { win, tab, data: v });
                } else {
                    let proxy = app.proxy.clone();
                    let win_c = win;
                    let tab_c = tab;
                    std::thread::spawn(move || {
                        let data = fetch_weather();
                        let _ = proxy.send_event(UserEvent::WeatherData { win: win_c, tab: tab_c, data });
                    });
                }
            }
        }
        "fullscreen" => {
            if let Some(w) = app.windows.get(&win) {
                let cur = w.window.fullscreen().is_some();
                w.window.set_fullscreen(if cur { None } else { Some(tao::window::Fullscreen::Borderless(None)) });
            }
        }
        "print-page" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.print();
                });
            }
        }
        "save-page" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.evaluate_script("window.__zxSavePage&&__zxSavePage()");
                });
            }
        }
        "view-source" => {
            let url = if msg.s("url").is_empty() {
                active_content_tab(app, win).map(|(_, u)| u).unwrap_or_default()
            } else {
                msg.s("url")
            };
            if !url.is_empty() {
                let src = format!("zephyr://source?u={}", urlencode(&url));
                app.new_tab(win, &src, false, true);
            }
        }
        "get-source" => {
            get_source_async(app, win, tab, &msg.s("url"));
        }
        "devtools" => {
            if app.prefs.devtools_enabled {
                if let Some((id, _)) = active_content_tab(app, win) {
                    let _ = app.with_tab_webview(win, id, |wv| wv.open_devtools());
                }
            }
        }

        // ---- zoom
        "zoom-set" => {
            if let Some((id, url)) = active_content_tab(app, win) {
                let factor = msg.f("factor").clamp(0.3, 3.0);
                if let Some(w) = app.windows.get_mut(&win) {
                    if let Some(t) = w.tabs.iter_mut().find(|t| t.id == id) {
                        t.zoom = factor;
                    }
                }
                models::zoom_set(&app.db, &url, factor);
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.zoom(factor);
                });
                app.push_state(win);
            }
        }
        "zoom-inc" | "zoom-dec" | "zoom-reset" => {
            if let Some((id, _)) = active_content_tab(app, win) {
                let cur = app
                    .windows
                    .get(&win)
                    .and_then(|w| w.tabs.iter().find(|t| t.id == id))
                    .map(|t| t.zoom)
                    .unwrap_or(1.0);
                let factor = match cmd {
                    "zoom-inc" => (cur + 0.1).min(3.0),
                    "zoom-dec" => (cur - 0.1).max(0.3),
                    _ => 1.0,
                };
                let factor = (factor * 10.0).round() / 10.0;
                if let Some(w) = app.windows.get_mut(&win) {
                    if let Some(t) = w.tabs.iter_mut().find(|t| t.id == id) {
                        t.zoom = factor;
                    }
                }
                let _ = app.with_tab_webview(win, id, |wv| {
                    let _ = wv.zoom(factor);
                });
                app.push_state(win);
            }
        }

        // ---- session / data clearing
        "session-save" => {
            app.save_session();
        }
        "clear-data" => {
            let hist = msg.b("history");
            let bm = msg.b("bookmarks");
            let dl = msg.b("downloads");
            let perms = msg.b("permissions");
            let cookies = msg.b("cookies");
            let passwords = msg.b("passwords");
            if hist {
                models::history_clear(&app.db);
            }
            if bm {
                app.db.exec(|c| {
                    let _ = c.execute("DELETE FROM bookmarks", []);
                });
            }
            if dl {
                app.db.exec(|c| {
                    let _ = c.execute("DELETE FROM downloads", []);
                });
            }
            if perms {
                models::perm_clear(&app.db, None);
            }
            if passwords {
                app.db.exec(|c| {
                    let _ = c.execute("DELETE FROM passwords", []);
                });
            }
            if cookies {
                let wins: Vec<WindowId> = app.windows.keys().copied().collect();
                for id in wins {
                    let _ = app.with_active_webview(id, |wv| {
                        let _ = wv.clear_all_browsing_data();
                    });
                }
            }
            app.chrome_push(win, "data-cleared", &json!({"history": hist, "cookies": cookies}));
            app.push_state(win);
        }

        // ---- blocked page
        "allow-once" => {
            let url = msg.s("url");
            if let Some(origin) = url_origin(&url) {
                if let Ok(mut ex) = app.session_exceptions.lock() {
                    ex.insert(origin);
                }
            }
            if let Some((id, _)) = active_content_tab(app, win) {
                app.navigate_tab(win, id, &url);
            }
        }

        // ---- chrome layout cooperation
        "chrome-height" => {
            let h = msg.f("h");
            if h > 0.0 {
                app.set_chrome_height(win, Some(h));
            } else {
                app.set_chrome_height(win, None);
            }
        }
        "chrome-collapse" => {
            app.hide_overlay(win);
            app.chrome_push(win, "close-menus", &json!({}));
        }
        "chrome-error" => {
            crate::zerror!("chrome-js", "{} ({}:{})", msg.s("msg"), msg.s("src"), msg.i("line"));
        }

        // ---- search engine list (for settings page)
        "search-engines" => {
            let items: Vec<serde_json::Value> = SEARCH_ENGINES.iter().map(|(k, n)| json!({"key": k, "name": n})).collect();
            push_to_requester(app, win, tab, "search-engines", &json!({"items": items}));
        }

        _ => {
            crate::zdebug!("ipc", "unhandled chrome cmd: {}", cmd);
        }
    }
}

// ---------------------------------------------------------------------------
// content page commands (from injected scripts)
// ---------------------------------------------------------------------------
#[allow(clippy::too_many_lines)]
fn dispatch_content(app: &mut App, target: &EventLoopWindowTarget<UserEvent>, win: WindowId, tab: Option<i64>, msg: IpcMsg) {
    let Some(tab_id) = tab else { return };
    let cmd = msg.cmd.as_str();
    match cmd {
        "title" => {
            let title = msg.s("title");
            let is_active = app
                .windows
                .get(&win)
                .map(|w| w.active_tab().map(|t| t.id) == Some(tab_id))
                .unwrap_or(false);
            if let Some(w) = app.windows.get_mut(&win) {
                if let Some(t) = w.tabs.iter_mut().find(|t| t.id == tab_id) {
                    t.title = title.clone();
                }
                if is_active {
                    let full = if title.is_empty() { "Zephyr".to_string() } else { format!("{} — Zephyr", title) };
                    w.window.set_title(&full);
                }
            }
            app.push_state(win);
        }
        "load-started" => {
            let canon = app.canonical_url(&msg.s("url"));
            if let Some(w) = app.windows.get_mut(&win) {
                if let Some(t) = w.tabs.iter_mut().find(|t| t.id == tab_id) {
                    t.loading = true;
                    t.url = canon;
                }
            }
            app.push_state(win);
        }
        "load-finished" => {
            let canon = app.canonical_url(&msg.s("url"));
            let is_content = {
                let w = app.windows.get(&win).unwrap();
                let t = w.tabs.iter().find(|t| t.id == tab_id).unwrap();
                t.kind == TabKind::Content
            };
            let (title, prev_url) = {
                let w = app.windows.get_mut(&win).unwrap();
                let t = w.tabs.iter_mut().find(|t| t.id == tab_id).unwrap();
                t.loading = false;
                if canon != t.url {
                    let prev = t.url.clone();
                    t.push_history(&canon);
                    (t.title.clone(), prev)
                } else {
                    (t.title.clone(), t.url.clone())
                }
            };
            let _ = prev_url;
            // record history + fetch favicon for real web pages (and smoke fixtures)
            if is_content && (canon.starts_with("http://") || canon.starts_with("https://") || canon.starts_with("zephyr://fixture/")) {
                let t = {
                    let w = app.windows.get(&win).unwrap();
                    w.tabs.iter().find(|t| t.id == tab_id).unwrap().clone()
                };
                let title = if t.title.is_empty() {
                    url_host(&canon).unwrap_or_else(|| canon.clone())
                } else {
                    t.title.clone()
                };
                models::add_visit(&app.db, &canon, &title);
                // zoom per-origin
                let z = models::zoom_get(&app.db, &canon);
                if (z - t.zoom).abs() > 0.01 {
                    let _ = app.with_tab_webview(win, tab_id, |wv| {
                        let _ = wv.zoom(z);
                    });
                    if let Some(w) = app.windows.get_mut(&win) {
                        if let Some(t2) = w.tabs.iter_mut().find(|t2| t2.id == tab_id) {
                            t2.zoom = z;
                        }
                    }
                }
                app.queue_favicon(tab_id, &canon);
                // password autofill
                if app.prefs.password_autofill {
                    if let Some(vault) = &app.vault {
                        let origin = url_origin(&canon).unwrap_or_default();
                        let creds = crate::passwords::find_for_origin(&app.db, vault, &origin);
                        if let Some((_, user, pass)) = creds.first() {
                            let u = user.replace('\\', "\\\\").replace('\'', "\\'");
                            let p = pass.replace('\\', "\\\\").replace('\'', "\\'");
                            let _ = app.with_tab_webview(win, tab_id, |wv| {
                                let _ = wv.evaluate_script(&format!(
                                    "window.__zxAutofill&&__zxAutofill('{}','{}')",
                                    u, p
                                ));
                            });
                        }
                    }
                }
            }
            app.push_state(win);
        }
        "nav-spa" => {
            let canon = app.canonical_url(&msg.s("url"));
            if let Some(w) = app.windows.get_mut(&win) {
                if let Some(t) = w.tabs.iter_mut().find(|t| t.id == tab_id) {
                    if canon != t.url {
                        t.push_history(&canon);
                    }
                }
                if w.active_tab().map(|t| t.id) == Some(tab_id) {
                    let title = w.active_tab().map(|t| t.title.clone()).unwrap_or_default();
                    let full = if title.is_empty() { "Zephyr".to_string() } else { format!("{} — Zephyr", title) };
                    w.window.set_title(&full);
                }
            }
            app.push_state(win);
        }
        "newtab" => {
            let url = smart_url(&msg.s("url"), &app.prefs);
            app.new_tab(win, &url, false, true);
        }
        "blocked-batch" => {
            let ads = msg.i("ads").max(0) as u64;
            let trackers = msg.i("trackers").max(0) as u64;
            let cosmetic_total = msg.i("cosmeticTotal").max(0) as u64;
            let params = msg.i("params").max(0) as u64;
            let hosts: Vec<(String, String)> = msg
                .data
                .get("hosts")
                .and_then(|h| h.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|o| {
                            Some((
                                o.get("host").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                o.get("class").and_then(|v| v.as_str()).unwrap_or("ads").to_string(),
                            ))
                        })
                        .collect()
                })
                .unwrap_or_default();
            app.session_stats.ads += ads;
            app.session_stats.trackers += trackers;
            app.session_stats.params += params;
            let mut cosmetic_delta = 0u64;
            if let Some(w) = app.windows.get_mut(&win) {
                if let Some(t) = w.tabs.iter_mut().find(|t| t.id == tab_id) {
                    t.ads += ads;
                    t.trackers += trackers;
                    t.params += params;
                    if cosmetic_total > 0 {
                        // cosmetic arrives as a running TOTAL for the page
                        if cosmetic_total > t.cosmetic {
                            cosmetic_delta = cosmetic_total - t.cosmetic;
                            t.cosmetic = cosmetic_total;
                        }
                    }
                    for (h, c) in hosts {
                        t.blocked_recent.push_back((h, c));
                        if t.blocked_recent.len() > 200 {
                            t.blocked_recent.pop_front();
                        }
                    }
                }
            }
            app.session_stats.cosmetic += cosmetic_delta;
            if ads + trackers + cosmetic_delta + params > 0 {
                app.push_state(win);
            }
        }
        "media-state" => {
            let playing = msg.b("playing");
            let _ = playing; // tab speaker icon handled via muted state + title
        }
        "pw-detect" => {
            // only for content tabs with autofill enabled
            if !app.prefs.password_autofill {
                return;
            }
            let origin = msg.s("origin");
            let user = msg.s("user");
            let secret = msg.s("pw");
            if origin.is_empty() || user.is_empty() || secret.is_empty() {
                return;
            }
            // Don't re-prompt when we already have this exact pair
            if let Some(vault) = &app.vault {
                let existing = crate::passwords::find_for_origin(&app.db, vault, &origin);
                if existing.iter().any(|(_, u, s)| *u == user && *s == secret) {
                    return;
                }
            }
            // smoke mode: save directly (deterministic CI verification)
            if app.smoke_mode {
                if let Some(vault) = &app.vault {
                    crate::passwords::save(&app.db, vault, &origin, &user, &secret);
                }
                return;
            }
            app.pending_pw.insert(tab_id, (origin.clone(), user.clone(), secret));
            app.chrome_push(win, "pw-prompt", &json!({"tab": tab_id, "origin": origin, "username": user}));
        }
        "perm-request" => {
            let kind = msg.s("kind");
            let rid = msg.i("id").max(1);
            let origin = {
                let w = app.windows.get(&win).unwrap();
                let t = w.tabs.iter().find(|t| t.id == tab_id).unwrap();
                url_origin(&t.url).unwrap_or_default()
            };
            if origin.is_empty() {
                return;
            }
            let eff = models::perm_effective(&app.db, &app.prefs, &origin, &kind);
            // smoke mode: auto-deny permission prompts (deterministic)
            if app.smoke_mode {
                let _ = app.with_tab_webview(win, tab_id, |wv| {
                    let _ = wv.evaluate_script(&format!("window.__zxPermReply&&__zxPermReply({},false)", rid));
                });
                return;
            }
            match eff.as_str() {
                "allow" => {
                    let _ = app.with_tab_webview(win, tab_id, |wv| {
                        let _ = wv.evaluate_script(&format!("window.__zxPermReply&&__zxPermReply({},true)", rid));
                    });
                }
                "block" => {
                    let _ = app.with_tab_webview(win, tab_id, |wv| {
                        let _ = wv.evaluate_script(&format!("window.__zxPermReply&&__zxPermReply({},false)", rid));
                    });
                }
                _ => {
                    // ask
                    app.pending_perm.insert(rid, (win, tab_id, kind.clone(), origin.clone()));
                    app.chrome_push(win, "perm-prompt", &json!({"reqId": rid, "kind": kind, "origin": origin}));
                }
            }
        }
        "find-result" => {
            let count = msg.i("count");
            let active = msg.i("active");
            if let Some(sm) = app.smoke.as_mut() {
                sm.find_count = count;
                sm.find_active = active;
            }
            app.chrome_push(win, "find-result", &json!({"count": count, "active": active}));
        }
        "page-html" => {
            let html = msg.s("html");
            let (title, url) = {
                let w = app.windows.get(&win).unwrap();
                let t = w.tabs.iter().find(|t| t.id == tab_id).unwrap();
                (t.title.clone(), t.url.clone())
            };
            let dir = download_dir(&app.prefs, &app.data_dir);
            let name = format!("{}.html", crate::util::sanitize_filename(if title.is_empty() { "page" } else { &title }));
            let path = crate::util::unique_path(&dir, &name);
            match std::fs::write(&path, html.as_bytes()) {
                Ok(_) => {
                    let size = html.len() as i64;
                    let id = models::download_add(&app.db, &url, &path.to_string_lossy(), "text/html");
                    models::download_update(&app.db, id, size, "done");
                    app.chrome_push(win, "page-saved", &json!({"path": path.to_string_lossy()}));
                }
                Err(e) => {
                    app.chrome_push(win, "toast", &json!({"kind": "error", "text": format!("Save failed: {}", e)}));
                }
            }
        }
        "gesture-newtab" => {
            app.new_tab(win, tabs::NTP_URL, false, true);
        }
        "smoke-results" => {
            if let Some(sm) = app.smoke.as_mut() {
                if let Some(v) = msg.data.get("results").cloned() {
                    sm.results = Some(v);
                }
            }
        }
        // shortcuts triggered inside content pages — route to chrome handlers
        "find-open" | "print-page" | "bm-add" | "view-source" | "save-page" | "zoom-inc" | "zoom-dec" | "zoom-reset" | "fullscreen" | "devtools" => {
            let forward = IpcMsg {
                ns: "chrome".into(),
                cmd: msg.cmd.clone(),
                tab: None,
                data: serde_json::Value::Null,
            };
            dispatch_chrome(app, target, win, None, forward);
        }
        _ => {
            crate::zdebug!("ipc", "unhandled content cmd: {}", cmd);
        }
    }
}

fn origin_url_helper(origin: &str) -> String {
    origin.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::prefs::Prefs;

    #[test]
    fn smart_url_cases() {
        let p = Prefs::default();
        assert_eq!(smart_url("example.com", &p), "https://example.com");
        assert_eq!(smart_url("http://a.com", &p), "http://a.com");
        assert_eq!(smart_url("localhost:3000", &p), "http://localhost:3000");
        assert_eq!(smart_url("192.168.1.4", &p), "http://192.168.1.4");
        assert!(smart_url("hello world", &p).starts_with("https://duckduckgo.com"));
        assert_eq!(smart_url("", &p), crate::tabs::NTP_URL);
        assert_eq!(smart_url("zephyr://settings", &p), "zephyr://settings");
        assert!(smart_url("rust lang book", &p).contains("q="));
    }

    #[test]
    fn urlencode_works() {
        assert_eq!(urlencode("a b&c"), "a%20b%26c");
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
pub fn push_to_requester(app: &mut App, win: WindowId, tab: Option<i64>, event: &str, payload: &serde_json::Value) {
    let js = crate::messages::push_js(event, payload);
    if let Some(tid) = tab {
        if app.with_tab_webview(win, tid, |_| ()).is_some() {
            let _ = app.with_tab_webview(win, tid, |wv| {
                let _ = wv.evaluate_script(&js);
            });
            return;
        }
    }
    app.chrome_eval(win, &js);
}

fn addr_query(app: &mut App, win: WindowId, q: &str) {
    let q = q.trim();
    if q.is_empty() {
        app.chrome_push(win, "suggest", &json!({"items": []}));
        return;
    }
    let lower = q.to_lowercase();
    let mut items: Vec<serde_json::Value> = vec![];
    // history matches
    for h in models::history_list(&app.db, q, 5, 0) {
        items.push(json!({"kind": "history", "url": h.url, "title": h.title}));
    }
    // bookmark matches
    for b in models::bookmarks_list(&app.db, q).into_iter().take(3) {
        items.push(json!({"kind": "bookmark", "url": b.url, "title": b.title}));
    }
    // direct URL
    let su = smart_url(q, &app.prefs);
    if su != q && !lower.starts_with("zephyr://") {
        items.push(json!({"kind": "url", "url": su, "title": su}));
    }
    // search
    if !q.contains('.') || q.contains(' ') {
        items.push(json!({"kind": "search", "url": app.prefs.search_url_for(q), "title": q}));
    }
    app.chrome_push(win, "suggest", &json!({"items": items, "q": lower}));
}

fn page_hello(app: &mut App, win: WindowId, tab: Option<i64>, page: &str) {
    match page {
        "settings" => {
            push_to_requester(app, win, tab, "prefs-data", &app.prefs.to_json());
            let items: Vec<serde_json::Value> = SEARCH_ENGINES.iter().map(|(k, n)| json!({"key": k, "name": n})).collect();
            push_to_requester(app, win, tab, "search-engines", &json!({"items": items}));
            let engine = &app.engine;
            let lists: Vec<serde_json::Value> = engine
                .lists_meta
                .iter()
                .map(|m| {
                    json!({"name": m.name, "url": m.url, "kind": m.kind, "builtin": m.builtin,
                           "enabled": m.enabled, "lastUpdated": m.last_updated, "ruleCount": m.rule_count})
                })
                .collect();
            push_to_requester(app, win, tab, "lists-data", &json!({"items": lists, "totalRules": engine.rule_count}));
            push_to_requester(app, win, tab, "dl-dir", &json!({"dir": app.prefs.download_dir}));
        }
        "privacy" => {
            // handled via stats-get; page asks explicitly
        }
        "history" | "bookmarks" | "downloads" => {
            // pages issue their own list queries
        }
        "blocked" | "error" | "source" => {}
        _ => {}
    }
}

fn get_source_async(app: &mut App, win: WindowId, tab: Option<i64>, url: &str) {
    let Some(tid) = tab else { return };
    let proxy = app.proxy.clone();
    let url = url.to_string();
    std::thread::spawn(move || {
        let agent = ureq::AgentBuilder::new()
            .timeout(std::time::Duration::from_secs(12))
            .redirects(4)
            .build();
        let body = agent
            .get(&url)
            .set("User-Agent", crate::prefs::ZEPHYR_UA)
            .call()
            .ok()
            .and_then(|r| {
                let mut buf = String::new();
                use std::io::Read;
                r.into_reader().read_to_string(&mut buf).ok().map(|_| buf)
            })
            .unwrap_or_else(|| "/* fetch failed */".to_string());
        let _ = proxy.send_event(UserEvent::SourceReady { win, tab: tid, url, body });
    });
}

pub fn open_path(path: &str, show_in_folder: bool) {
    #[cfg(target_os = "windows")]
    {
        if show_in_folder {
            let _ = std::process::Command::new("explorer").arg("/select,").arg(path).spawn();
        } else {
            let _ = std::process::Command::new("explorer").arg(path).spawn();
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if show_in_folder {
            let parent = std::path::Path::new(path).parent().map(|p| p.to_path_buf()).unwrap_or_default();
            let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
        } else {
            let _ = std::process::Command::new("xdg-open").arg(path).spawn();
        }
    }
}
