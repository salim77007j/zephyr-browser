// Zephyr Browser — user preferences (typed, persisted in the prefs table)
use crate::db::Db;
use serde_json::json;

#[derive(Clone, Debug)]
pub struct Prefs {
    // appearance
    pub theme: String,            // system | dark | light
    pub accent: String,           // hex color
    pub density: String,          // normal | compact
    pub show_home_button: bool,
    pub show_bookmarks_bar: bool,
    // general
    pub startup_mode: String,     // session | ntp
    pub homepage: String,         // internal NTP url marker: "zephyr://newtab"
    pub search_engine: String,    // duckduckgo | google | bing | brave | startpage | ecosia | none
    pub download_dir: String,     // empty => OS default Downloads
    pub ask_download_path: bool,
    // privacy
    pub adblock_enabled: bool,        // master switch for host/network filtering
    pub netfilter_enabled: bool,      // script-level request interception
    pub cosmetic_enabled: bool,       // element hiding
    pub heuristic_cosmetic: bool,     // hide obviously-ad-shaped elements
    pub strip_tracking_params: bool,  // utm_*, fbclid, ...
    pub fp_canvas: bool,
    pub fp_audio: bool,
    pub fp_webgl: bool,
    pub fp_navigator: bool,
    pub block_malicious: bool,
    pub do_not_track: bool,           // navigator.doNotTrack shim
    pub block_thirdparty_js_cookies: bool, // document.cookie shim for 3rd-party frames
    pub geo_default: String,          // ask | block | allow (per-site exceptions in permissions)
    pub notifications_default: String,
    pub autoplay_default: String,     // block | allow
    pub camera_default: String,       // ask | block
    // passwords
    pub password_autofill: bool,
    // ntp
    pub weather_enabled: bool,
    // performance
    pub suspend_background_tabs: bool,
    pub suspend_after_minutes: u32,
    pub max_live_webviews: u32,
    // advanced
    pub devtools_enabled: bool,
    pub gestures_enabled: bool,
    pub compat_ua: bool, // spoof modern Chrome UA for site compatibility (new tabs)
}

impl Default for Prefs {
    fn default() -> Self {
        Self {
            theme: "light".into(),
            accent: "#4b7bec".into(),
            density: "normal".into(),
            show_home_button: false,
            show_bookmarks_bar: true,
            startup_mode: "session".into(),
            homepage: "zephyr://newtab".into(),
            search_engine: "duckduckgo".into(),
            download_dir: String::new(),
            ask_download_path: false,
            adblock_enabled: true,
            netfilter_enabled: true,
            cosmetic_enabled: true,
            heuristic_cosmetic: true,
            strip_tracking_params: true,
            fp_canvas: true,
            fp_audio: true,
            fp_webgl: true,
            fp_navigator: true,
            block_malicious: true,
            do_not_track: true,
            block_thirdparty_js_cookies: true,
            geo_default: "ask".into(),
            notifications_default: "ask".into(),
            autoplay_default: "block".into(),
            camera_default: "ask".into(),
            password_autofill: true,
            weather_enabled: true,
            suspend_background_tabs: true,
            suspend_after_minutes: 15,
            max_live_webviews: 12,
            devtools_enabled: true,
            gestures_enabled: true,
            compat_ua: false,
        }
    }
}

const BOOL_KEYS: &[&str] = &[
    "show_home_button", "show_bookmarks_bar", "ask_download_path", "adblock_enabled",
    "netfilter_enabled", "cosmetic_enabled", "heuristic_cosmetic", "strip_tracking_params",
    "fp_canvas", "fp_audio", "fp_webgl", "fp_navigator", "block_malicious", "do_not_track",
    "block_thirdparty_js_cookies", "password_autofill", "suspend_background_tabs",
    "devtools_enabled", "gestures_enabled", "compat_ua", "weather_enabled",
];
const STRING_KEYS: &[&str] = &[
    "theme", "accent", "density", "startup_mode", "homepage", "search_engine", "download_dir",
    "geo_default", "notifications_default", "autoplay_default", "camera_default",
];
const U32_KEYS: &[&str] = &["suspend_after_minutes", "max_live_webviews"];

