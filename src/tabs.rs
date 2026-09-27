// Zephyr Browser — tab model + session serialization
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub const NTP_URL: &str = "zephyr://newtab";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TabKind {
    Content,
    Internal, // served by our loopback server (NTP, settings, blocked, ...)
}

impl TabKind {
    pub fn key(&self) -> &'static str {
        match self {
            TabKind::Content => "content",
            TabKind::Internal => "internal",
        }
    }
}

pub struct Tab {
    pub id: i64,
    pub kind: TabKind,
    pub url: String,
    pub title: String,
    pub favicon: Option<String>,
    pub pinned: bool,
    pub muted: bool,
    pub loading: bool,
    pub suspended: bool,
    pub zoom: f64,
    pub back_stack: Vec<String>,
    pub fwd_stack: Vec<String>,
    pub last_active: u64,
    /// (host, class) most recent blocked items — for the privacy dashboard
    pub blocked_recent: VecDeque<(String, String)>,
    pub ads: u64,
    pub trackers: u64,
    pub cosmetic: u64,
    pub params: u64,
    pub malicious: u64,
    pub find_open: bool,
    /// shared with the webview's navigation handler: true while a
    /// Rust-initiated (omnibox / back / link) load is in flight
    pub expecting: Option<Arc<AtomicBool>>,
    /// live webview for this tab (None when suspended / lazy).
    /// NOTE: deliberately excluded from Clone — a cloned Tab is a data
    /// snapshot only; the webview never duplicates.
    #[cfg(feature = "gui")]
    pub webview: Option<wry::WebView>,
}

impl Clone for Tab {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            kind: self.kind.clone(),
            url: self.url.clone(),
            title: self.title.clone(),
            favicon: self.favicon.clone(),
            pinned: self.pinned,
            muted: self.muted,
            loading: self.loading,
            suspended: self.suspended,
            zoom: self.zoom,
            back_stack: self.back_stack.clone(),
            fwd_stack: self.fwd_stack.clone(),
            last_active: self.last_active,
            blocked_recent: self.blocked_recent.clone(),
            ads: self.ads,
            trackers: self.trackers,
            cosmetic: self.cosmetic,
            params: self.params,
            malicious: self.malicious,
            find_open: self.find_open,
            expecting: self.expecting.clone(),
            #[cfg(feature = "gui")]
            webview: None,
        }
    }
}

impl Tab {
    pub fn new(id: i64, url: &str) -> Self {
        let kind = if url.starts_with("zephyr://") { TabKind::Internal } else { TabKind::Content };
        let title = if kind == TabKind::Internal { internal_title(url) } else { String::new() };
        Self {
            id,
            kind,
            url: url.to_string(),
            title,
            favicon: None,
            pinned: false,
            muted: false,
            loading: false,
            suspended: false,
            zoom: 1.0,
            back_stack: Vec::new(),
            fwd_stack: Vec::new(),
            last_active: crate::util::now_ms(),
            blocked_recent: VecDeque::new(),
            ads: 0,
            trackers: 0,
            cosmetic: 0,
            params: 0,
            malicious: 0,
            find_open: false,
            expecting: None,
            #[cfg(feature = "gui")]
            webview: None,
        }
    }

    pub fn can_back(&self) -> bool {
        !self.back_stack.is_empty()
    }

    pub fn can_fwd(&self) -> bool {
        !self.fwd_stack.is_empty()
    }

    /// Record a completed navigation (from navigation handler / load events).
    pub fn push_history(&mut self, url: &str) {
        if url == self.url {
            return;
        }
        // SPA / same-URL navs collapse
        if self.back_stack.last().map(|s| s.as_str()) != Some(self.url.as_str()) {
            self.back_stack.push(self.url.clone());
            if self.back_stack.len() > 64 {
                self.back_stack.remove(0);
            }
        }
        self.url = url.to_string();
        self.fwd_stack.clear();
    }

    pub fn go_back(&mut self) -> Option<String> {
        let url = self.back_stack.pop()?;
        // current url goes to fwd stack (dedup)
        if self.fwd_stack.last().map(|s| s.as_str()) != Some(self.url.as_str()) {
            self.fwd_stack.push(self.url.clone());
        }
        self.url = url.clone();
        Some(url)
    }

