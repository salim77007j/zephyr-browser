// Zephyr Browser — application core: windows, webviews, event loop, layout.
// The IPC command dispatch lives in commands.rs.
use crate::chrome_server::ChromeServer;
use crate::db::Db;
use crate::filters::{Engine, BlockClass};
use crate::messages::{push_js, IpcMsg};
use crate::models;
use crate::passwords::Vault;
use crate::prefs::{Prefs, CHROME_UA, ZEPHYR_UA};
use crate::tabs::{self, resolve_internal, Session, SessionTab, SessionWindow, Tab, TabKind};
use crate::util::{now_ms, url_host, url_origin};
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tao::dpi::{LogicalPosition, LogicalSize};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopProxy, EventLoopWindowTarget};
use tao::window::{Fullscreen, Window, WindowBuilder, WindowId};
use wry::{BackgroundThrottlingPolicy, PageLoadEvent, Rect, WebView, WebViewBuilder};

pub const CHROME_H: f64 = 86.0;

#[derive(Debug)]
pub enum UserEvent {
    Ipc { win: WindowId, tab: Option<i64>, raw: String },
    IpcBlockedNav { win: WindowId, tab: i64, url: String, class: String },
    Tick,
    Favicon { tab: i64, dataurl: String },
    ListUpdateDone(Result<String, String>),
    SourceReady { win: WindowId, tab: i64, url: String, body: String },
    Smoke(u32),
    Exit(i32),
}

pub struct BrowserWindow {
    pub window: Window,
    pub chrome: WebView,
    /// dynamic chrome height override (menus/suggestions/find bar open)
    pub chrome_h: Option<f64>,
    pub tabs: Vec<Tab>,
    pub active: usize,
    pub next_tab_id: i64,
    pub closed: VecDeque<(String, String)>,
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd"
    ))]
    pub gtk_fixed: gtk::Fixed,
}

impl BrowserWindow {
    pub fn tab_idx(&self, id: i64) -> Option<usize> {
        self.tabs.iter().position(|t| t.id == id)
    }
    pub fn active_tab(&self) -> Option<&Tab> {
        self.tabs.get(self.active)
    }
    pub fn live_webviews(&self) -> usize {
        self.tabs.iter().filter(|t| t.webview.is_some()).count()
    }
}

pub struct App {
    pub db: Db,
    pub prefs: Prefs,
    pub engine: Arc<Engine>,
    pub filter_payload: String,
    pub vault: Option<Vault>,
    pub server: ChromeServer,
    pub windows: HashMap<WindowId, BrowserWindow>,
    pub proxy: EventLoopProxy<UserEvent>,
    pub data_dir: PathBuf,
    pub session_stats: models::StatCounts,
    pub session_exceptions: Arc<Mutex<HashSet<String>>>,
    /// per-tab pending password (tab_id -> (origin, user, secret)) — RAM only
    pub pending_pw: HashMap<i64, (String, String, String)>,
    /// pending permission requests (req_id -> (win, tab, kind, origin))
    pub pending_perm: HashMap<i64, (WindowId, i64, String, String)>,
    pub next_req_id: u64,
    /// active downloads: url -> (db id, path)
    pub active_downloads: Arc<Mutex<HashMap<String, (i64, PathBuf)>>>,
    pub favicon_seen: HashSet<String>,
    pub smoke: Option<crate::smoke::SmokeCtx>,
    pub start_ms: u64,
    pub chrome_ready_ms: Option<u64>,
    pub quitting: bool,
    pub smoke_mode: bool,
    pub tick_count: u64,
}

impl App {
    pub fn new(event_loop: &EventLoop<UserEvent>, data_dir: PathBuf, smoke_mode: bool) -> Result<Self, String> {
        let db = Db::open(&data_dir.join("profile.db")).map_err(|e| format!("db: {}", e))?;
        let prefs = Prefs::load(&db);
        let server = ChromeServer::start().map_err(|e| format!("server: {}", e))?;
        let vault = Vault::open(&data_dir).ok();
        let engine = Arc::new(crate::filters::load_engine(&db, &data_dir));
        let filter_payload = engine.filter_data_json(&prefs);
        let proxy = event_loop.create_proxy();
        Ok(Self {
            db,
            prefs,
            engine,
            filter_payload,
            vault,
            server,
            windows: HashMap::new(),
            proxy: proxy.clone(),
            data_dir,
            session_stats: Default::default(),
            session_exceptions: Arc::new(Mutex::new(HashSet::new())),
            pending_pw: HashMap::new(),
            pending_perm: HashMap::new(),
            next_req_id: 1,
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
            favicon_seen: HashSet::new(),
            smoke: None,
            start_ms: now_ms(),
            chrome_ready_ms: None,
            quitting: false,
            smoke_mode,
            tick_count: 0,
        })
    }