const VALID: &[(&str, &[&str])] = &[
    ("theme", &["system", "dark", "light"]),
    ("density", &["normal", "compact"]),
    ("startup_mode", &["session", "ntp"]),
    ("search_engine", &["duckduckgo", "google", "bing", "brave", "startpage", "ecosia", "none"]),
    ("geo_default", &["ask", "block", "allow"]),
    ("notifications_default", &["ask", "block"]),
    ("autoplay_default", &["block", "allow"]),
    ("camera_default", &["ask", "block"]),
];

impl Prefs {
    pub fn load(db: &Db) -> Self {
        let mut p = Self::default();
        let rows: Vec<(String, String)> = db.exec(|c| {
            let mut stmt = match c.prepare("SELECT key, value FROM prefs") {
                Ok(s) => s,
                Err(_) => return vec![],
            };
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map(|it| it.flatten().collect())
                .unwrap_or_default();
            rows
        });
        for (k, v) in rows {
            p.apply(&k, &v);
        }
        p
    }

    fn apply(&mut self, k: &str, v: &str) {
        match k {
            "theme" => self.theme = v.into(),
            "accent" => self.accent = v.into(),
            "density" => self.density = v.into(),
            "startup_mode" => self.startup_mode = v.into(),
            "homepage" => self.homepage = v.into(),
            "search_engine" => self.search_engine = v.into(),
            "download_dir" => self.download_dir = v.into(),
            "geo_default" => self.geo_default = v.into(),
            "notifications_default" => self.notifications_default = v.into(),
            "autoplay_default" => self.autoplay_default = v.into(),
            "camera_default" => self.camera_default = v.into(),
            "show_home_button" => self.show_home_button = v == "1",
            "show_bookmarks_bar" => self.show_bookmarks_bar = v == "1",
            "ask_download_path" => self.ask_download_path = v == "1",
            "adblock_enabled" => self.adblock_enabled = v == "1",
            "netfilter_enabled" => self.netfilter_enabled = v == "1",
            "cosmetic_enabled" => self.cosmetic_enabled = v == "1",
            "heuristic_cosmetic" => self.heuristic_cosmetic = v == "1",
            "strip_tracking_params" => self.strip_tracking_params = v == "1",
            "fp_canvas" => self.fp_canvas = v == "1",
            "fp_audio" => self.fp_audio = v == "1",
            "fp_webgl" => self.fp_webgl = v == "1",
            "fp_navigator" => self.fp_navigator = v == "1",
            "block_malicious" => self.block_malicious = v == "1",
            "do_not_track" => self.do_not_track = v == "1",
            "block_thirdparty_js_cookies" => self.block_thirdparty_js_cookies = v == "1",
            "password_autofill" => self.password_autofill = v == "1",
            "suspend_background_tabs" => self.suspend_background_tabs = v == "1",
            "suspend_after_minutes" => self.suspend_after_minutes = v.parse().unwrap_or(15),
            "max_live_webviews" => self.max_live_webviews = v.parse().unwrap_or(12),
            "devtools_enabled" => self.devtools_enabled = v == "1",
            "gestures_enabled" => self.gestures_enabled = v == "1",
            "compat_ua" => self.compat_ua = v == "1",
            _ => {}
        }
    }

    /// Validate + persist a single pref. Returns the normalized value or None if invalid.
    pub fn set(&mut self, db: &Db, key: &str, value: &str) -> Option<String> {
        if BOOL_KEYS.contains(&key) {
            let v = if value == "true" || value == "1" { "1" } else { "0" };
            self.apply(key, v);
            self.persist(db, key, v);
            return Some(v.into());
        }
        if U32_KEYS.contains(&key) {
            let n: u32 = value.parse().ok()?;
            let v = n.to_string();
            self.apply(key, &v);
            self.persist(db, key, &v);
            return Some(v);
        }
        if STRING_KEYS.contains(&key) {
            if let Some((_, allowed)) = VALID.iter().find(|(k, _)| *k == key) {
                if !allowed.contains(&value) {
                    return None;
                }
            }
            if key == "accent" && !valid_hex_color(value) {
                return None;
            }
            self.apply(key, value);
            self.persist(db, key, value);
            return Some(value.into());
        }
        None
    }