    pub fn go_forward(&mut self) -> Option<String> {
        let url = self.fwd_stack.pop()?;
        if self.back_stack.last().map(|s| s.as_str()) != Some(self.url.as_str()) {
            self.back_stack.push(self.url.clone());
        }
        self.url = url.clone();
        Some(url)
    }

    pub fn total_blocked(&self) -> u64 {
        self.ads + self.trackers + self.cosmetic + self.params + self.malicious
    }
}

pub fn internal_title(url: &str) -> String {
    let base = url.split('?').next().unwrap_or(url);
    match base {
        "zephyr://newtab" => "New Tab".into(),
        "zephyr://bookmarks" => "Bookmarks".into(),
        "zephyr://history" => "History".into(),
        "zephyr://downloads" => "Downloads".into(),
        "zephyr://settings" => "Settings".into(),
        "zephyr://privacy" => "Privacy Dashboard".into(),
        "zephyr://source" => "Source".into(),
        "zephyr://blocked" => "Blocked".into(),
        "zephyr://error" => "Error".into(),
        _ => "Zephyr".into(),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SessionTab {
    pub url: String,
    pub title: String,
    pub pinned: bool,
    pub muted: bool,
    pub active: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SessionWindow {
    pub tabs: Vec<SessionTab>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Session {
    pub windows: Vec<SessionWindow>,
    pub saved_at: u64,
}

pub fn session_path(data_dir: &std::path::Path) -> std::path::PathBuf {
    data_dir.join("session.json")
}

pub fn save_session(data_dir: &std::path::Path, s: &Session) {
    if let Ok(json) = serde_json::to_string_pretty(s) {
        let p = session_path(data_dir);
        let tmp = p.with_extension("tmp");
        if std::fs::write(&tmp, json).is_ok() {
            let _ = std::fs::rename(&tmp, &p);
        }
    }
}

pub fn load_session(data_dir: &std::path::Path) -> Option<Session> {
    let txt = std::fs::read_to_string(session_path(data_dir)).ok()?;
    serde_json::from_str(&txt).ok()
}

/// Map a zephyr:// internal URL to its loopback server URL.
pub fn resolve_internal(url: &str, server_base: &str) -> Option<String> {
    let (path, query) = match url.find('?') {
        Some(i) => (&url[..i], &url[i..]),
        None => (url, ""),
    };
    let page = match path {
        "zephyr://newtab" => "ntp/index.html",
        "zephyr://bookmarks" => "pages/bookmarks.html",
        "zephyr://history" => "pages/history.html",
        "zephyr://downloads" => "pages/downloads.html",
        "zephyr://settings" => "pages/settings.html",
        "zephyr://privacy" => "pages/privacy.html",
        "zephyr://blocked" => "pages/blocked.html",
        "zephyr://error" => "pages/error.html",
        "zephyr://source" => "pages/source.html",
        _ => return None,
    };
    if query.is_empty() {
        Some(format!("{}/{}", server_base, page))
    } else {
        Some(format!("{}/{}{}", server_base, page, query))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_stacks() {
        let mut t = Tab::new(1, "https://a.com");
        t.push_history("https://b.com");
        t.push_history("https://c.com");
        assert!(t.can_back() && t.can_fwd() == false);
        let back = t.go_back().unwrap();
        assert_eq!(back, "https://b.com");
        assert!(t.can_fwd());
        let fwd = t.go_forward().unwrap();
        assert_eq!(fwd, "https://c.com");
    }

    #[test]
    fn internal_detection() {
        let t = Tab::new(2, NTP_URL);
        assert_eq!(t.kind, TabKind::Internal);
        assert_eq!(t.title, "New Tab");
        let r = resolve_internal("zephyr://settings?section=privacy", "http://127.0.0.1:1/tok");
        assert_eq!(r.unwrap(), "http://127.0.0.1:1/tok/pages/settings.html?section=privacy");
    }

    #[test]
    fn session_roundtrip() {
        let dir = std::env::temp_dir().join(format!("zephyr-sess-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let s = Session {
            windows: vec![SessionWindow {
                tabs: vec![SessionTab {
                    url: "https://a.com".into(),
                    title: "A".into(),
                    pinned: false,
                    muted: false,
                    active: true,
                }],
            }],
            saved_at: 1,
        };
        save_session(&dir, &s);
        let loaded = load_session(&dir).unwrap();
        assert_eq!(loaded.windows[0].tabs[0].url, "https://a.com");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