    // ------------------------------------------------------------------ window
    #[allow(unused_variables)]
    pub fn create_window(&mut self, target: &EventLoopWindowTarget<UserEvent>, tabs: Option<Vec<SessionTab>>) -> Result<WindowId, String> {
        let builder = WindowBuilder::new()
            .with_title("Zephyr")
            .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 820.0))
            .with_min_inner_size(tao::dpi::LogicalSize::new(720.0, 480.0));
        let window = builder.build(target).map_err(|e| format!("window: {:?}", e))?;
        let win_id = window.id();
        let scale = window.scale_factor();

        // GTK container for child webviews (Linux)
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        ))]
        let fixed = {
            use tao::platform::unix::WindowExtUnix;
            #[allow(clippy::undocumented_unsafe_blocks)]
            let fixed = gtk::Fixed::new();
            if let Some(vbox) = window.default_vbox() {
                use gtk::prelude::*;
                vbox.pack_start(&fixed, true, true, 0);
                fixed.show_all();
            }
            fixed
        };

        // Chrome webview (tab strip + toolbar)
        let chrome_url = self.server.url_for("ui/index.html");
        let proxy = self.proxy.clone();
        let win_id_c = win_id;
        let mut cb = WebViewBuilder::new()
            .with_bounds(Rect {
                position: LogicalPosition::new(0.0, 0.0).into(),
                size: LogicalSize::new(1280.0, CHROME_H).into(),
            })
            .with_url(&chrome_url)
            .with_ipc_handler(move |req| {
                let body = req.body().clone();
                let _ = proxy.send_event(UserEvent::Ipc { win: win_id_c, tab: None, raw: body });
            })
            .with_devtools(true);
        let _ = &mut cb; // builder is consumed below
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        ))]
        let chrome = {
            use wry::WebViewBuilderExtUnix;
            cb.build_gtk(&fixed).map_err(|e| format!("chrome webview: {}", e))?
        };
        #[cfg(not(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        )))]
        let chrome = {
            let _ = fixed;
            cb.build_as_child(&window).map_err(|e| format!("chrome webview: {}", e))?
        };

        let mut bwin = BrowserWindow {
            window,
            chrome,
            chrome_h: None,
            tabs: Vec::new(),
            active: 0,
            next_tab_id: 1,
            closed: VecDeque::new(),
            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "openbsd",
                target_os = "netbsd"
            ))]
            gtk_fixed: fixed,
        };
        let _ = scale;

        // Initial tabs
        let mut initial: Vec<SessionTab> = tabs.unwrap_or_else(|| {
            vec![SessionTab {
                url: tabs::NTP_URL.to_string(),
                title: "New Tab".into(),
                pinned: false,
                muted: false,
                active: true,
            }]
        });
        if initial.is_empty() {
            initial.push(SessionTab {
                url: tabs::NTP_URL.to_string(),
                title: "New Tab".into(),
                pinned: false,
                muted: false,
                active: true,
            });
        }
        for st in initial {
            let mut tab = Tab::new(bwin.next_tab_id, &st.url);
            if !st.title.is_empty() {
                tab.title = st.title;
            }
            tab.pinned = st.pinned;
            tab.muted = st.muted;
            if st.active {
                bwin.active = bwin.tabs.len();
            }
            bwin.tabs.push(tab);
            bwin.next_tab_id += 1;
        }
        self.windows.insert(win_id, bwin);
        // Activate initial tab (creates webview)
        let init_idx = self.windows.get(&win_id).map(|w| w.active).unwrap_or(0);
        self.activate_tab(win_id, init_idx, true);
        self.relayout(win_id);
        Ok(win_id)
    }

    /// Build a webview for the given builder — platform-specific child placement.
    #[allow(unused_variables, clippy::too_many_arguments)]
    fn build_webview<'a>(
        &self,
        builder: WebViewBuilder<'a>,
        window: &Window,
        fixed: Option<&gtk::Fixed>,
    ) -> Result<WebView, String> {
        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        ))]
        {
            use wry::WebViewBuilderExtUnix;
            let f = fixed.ok_or("no gtk fixed container")?;
            builder.build_gtk(f).map_err(|e| format!("webview: {}", e))
        }
        #[cfg(not(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "openbsd",
            target_os = "netbsd"
        )))]
        {
            builder.build_as_child(window).map_err(|e| format!("webview: {}", e))
        }
    }

    // ------------------------------------------------------------------ tab webview
    fn content_rect(win: &BrowserWindow) -> Rect {
        let scale = win.window.scale_factor();
        let size = win.window.inner_size().to_logical::<f64>(scale);
        let chrome_h = win.chrome_h.unwrap_or(CHROME_H);
        Rect {
            position: LogicalPosition::new(0.0, chrome_h).into(),
            size: LogicalSize::new(size.width, (size.height - chrome_h).max(40.0)).into(),
        }
    }

    /// (Re)create the child webview for a tab.
    pub fn ensure_tab_webview(&mut self, win_id: WindowId, tab_id: i64) -> Result<(), String> {
        let (url, muted, zoom, find_open, is_internal) = {
            let w = self.windows.get(&win_id).ok_or("no window")?;
            let t = w.tabs.iter().find(|t| t.id == tab_id).ok_or("no tab")?;
            (
                self.effective_url(&t.url),
                t.muted,
                t.zoom,
                t.find_open,
                t.kind == TabKind::Internal,
            )
        };
        let win = self.windows.get(&win_id).ok_or("no window")?;
        let bounds = Self::content_rect(win);
        let scale = win.window.scale_factor();
        let _ = scale;

        // Bundle: internal pages get a lighter bundle (no adblock) but full ipc.
        let bundle = if is_internal {
            String::new()
        } else {
            let perms_json = json!({
                "geolocation": self.prefs.geo_default,
                "notifications": self.prefs.notifications_default,
                "camera": self.prefs.camera_default,
                "autoplay": self.prefs.autoplay_default,
            })
            .to_string();
            let allowlist_json = models::perm_allowlist(&self.db).to_string();
            crate::content_scripts::build(&crate::content_scripts::BundleInput {
                filter_json: &self.filter_payload,
                prefs: &self.prefs,
                perms_json: &perms_json,
                allowlist_json: &allowlist_json,
                tab_id,
                muted,
                zoom,
                find_open,
            })
        };

        let ua = if self.prefs.compat_ua { CHROME_UA } else { ZEPHYR_UA };
        let expect = Arc::new(AtomicBool::new(true));
        let expect_for_tab = expect.clone();
        let engine = self.engine.clone();
        let exceptions = self.session_exceptions.clone();
        let proxy = self.proxy.clone();
        let proxy_t = self.proxy.clone();
        let proxy_n = self.proxy.clone();
        let proxy_p = self.proxy.clone();
        let proxy_d = self.proxy.clone();
        let proxy_dc = self.proxy.clone();
        let prefs_arc = Arc::new(self.prefs.clone());
        let prefs_arc_dl = prefs_arc.clone();
        let downloads = self.active_downloads.clone();
        let downloads_dc = self.active_downloads.clone();
        let db = self.db.clone();
        let db_dc = self.db.clone();
        let data_dir = self.data_dir.clone();
        let smoke_mode = self.smoke_mode;

        let mut builder = WebViewBuilder::new()
            .with_bounds(bounds)
            .with_url(&url)
            .with_user_agent(ua)
            .with_autoplay(self.prefs.autoplay_default == "allow")
            .with_background_throttling(BackgroundThrottlingPolicy::Throttle)
            .with_devtools(true)
            .with_ipc_handler(move |req| {
                let body = req.body().clone();
                let _ = proxy.send_event(UserEvent::Ipc { win: win_id, tab: Some(tab_id), raw: body });
            })
            .with_navigation_handler(move |url| {
                // Allow non-http(s) schemes untouched
                let lower = url.to_lowercase();
                if !(lower.starts_with("http://") || lower.starts_with("https://")) {
                    return true;
                }
                let host = match url_host(&url) {
                    Some(h) => h,
                    None => return true,
                };
                // loopback UI always allowed
                if host == "127.0.0.1" {
                    return true;
                }
                // Rust-initiated navigation (omnibox / back-forward) — bypass ad blocking
                if expect.load(Ordering::SeqCst) {
                    if let Some(BlockClass::Malicious) = engine.host_class(&host) {
                        if prefs_arc.block_malicious {
                            let _ = proxy_n.send_event(UserEvent::IpcBlockedNav {
                                win: win_id,
                                tab: tab_id,
                                url: url.clone(),
                                class: "malicious".into(),
                            });
                            return false;
                        }
                    }
                    return true;
                }
                // Page-initiated navigation: blocklist check (ads / trackers / malicious)
                let origin = url_origin(&url).unwrap_or_default();
                if let Ok(ex) = exceptions.lock() {
                    if ex.contains(&origin) {
                        return true;
                    }
                }
                match engine.host_class(&host) {
                    Some(BlockClass::Malicious) if prefs_arc.block_malicious => {
                        let _ = proxy_n.send_event(UserEvent::IpcBlockedNav {
                            win: win_id,
                            tab: tab_id,
                            url: url.clone(),
                            class: "malicious".into(),
                        });
                        false
                    }
                    Some(BlockClass::Ad) | Some(BlockClass::Tracker) if prefs_arc.adblock_enabled => false,
                    _ => true,
                }
            })
            .with_new_window_req_handler(move |url| {
                // popups become new tabs
                let _ = proxy_t.send_event(UserEvent::Ipc {
                    win: win_id,
                    tab: Some(tab_id),
                    raw: json!({"ns":"content","cmd":"newtab","data":{"url":url}}).to_string(),
                });
                false
            })
            .with_document_title_changed_handler(move |title| {
                let _ = proxy_p.send_event(UserEvent::Ipc {
                    win: win_id,
                    tab: Some(tab_id),
                    raw: json!({"ns":"content","cmd":"title","data":{"title":title}}).to_string(),
                });
            })
            .with_on_page_load_handler(move |ev, url| {
                let cmd = match ev {
                    PageLoadEvent::Started => "load-started",
                    PageLoadEvent::Finished => "load-finished",
                };
                let _ = proxy_d.send_event(UserEvent::Ipc {
                    win: win_id,
                    tab: Some(tab_id),
                    raw: json!({"ns":"content","cmd":cmd,"data":{"url":url}}).to_string(),
                });
            })
            .with_download_started_handler(move |url, path: &mut std::path::PathBuf| {
                // Decide the destination now.
                let dir = download_dir(&prefs_arc_dl, &data_dir);
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("download");
                let target = crate::util::unique_path(&dir, name);
                // record in db
                let id = models::download_add(&db, &url, &target.to_string_lossy(), "");
                if let Ok(mut m) = downloads.lock() {
                    m.insert(url.clone(), (id, target.clone()));
                }
                *path = target;
                true
            })
            .with_download_completed_handler(move |url, path, ok| {
                let (id, _) = {
                    let mut m = match downloads_dc.lock() {
                        Ok(m) => m,
                        Err(_) => return,
                    };
                    m.remove(&url).unwrap_or((-1, PathBuf::new()))
                };
                if id >= 0 {
                    let size = path.as_ref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len()).unwrap_or(0);
                    models::download_update(&db_dc, id, size as i64, if ok { "done" } else { "failed" });
                }
                let _ = proxy_dc.send_event(UserEvent::Ipc {
                    win: win_id,
                    tab: None,
                    raw: json!({"ns":"chrome","cmd":"download-done","data":{"url":url,"ok":ok,"id":id}}).to_string(),
                });
                let _ = smoke_mode;
            });
        if !bundle.is_empty() {
            builder = builder.with_initialization_script(&bundle);
        }
        let win = self.windows.get(&win_id).ok_or("no window")?;
        let webview = {
            #[cfg(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "openbsd",
                target_os = "netbsd"
            ))]
            {
                use wry::WebViewBuilderExtUnix;
                builder.build_gtk(&win.gtk_fixed).map_err(|e| format!("webview: {}", e))?
            }
            #[cfg(not(any(
                target_os = "linux",
                target_os = "dragonfly",
                target_os = "freebsd",
                target_os = "openbsd",
                target_os = "netbsd"
            )))]
            {
                builder.build_as_child(&win.window).map_err(|e| format!("webview: {}", e))?
            }
        };
        let win = self.windows.get_mut(&win_id).ok_or("no window")?;
        if let Some(t) = win.tabs.iter_mut().find(|t| t.id == tab_id) {
            t.webview = Some(webview);
            t.suspended = false;
            t.expecting = Some(expect_for_tab);
        }
        Ok(())
    }

    pub fn effective_url(&self, url: &str) -> String {
        if let Some(resolved) = resolve_internal(url, &self.server.base()) {
            return resolved;
        }
        url.to_string()
    }

    /// Canonicalize loopback UI URLs back to zephyr:// form.
    pub fn canonical_url(&self, url: &str) -> String {
        let base = self.server.base();
        if let Some(rest) = url.strip_prefix(&base) {
            // rest looks like "/pages/settings.html?x=1" or "/ntp/index.html"
            let (path, query) = match rest.find('?') {
                Some(i) => (&rest[..i], &rest[i..]),
                None => (rest, ""),
            };
            let canon = match path {
                "/ntp/index.html" => Some("zephyr://newtab"),
                "/pages/bookmarks.html" => Some("zephyr://bookmarks"),
                "/pages/history.html" => Some("zephyr://history"),
                "/pages/downloads.html" => Some("zephyr://downloads"),
                "/pages/settings.html" => Some("zephyr://settings"),
                "/pages/privacy.html" => Some("zephyr://privacy"),
                "/pages/blocked.html" => Some("zephyr://blocked"),
                "/pages/error.html" => Some("zephyr://error"),
                "/pages/source.html" => Some("zephyr://source"),
                "/fixtures/adtest.html" => Some("zephyr://fixture/adtest"),
                "/fixtures/lorem.html" => Some("zephyr://fixture/lorem"),
                _ => None,
            };
            if let Some(c) = canon {
                return format!("{}{}", c, query);
            }
        }
        url.to_string()
    }

    // ------------------------------------------------------------------ tab ops
    pub fn activate_tab(&mut self, win_id: WindowId, idx: usize, notify: bool) {
        let mut to_focus: Option<i64> = None;
        if let Some(w) = self.windows.get_mut(&win_id) {
            if idx >= w.tabs.len() {
                return;
            }
            // hide previous webview
            let prev = w.active;
            if prev != idx {
                if let Some(t) = w.tabs.get_mut(prev) {
                    if let Some(wv) = &t.webview {
                        let _ = wv.set_visible(false);
                    }
                }
            }
            w.active = idx;
            if let Some(t) = w.tabs.get_mut(idx) {
                t.last_active = now_ms();
                if t.webview.is_none() {
                    // recreate (was suspended or lazy)
                    let id = t.id;
                    drop(t);
                    if let Err(e) = self.ensure_tab_webview(win_id, id) {
                        crate::zerror!("app", "webview recreate: {}", e);
                    }
                }
            }
        }
        if let Some(w) = self.windows.get(&win_id) {
            // position + show active webview
            let rect = Self::content_rect(w);
            if let Some(t) = w.tabs.get(idx) {
                if let Some(wv) = &t.webview {
                    let _ = wv.set_bounds(rect);
                    let _ = wv.set_visible(true);
                    let _ = wv.focus();
                    to_focus = Some(t.id);
                }
            }
            let title = w.tabs.get(idx).map(|t| t.title.clone()).unwrap_or_default();
            let full = if title.is_empty() { "Zephyr".to_string() } else { format!("{} — Zephyr", title) };
            w.window.set_title(&full);
        }
        let _ = to_focus;
        if notify {
            self.push_state(win_id);
        }
    }

    pub fn new_tab(&mut self, win_id: WindowId, url: &str, background: bool, activate: bool) -> i64 {
        let tab_id = {
            let w = self.windows.get_mut(&win_id).expect("window");
            let id = w.next_tab_id;
            w.next_tab_id += 1;
            let tab = Tab::new(id, url);
            w.tabs.push(tab);
            id
        };
        if !background && activate {
            let idx = self.windows.get(&win_id).map(|w| w.tabs.len() - 1).unwrap_or(0);
            self.activate_tab(win_id, idx, true);
        } else {
            self.push_state(win_id);
        }
        tab_id
    }

    pub fn close_tab(&mut self, win_id: WindowId, tab_id: i64) {
        let (idx, is_last, closed_info) = {
            let w = match self.windows.get_mut(&win_id) {
                Some(w) => w,
                None => return,
            };
            let idx = match w.tab_idx(tab_id) {
                Some(i) => i,
                None => return,
            };
            let t = &mut w.tabs[idx];
            let info = (t.url.clone(), t.title.clone());
            if !t.url.starts_with("zephyr://") {
                w.closed.push_front(info.clone());
                w.closed.truncate(25);
            }
            w.tabs.remove(idx);
            (idx, w.tabs.is_empty(), Some(info))
        };
        let _ = closed_info;
        if is_last {
            // last tab in window: close window (or whole app if last window)
            self.close_window(win_id);
            return;
        }
        let w = self.windows.get(&win_id).unwrap();
        let new_idx = if idx == 0 { 0 } else { idx.min(w.tabs.len() - 1) };
        self.activate_tab(win_id, new_idx, true);
    }

    pub fn close_window(&mut self, win_id: WindowId) {
        if self.windows.len() > 1 {
            if let Some(mut w) = self.windows.remove(&win_id) {
                for t in w.tabs.iter_mut() {
                    t.webview = None;
                }
                w.tabs.clear();
                // dropping chrome webview + window
                drop(w);
            }
            self.save_session();
        } else {
            self.quitting = true;
            self.save_session();
            models::stats_add_day(&self.db, &crate::util::today_key(), self.session_stats);
            // exit
            std::process::exit(0);
        }
    }

    // ------------------------------------------------------------------ navigate
    pub fn navigate_tab(&mut self, win_id: WindowId, tab_id: i64, url: &str) {
        let url = if url.is_empty() { tabs::NTP_URL } else { url };
        let eff = self.effective_url(url);
        {
            let w = match self.windows.get_mut(&win_id) {
                Some(w) => w,
                None => return,
            };
            let t = match w.tabs.iter_mut().find(|t| t.id == tab_id) {
                Some(t) => t,
                None => return,
            };
            t.url = url.to_string();
            t.loading = true;
            t.title = if t.kind == TabKind::Internal { tabs::internal_title(url) } else { t.title.clone() };
            if let Some(exp) = &t.expecting {
                exp.store(true, Ordering::SeqCst);
            }
            if t.webview.is_none() {
                let _ = t.kind.clone();
            }
        }
        // ensure webview exists
        if self.with_tab_webview(win_id, tab_id, |_| ()).is_none() {
            let _ = self.ensure_tab_webview(win_id, tab_id);
        }
        let eff = if eff.is_empty() { self.effective_url(url) } else { eff };
        self.with_tab_webview(win_id, tab_id, |wv| {
            let _ = wv.load_url(&eff);
        });
        // position it if just created
        if let Some(w) = self.windows.get(&win_id) {
            if let Some(t) = w.active_tab() {
                if t.id == tab_id {
                    let rect = Self::content_rect(w);
                    if let Some(wv) = &t.webview {
                        let _ = wv.set_bounds(rect);
                        let _ = wv.set_visible(true);
                    }
                }
            }
        }
        self.push_state(win_id);
    }

    pub fn with_tab_webview<R>(&mut self, win_id: WindowId, tab_id: i64, f: impl FnOnce(&WebView) -> R) -> Option<R> {
        let w = self.windows.get(&win_id)?;
        let t = w.tabs.iter().find(|t| t.id == tab_id)?;
        t.webview.as_ref().map(f)
    }

    pub fn with_active_webview<R>(&mut self, win_id: WindowId, f: impl FnOnce(&WebView) -> R) -> Option<R> {
        let id = self.windows.get(&win_id)?.active_tab().map(|t| t.id)?;
        self.with_tab_webview(win_id, id, f)
    }

    // ------------------------------------------------------------------ layout
    pub fn relayout(&mut self, win_id: WindowId) {
        let Some(w) = self.windows.get(&win_id) else { return };
        let scale = w.window.scale_factor();
        let logical = w.window.inner_size().to_logical::<f64>(scale);
        let chrome_h = w.chrome_h.unwrap_or(CHROME_H);
        let chrome_rect = Rect {
            position: LogicalPosition::new(0.0, 0.0).into(),
            size: LogicalSize::new(logical.width, chrome_h).into(),
        };
        let content = Self::content_rect(w);
        let _ = w.chrome.set_bounds(chrome_rect);
        if let Some(t) = w.tabs.get(w.active) {
            if let Some(wv) = &t.webview {
                let _ = wv.set_bounds(content);
            }
        }
    }

    pub fn set_chrome_height(&mut self, win_id: WindowId, h: Option<f64>) {
        let changed = {
            let Some(w) = self.windows.get_mut(&win_id) else { return };
            let newh = h.map(|x| x.clamp(CHROME_H, 600.0));
            let ch = w.chrome_h != newh;
            w.chrome_h = newh;
            ch
        };
        if changed {
            self.relayout(win_id);
        }
    }

    // ------------------------------------------------------------------ chrome push
    pub fn chrome_eval(&self, win_id: WindowId, js: &str) {
        if let Some(w) = self.windows.get(&win_id) {
            let _ = w.chrome.evaluate_script(js);
        }
    }

    pub fn chrome_push(&self, win_id: WindowId, event: &str, payload: &serde_json::Value) {
        self.chrome_eval(win_id, &push_js(event, payload));
    }

    /// Push full UI state to the chrome webview.
    pub fn push_state(&mut self, win_id: WindowId) {
        let Some(w) = self.windows.get(&win_id) else { return };
        let tabs: Vec<serde_json::Value> = w
            .tabs
            .iter()
            .enumerate()
            .map(|(i, t)| {
                json!({
                    "id": t.id, "title": if t.title.is_empty() { "…" } else { &t.title },
                    "url": t.url, "favicon": t.favicon, "pinned": t.pinned, "muted": t.muted,
                    "loading": t.loading, "suspended": t.suspended, "zoom": t.zoom,
                    "canBack": t.can_back(), "canFwd": t.can_fwd(), "active": i == w.active,
                    "blocked": t.total_blocked(), "internal": t.kind == TabKind::Internal,
                    "kind": t.kind.key(),
                })
            })
            .collect();
        let active_url = w.active_tab().map(|t| t.url.clone()).unwrap_or_default();
        let active_title = w.active_tab().map(|t| t.title.clone()).unwrap_or_default();
        let active_blocked = w.active_tab().map(|t| t.total_blocked()).unwrap_or(0);
        let has_dl_active = {
            self.active_downloads.lock().map(|m| !m.is_empty()).unwrap_or(false)
        };
        let payload = json!({
            "tabs": tabs,
            "active": w.active,
            "activeUrl": active_url,
            "activeTitle": active_title,
            "activeBlocked": active_blocked,
            "downloadsActive": has_dl_active,
            "sessionStats": {
                "ads": self.session_stats.ads, "trackers": self.session_stats.trackers,
                "cosmetic": self.session_stats.cosmetic, "params": self.session_stats.params,
                "malicious": self.session_stats.malicious,
            },
            "prefs": self.prefs.to_json(),
            "serverBase": self.server.base(),
            "ntpUrl": tabs::NTP_URL,
            "chromeReady": self.chrome_ready_ms.is_some(),
        });
        self.chrome_push(win_id, "state", &payload);
    }

    // ------------------------------------------------------------------ session
    pub fn save_session(&mut self) {
        let mut s = Session { windows: vec![], saved_at: now_ms() };
        for w in self.windows.values() {
            s.windows.push(SessionWindow {
                tabs: w
                    .tabs
                    .iter()
                    .map(|t| SessionTab {
                        url: t.url.clone(),
                        title: t.title.clone(),
                        pinned: t.pinned,
                        muted: t.muted,
                        active: false,
                    })
                    .collect(),
            });
            if let Some(last) = s.windows.last_mut() {
                if let Some(t) = w.tabs.get(w.active) {
                    if let Some(st) = last.tabs.iter_mut().find(|st| st.url == t.url) {
                        st.active = true;
                    }
                }
            }
        }
        tabs::save_session(&self.data_dir, &s);
    }

    // ------------------------------------------------------------------ events
    pub fn handle_event(&mut self, event: Event<UserEvent>, target: &EventLoopWindowTarget<UserEvent>, control_flow: &mut ControlFlow) {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(ue) => self.handle_user_event(ue, target, control_flow),
            Event::WindowEvent { window_id, event: we, .. } => match we {
                WindowEvent::CloseRequested => {
                    self.close_window(window_id);
                }
                WindowEvent::Resized(_) => {
                    self.relayout(window_id);
                }
                WindowEvent::Focused(true) => {
                    // re-focus active tab webview so keyboard works
                    if let Some(w) = self.windows.get(&window_id) {
                        if let Some(t) = w.tabs.get(w.active) {
                            if let Some(wv) = &t.webview {
                                let _ = wv.focus();
                            }
                        }
                    }
                }
                WindowEvent::Destroyed => {
                    self.windows.remove(&window_id);
                }
                _ => {}
            },
            Event::Resumed => {
                if self.windows.is_empty() {
                    let _ = self.create_window(target, None);
                }
            }
            _ => {}
        }
    }

    fn handle_user_event(&mut self, ue: UserEvent, target: &EventLoopWindowTarget<UserEvent>, control_flow: &mut ControlFlow) {
        match ue {
            UserEvent::Ipc { win, tab, raw } => {
                if let Some(msg) = IpcMsg::parse(&raw) {
                    crate::commands::dispatch(self, target, win, tab, msg);
                }
            }
            UserEvent::IpcBlockedNav { win, tab, url, class } => {
                // Show the blocked page on this tab
                let enc = crate::commands::urlencode(&url);
                let blocked = format!("zephyr://blocked?u={}&c={}", enc, class);
                self.navigate_tab(win, tab, &blocked);
            }
            UserEvent::Tick => self.on_tick(),
            UserEvent::Favicon { tab, dataurl } => {
                for w in self.windows.values_mut() {
                    for t in w.tabs.iter_mut() {
                        if t.id == tab {
                            t.favicon = Some(dataurl.clone());
                        }
                    }
                }
                for id in self.windows.keys().copied().collect::<Vec<_>>() {
                    self.push_state(id);
                }
            }
            UserEvent::ListUpdateDone(res) => {
                let (ok, detail) = match res {
                    Ok(d) => (true, d),
                    Err(e) => (false, e),
                };
                self.rebuild_engine();
                for id in self.windows.keys().copied().collect::<Vec<_>>() {
                    self.chrome_push(id, "lists-updated", &json!({"ok": ok, "detail": detail}));
                    self.push_state(id);
                }
            }
            UserEvent::SourceReady { win, tab, url, body } => {
                let payload = json!({"url": url, "body": body});
                let js = crate::messages::push_js("source-data", &payload);
                let _ = self.with_tab_webview(win, tab, |wv| {
                    let _ = wv.evaluate_script(&js);
                });
            }
            UserEvent::Smoke(step) => {
                crate::smoke::on_step(self, step);
            }
            UserEvent::Exit(code) => {
                self.save_session();
                models::stats_add_day(&self.db, &crate::util::today_key(), self.session_stats);
                if let Some(sm) = self.smoke.take() {
                    crate::smoke::write_report(self, sm);
                }
                std::process::exit(code);
            }
        }
        let _ = control_flow;
    }

    fn on_tick(&mut self) {
        self.tick_count += 1;
        // autosave every 15s
        if self.tick_count % 3 == 0 {
            self.save_session();
        }
        // stats persist + suspension pass every 60s
        if self.tick_count % 12 == 0 {
            models::stats_add_day(&self.db, &crate::util::today_key(), self.session_stats);
            self.suspend_pass();
        }
        // download progress via file size polling
        self.poll_downloads();
    }

    fn poll_downloads(&mut self) {
        let entries: Vec<(String, i64, PathBuf)> = {
            match self.active_downloads.lock() {
                Ok(m) => m.iter().map(|(u, (id, p))| (u.clone(), *id, p.clone())).collect(),
                Err(_) => vec![],
            }
        };
        if entries.is_empty() {
            return;
        }
        let mut updates = Vec::new();
        for (url, id, path) in entries {
            if let Ok(md) = std::fs::metadata(&path) {
                updates.push((url, id, md.len()));
            }
        }
        if !updates.is_empty() {
            for id in self.windows.keys().copied().collect::<Vec<_>>() {
                self.chrome_push(id, "dl-progress", &json!({"items": updates.iter().map(|(u, i, s)| json!({"url": u, "id": i, "size": s})).collect::<Vec<_>>()}));
            }
        }
    }

    pub fn suspend_pass(&mut self) {
        if !self.prefs.suspend_background_tabs {
            return;
        }
        let threshold_ms = (self.prefs.suspend_after_minutes as u64) * 60 * 1000;
        let now = now_ms();
        let mut to_suspend: Vec<(WindowId, i64)> = Vec::new();
        for (wid, w) in self.windows.iter() {
            // enforce live cap
            let live = w.live_webviews();
            let over = live as i64 - self.prefs.max_live_webviews as i64;
            // LRU candidates: inactive, unpinned, non-internal, live
            let mut candidates: Vec<(u64, i64)> = w
                .tabs
                .iter()
                .filter(|t| t.webview.is_some() && !t.pinned && t.kind == TabKind::Content && t.id != w.active_tab().map(|t| t.id).unwrap_or(-1))
                .map(|t| (t.last_active, t.id))
                .collect();
            candidates.sort();
            let mut count = over.max(0) as usize;
            for (last, id) in candidates {
                if now.saturating_sub(last) >= threshold_ms && count == 0 {
                    to_suspend.push((*wid, id));
                } else if count > 0 {
                    to_suspend.push((*wid, id));
                    count -= 1;
                }
            }
        }
        for (wid, id) in to_suspend {
            self.suspend_tab(wid, id);
        }
    }

    pub fn suspend_tab(&mut self, win_id: WindowId, tab_id: i64) {
        if let Some(w) = self.windows.get_mut(&win_id) {
            if let Some(t) = w.tabs.iter_mut().find(|t| t.id == tab_id) {
                if t.webview.take().is_some() {
                    t.suspended = true;
                }
            }
        }
        self.push_state(win_id);
    }

    pub fn rebuild_engine(&mut self) {
        let engine = crate::filters::load_engine(&self.db, &self.data_dir);
        self.filter_payload = engine.filter_data_json(&self.prefs);
        self.engine = Arc::new(engine);
    }

    // ------------------------------------------------------------------ favicon
    pub fn queue_favicon(&mut self, tab_id: i64, url: &str) {
        let Some(host) = url_host(url) else { return };
        let Some(origin) = url_origin(url) else { return };
        if host == "127.0.0.1" || self.favicon_seen.contains(&origin) {
            return;
        }
        self.favicon_seen.insert(origin.clone());
        let proxy = self.proxy.clone();
        let db = self.db.clone();
        let origin_c = origin.clone();
        let host_c = host;
        std::thread::spawn(move || {
            let url = format!("{}/favicon.ico", origin_c);
            let agent = ureq::AgentBuilder::new()
                .timeout(std::time::Duration::from_secs(8))
                .redirects(3)
                .build();
            if let Ok(resp) = agent.get(&url).set("User-Agent", ZEPHYR_UA).call() {
                let mut buf: Vec<u8> = Vec::new();
                if std::io::Read::read_to_end(&mut resp.into_reader(), &mut buf).is_ok() {
                    if !buf.is_empty() && buf.len() < 200_000 {
                        use base64::Engine;
                        let dataurl = format!(
                            "data:{};base64,{}",
                            if buf.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/x-icon" },
                            base64::engine::general_purpose::STANDARD.encode(&buf)
                        );
                        models::favicon_set(&db, &url, &host_c, &buf);
                        let _ = proxy.send_event(UserEvent::Favicon { tab: tab_id, dataurl });
                    }
                }
            }
        });
    }
}

pub fn download_dir(prefs: &Prefs, data_dir: &std::path::Path) -> PathBuf {
    if !prefs.download_dir.is_empty() {
        let p = PathBuf::from(&prefs.download_dir);
        let _ = std::fs::create_dir_all(&p);
        p
    } else if let Some(d) = dirs::download_dir() {
        d
    } else {
        data_dir.join("downloads")
    }
}