    fn persist(&self, db: &Db, key: &str, value: &str) {
        db.exec(|c| {
            let _ = c.execute(
                "INSERT INTO prefs(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=?2",
                rusqlite::params![key, value],
            );
        });
    }

    pub fn search_url_for(&self, query: &str) -> String {
        let q = urlencoding_compat(query);
        let tpl = match self.search_engine.as_str() {
            "google" => "https://www.google.com/search?q={}",
            "bing" => "https://www.bing.com/search?q={}",
            "brave" => "https://search.brave.com/search?q={}",
            "startpage" => "https://www.startpage.com/sp/search?query={}",
            "ecosia" => "https://www.ecosia.org/search?q={}",
            _ => "https://duckduckgo.com/?q={}",
        };
        tpl.replace("{}", &q)
    }

    /// JSON snapshot pushed into content scripts + chrome UI.
    pub fn to_json(&self) -> serde_json::Value {
        json!({
            "theme": self.theme, "accent": self.accent, "density": self.density,
            "show_home_button": self.show_home_button, "show_bookmarks_bar": self.show_bookmarks_bar,
            "startup_mode": self.startup_mode, "homepage": self.homepage, "search_engine": self.search_engine,
            "download_dir": self.download_dir, "ask_download_path": self.ask_download_path,
            "adblock_enabled": self.adblock_enabled, "netfilter_enabled": self.netfilter_enabled,
            "cosmetic_enabled": self.cosmetic_enabled, "heuristic_cosmetic": self.heuristic_cosmetic,
            "strip_tracking_params": self.strip_tracking_params,
            "fp_canvas": self.fp_canvas, "fp_audio": self.fp_audio, "fp_webgl": self.fp_webgl,
            "fp_navigator": self.fp_navigator, "block_malicious": self.block_malicious,
            "do_not_track": self.do_not_track, "block_thirdparty_js_cookies": self.block_thirdparty_js_cookies,
            "geo_default": self.geo_default, "notifications_default": self.notifications_default,
            "autoplay_default": self.autoplay_default, "camera_default": self.camera_default,
            "password_autofill": self.password_autofill,
            "weather_enabled": self.weather_enabled,
            "suspend_background_tabs": self.suspend_background_tabs,
            "suspend_after_minutes": self.suspend_after_minutes, "max_live_webviews": self.max_live_webviews,
            "devtools_enabled": self.devtools_enabled, "gestures_enabled": self.gestures_enabled,
            "compat_ua": self.compat_ua,
        })
    }
}

fn valid_hex_color(s: &str) -> bool {
    let h = s.strip_prefix('#').unwrap_or(s);
    h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit())
}

fn urlencoding_compat(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

pub const SEARCH_ENGINES: &[(&str, &str)] = &[
    ("duckduckgo", "DuckDuckGo"),
    ("google", "Google"),
    ("bing", "Bing"),
    ("brave", "Brave Search"),
    ("startpage", "Startpage"),
    ("ecosia", "Ecosia"),
    ("none", "None — treat all input as URLs"),
];

pub const CHROME_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
pub const ZEPHYR_UA: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Zephyr/0.1 Safari/605.1.15";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_validates() {
        let dir = std::env::temp_dir().join(format!("zephyr-prefs-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let db = Db::open(&dir.join("p.db")).unwrap();
        let mut p = Prefs::default();
        assert!(p.set(&db, "theme", "dark").is_some());
        assert!(p.set(&db, "theme", "purple").is_none());
        assert!(p.set(&db, "adblock_enabled", "true").is_some());
        assert!(!p.adblock_enabled == false);
        assert!(p.set(&db, "accent", "#12abef").is_some());
        assert!(p.set(&db, "accent", "nope").is_none());
        assert!(p.set(&db, "bogus_key", "1").is_none());
        // round trip
        let p2 = Prefs::load(&db);
        assert_eq!(p2.theme, "dark");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
