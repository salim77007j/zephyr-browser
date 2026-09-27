// Zephyr Browser — filter engine: parses EasyList-syntax lists into
// (a) host-based network block data, (b) cosmetic selector data, and produces
// the JSON payload injected into content scripts. Also handles list updates.
use crate::db::Db;
use crate::util::now_ms;
use serde_json::json;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlockClass {
    Ad,
    Tracker,
    Malicious,
}

impl BlockClass {
    pub fn key(self) -> &'static str {
        match self {
            BlockClass::Ad => "ads",
            BlockClass::Tracker => "trackers",
            BlockClass::Malicious => "malicious",
        }
    }
}

pub struct Engine {
    pub ad_hosts: BTreeSet<String>,
    pub tracker_hosts: BTreeSet<String>,
    pub malicious_hosts: BTreeSet<String>,
    pub exceptions: BTreeSet<String>,
    pub generic_selectors: Vec<String>,
    pub domain_selectors: HashMap<String, (Vec<String>, Vec<String>)>, // domain -> (hide, exception selectors)
    pub rule_count: usize,
    pub cosmetic_count: usize,
    pub lists_meta: Vec<ListMeta>,
}

#[derive(Clone, Debug)]
pub struct ListMeta {
    pub name: String,
    pub url: String,
    pub kind: String, // ads | trackers | malicious | custom
    pub builtin: bool,
    pub enabled: bool,
    pub last_updated: u64,
    pub rule_count: i64,
}

pub const EASYLIST_URL: &str = "https://easylist.to/easylist/easylist.txt";
pub const EASYPRIVACY_URL: &str = "https://easylist.to/easylist/easyprivacy.txt";

const MAX_HOSTS_PER_CLASS: usize = 70_000;
const MAX_GENERIC_SELECTORS: usize = 20_000;
const MAX_DOMAINS: usize = 1_200;
const MAX_SELECTORS_PER_DOMAIN: usize = 120;

impl Engine {
    /// Build from raw list texts.
    pub fn build(lists: &[(String, String, String)]) -> Self {
        // lists: (name, kind, text)
        let mut e = Engine {
            ad_hosts: BTreeSet::new(),
            tracker_hosts: BTreeSet::new(),
            malicious_hosts: BTreeSet::new(),
            exceptions: BTreeSet::new(),
            generic_selectors: Vec::new(),
            domain_selectors: HashMap::new(),
            rule_count: 0,
            cosmetic_count: 0,
            lists_meta: vec![],
        };
        for (name, kind, text) in lists {
            let (network, cosmetic) = e.parse_list(text);
            let net_count = network.len();
            let set = match kind.as_str() {
                "trackers" => &mut e.tracker_hosts,
                "malicious" => &mut e.malicious_hosts,
                _ => &mut e.ad_hosts,
            };
            let _ = name;
            for h in network {
                set.insert(h);
            }
            e.rule_count += cosmetic.0 + net_count;
        }
        e.rule_count += e.cosmetic_count;
        e
    }

    /// Parse one list. Returns (hosts, (network_rule_count, cosmetic_count via self mutation)).
    fn parse_list(&mut self, text: &str) -> (Vec<String>, (usize, usize)) {
        let mut hosts = Vec::new();
        let mut net_count = 0usize;
        let mut cos_count = 0usize;
        for raw in text.lines() {
            let line = raw.trim();
            if line.is_empty() || line.starts_with('!') || line.starts_with('[') {
                continue;
            }
            // Cosmetic rule? Look for "##", "#@#", "#$#", "#?#"
            if let Some(pos) = find_cosmetic_marker(line) {
                let (domains_part, marker, selector_part) = split_cosmetic(line, pos);
                let selector = selector_part.trim();
                if selector.is_empty() || selector.len() > 400 {
                    continue;
                }
                let is_exception = marker == "#@#";
                // Translate ABP-specific pseudo-selectors to modern CSS where possible
                let sel = translate_selector(selector);
                if sel.is_empty() {
                    continue;
                }
                cos_count += 1;
                if domains_part.is_empty() {
                    if !is_exception {
                        if self.generic_selectors.len() < MAX_GENERIC_SELECTORS
                            && !self.generic_selectors.contains(&sel)
                        {
                            self.generic_selectors.push(sel);
                        }
                    }
                } else {
                    for d in domains_part.split(',') {
                        let d = d.trim().trim_start_matches('~');
                        if d.is_empty() {
                            continue;
                        }
                        let key = d.to_lowercase();
                        let entry = self
                            .domain_selectors
                            .entry(key)
                            .or_insert_with(|| (Vec::new(), Vec::new()));
                        if is_exception {
                            if entry.1.len() < MAX_SELECTORS_PER_DOMAIN && !entry.1.contains(&sel) {
                                entry.1.push(sel.clone());
                            }
                        } else if entry.0.len() < MAX_SELECTORS_PER_DOMAIN && !entry.0.contains(&sel) {
                            entry.0.push(sel.clone());
                        }
                    }
                }
                continue;
            }
            // Network rule
            net_count += 1;
            let (is_exception, rule, options) = if let Some(rest) = line.strip_prefix("@@") {
                (true, rest, "")
            } else if let Some(idx) = line.find('$') {
                (false, &line[..idx], &line[idx + 1..])
            } else {
                (false, line, "")
            };
            if rule.is_empty() {
                continue;
            }
            let host = extract_host_token(rule);
            if let Some(h) = host {
                if is_exception {
                    // Honor only broad, host-only exceptions.
                    // Path-specific whitelists (@@||host/path) and top-document
                    // contexts ($document etc.) cannot be modeled by host matching —
                    // skipping them errs on the side of blocking (documented).
                    let path_specific = rule.contains('/');
                    let doc_only = options.split(',').any(|o| {
                        matches!(o.trim(), "document" | "generichide" | "elemhide" | "specifichide" | "content" | "popup")
                    });
                    if !path_specific && !doc_only {
                        self.exceptions.insert(h);
                    }
                } else {
                    hosts.push(h);
                }
            }
        }
        // Cap total generic selectors & domains handled by caps at insert time.
        (hosts, (net_count, cos_count))
    }

    /// Rust-side check (used for downloads, navigation hard-block, view-source).
    pub fn host_class(&self, host: &str) -> Option<BlockClass> {
        if self.host_matches(&self.exceptions, host) {
            return None;
        }
        if self.host_matches(&self.ad_hosts, host) {
            return Some(BlockClass::Ad);
        }
        if self.host_matches(&self.tracker_hosts, host) {
            return Some(BlockClass::Tracker);
        }
        if self.host_matches(&self.malicious_hosts, host) {
            return Some(BlockClass::Malicious);
        }
        None
    }

    pub fn url_blocked(&self, url: &str) -> Option<BlockClass> {
        crate::util::url_host(url).and_then(|h| self.host_class(&h))
    }

    fn host_matches(&self, set: &BTreeSet<String>, host: &str) -> bool {
        if set.contains(host) {
            return true;
        }
        // suffix match: sub.example.com matches "example.com" entry
        let mut rest = host;
        while let Some(idx) = rest.find('.') {
            rest = &rest[idx + 1..];
            if set.contains(rest) {
                return true;
            }
        }
        false
    }

    /// JSON payload consumed by the injected content scripts.
    pub fn filter_data_json(&self, prefs: &crate::prefs::Prefs) -> String {
        let join = |s: &BTreeSet<String>| -> String {
            s.iter().take(MAX_HOSTS_PER_CLASS).cloned().collect::<Vec<_>>().join("\n")
        };
        // Trim domain map to the domains with most selectors
        let mut domains: Vec<(&String, &(Vec<String>, Vec<String>))> = self.domain_selectors.iter().collect();
        domains.sort_by_key(|(_, (sel, exc))| std::cmp::Reverse(sel.len() + exc.len()));
        domains.truncate(MAX_DOMAINS);
        let mut dmap = serde_json::Map::new();
        for (d, (hide, exc)) in domains {
            if hide.is_empty() && exc.is_empty() {
                continue;
            }
            dmap.insert(
                d.clone(),
                json!({ "h": hide.iter().take(MAX_SELECTORS_PER_DOMAIN).collect::<Vec<_>>(),
                        "e": exc.iter().take(MAX_SELECTORS_PER_DOMAIN).collect::<Vec<_>>() }),
            );
        }
        let payload = json!({
            "enabled": prefs.adblock_enabled,
            "net": prefs.netfilter_enabled,
            "cosmetic": prefs.cosmetic_enabled,
            "heuristic": prefs.heuristic_cosmetic,
            "stripParams": prefs.strip_tracking_params,
            "malicious": prefs.block_malicious,
            "ads": join(&self.ad_hosts),
            "trackers": join(&self.tracker_hosts),
            "mal": join(&self.malicious_hosts),
            "exc": join(&self.exceptions),
            "gen": self.generic_selectors.iter().take(MAX_GENERIC_SELECTORS).collect::<Vec<_>>(),
            "dom": dmap,
            "ruleCount": self.rule_count,
        });
        // JSON is a valid JS object literal except for U+2028/2029 in strings.
        let s = serde_json::to_string(&payload).unwrap_or_default();
        s.replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029")
    }
}

fn find_cosmetic_marker(line: &str) -> Option<usize> {
    // Find "##", "#@#", "#$#", "#?#" preceded by a domain part (may be empty).
    let bytes = line.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'#' {
            let next = bytes[i + 1];
            if next == b'#' || next == b'@' || next == b'$' || next == b'?' {
                // Avoid matching inside e.g. "example.com#div#id"? EasyList domain parts
                // never contain '#', so the first '#x#' occurrence is the marker.
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

fn split_cosmetic(line: &str, pos: usize) -> (&str, &str, &str) {
    // Marker forms: "##" (2 chars) or "#@#" / "#$#" / "#?#" (3 chars).
    // The first '#' is at `pos`; check the SECOND char to decide length.
    let bytes = line.as_bytes();
    let (mlen, m) = if bytes.get(pos + 1) == Some(&b'#') {
        (2, &line[pos..pos + 2])
    } else {
        (3, &line[pos..pos + 3])
    };
    (&line[..pos], m, &line[pos + mlen..])
}

fn translate_selector(sel: &str) -> String {
    let mut s = sel.trim().to_string();
    // Drop scriptlet injections "##^script:..." and "##+js(...)" fragments
    if s.starts_with('^') || s.starts_with("+js(") {
        return String::new();
    }
    // Translate extended operators
    s = s.replace(":-abp-has(", ":has(").replace(":-abp-contains(", ":contains(");
    // ":contains()" is not valid CSS — drop selectors using it (rare)
    if s.contains(":contains(") {
        return String::new();
    }
    // ":style(...)" and ":upward(...)" — strip trailing operators
    if let Some(idx) = s.find(":style(") {
        s.truncate(idx);
    }
    if let Some(idx) = s.find(":upward(") {
        s.truncate(idx);
    }
    if let Some(idx) = s.find(":nth-ancestor(") {
        s.truncate(idx);
    }
    let s = s.trim().to_string();
    if s.is_empty() {
        return String::new();
    }
    // Basic sanity: balanced brackets/quotes
    let open = s.matches('(').count();
    let close = s.matches(')').count();
    if open != close {
        return String::new();
    }
    if s.matches('"').count() % 2 != 0 || s.matches('\'').count() % 2 != 0 {
        return String::new();
    }
    s
}

/// Extract a registrable-ish host token from a network rule.
fn extract_host_token(rule: &str) -> Option<String> {
    let mut r = rule.trim();
    // Strip anchors
    if let Some(rest) = r.strip_prefix("||") {
        r = rest;
    } else if let Some(rest) = r.strip_prefix('|') {
        r = rest;
    }
    // Cut at path / wildcard / separator
    for sep in ['/', '*', '^', ':'] {
        if let Some(idx) = r.find(sep) {
            r = &r[..idx];
        }
    }
    // What remains should look like a hostname
    if r.is_empty() || !r.contains('.') || r.len() > 253 {
        return None;
    }
    let mut label_ok = true;
    for label in r.split('.') {
        if label.is_empty() || label.len() > 63 {
            label_ok = false;
            break;
        }
        if !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            label_ok = false;
            break;
        }
    }
    // Require at least one alphabetic char to avoid IPs we don't want to wildcard
    if !label_ok || !r.chars().any(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some(r.to_lowercase())
}

// ---------------------------------------------------------------------------
// List storage + updates
// ---------------------------------------------------------------------------

pub const BUILTIN_EASYLIST: &str = include_str!("../assets/lists/easylist.txt");
pub const BUILTIN_EASYPRIVACY: &str = include_str!("../assets/lists/easyprivacy.txt");
pub const BUILTIN_MALICIOUS: &str = include_str!("../assets/lists/malicious.txt");

pub fn lists_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("lists")
}

/// Ensure bundled lists exist on disk; sync builtins into db; return metas.
pub fn sync_builtin_lists(db: &Db, data_dir: &Path) -> Vec<ListMeta> {
    let dir = lists_dir(data_dir);
    let _ = std::fs::create_dir_all(&dir);
    let builtins: [(&str, &str, &str, &str); 3] = [
        ("easylist", EASYLIST_URL, "ads", BUILTIN_EASYLIST),
        ("easyprivacy", EASYPRIVACY_URL, "trackers", BUILTIN_EASYPRIVACY),
        ("malicious-domains", "", "malicious", BUILTIN_MALICIOUS),
    ];
    let mut metas = Vec::new();
    for (name, url, kind, text) in builtins {
        let path = dir.join(format!("{}.txt", name));
        if !path.exists() {
            let _ = std::fs::write(&path, text);
        }
        // register in db
        let (last_updated, rule_count): (u64, i64) = db.exec(|c| {
            c.execute(
                "INSERT OR IGNORE INTO filter_lists(name,url,kind,builtin,enabled,last_updated,rule_count)
                 VALUES(?1,?2,?3,1,1,0,0)",
                rusqlite::params![name, url, kind],
            )
            .ok();
            c.query_row(
                "SELECT last_updated, rule_count FROM filter_lists WHERE name=?1",
                rusqlite::params![name],
                |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)?)),
            )
            .unwrap_or((0, 0))
        });
        metas.push(ListMeta {
            name: name.into(),
            url: url.into(),
            kind: kind.into(),
            builtin: true,
            enabled: true,
            last_updated,
            rule_count,
        });
    }
    // custom lists
    let custom: Vec<ListMeta> = db.exec(|c| {
        let mut stmt = match c.prepare(
            "SELECT name,url,kind,builtin,enabled,last_updated,rule_count FROM filter_lists WHERE builtin=0",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map([], |r| {
            Ok(ListMeta {
                name: r.get(0)?,
                url: r.get(1)?,
                kind: r.get(2)?,
                builtin: r.get::<_, i64>(3)? != 0,
                enabled: r.get::<_, i64>(4)? != 0,
                last_updated: r.get::<_, i64>(5)? as u64,
                rule_count: r.get(6)?,
            })
        })
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    });
    metas.extend(custom);
    metas
}

/// Load all enabled lists from disk and build the engine.
pub fn load_engine(db: &Db, data_dir: &Path) -> Engine {
    let metas = sync_builtin_lists(db, data_dir);
    let dir = lists_dir(data_dir);
    let mut lists: Vec<(String, String, String)> = Vec::new();
    for m in &metas {
        if !m.enabled {
            continue;
        }
        let path = dir.join(format!("{}.txt", m.name));
        if let Ok(text) = std::fs::read_to_string(&path) {
            lists.push((m.name.clone(), m.kind.clone(), text));
        }
    }
    if lists.is_empty() {
        // Fallback: bundled only (should not happen, but keep robust)
        lists.push(("easylist".into(), "ads".into(), BUILTIN_EASYLIST.into()));
        lists.push(("easyprivacy".into(), "trackers".into(), BUILTIN_EASYPRIVACY.into()));
        lists.push(("malicious-domains".into(), "malicious".into(), BUILTIN_MALICIOUS.into()));
    }
    let mut e = Engine::build(&lists);
    e.lists_meta = metas;
    e
}

/// Fetch a list over HTTPS; returns the text on success.
pub fn fetch_list(url: &str) -> Result<String, String> {
    if url.is_empty() {
        return Err("no url".into());
    }
    let agent = ureq::AgentBuilder::new()
        .timeout(std::time::Duration::from_secs(20))
        .redirects(5)
        .build();
    let resp = agent
        .get(url)
        .set("User-Agent", "ZephyrBrowser/0.1 (filter list updater)")
        .call()
        .map_err(|e| format!("{}", e))?;
    let mut reader = resp.into_reader();
    let mut buf = Vec::new();
    std::io::Read::read_to_end(&mut reader, &mut buf).map_err(|e| format!("{}", e))?;
    if buf.len() < 64 || buf.len() > 32 * 1024 * 1024 {
        return Err(format!("suspicious size: {}", buf.len()));
    }
    let text = String::from_utf8_lossy(&buf).into_owned();
    // sanity: must contain filter-list-ish lines
    if !text.lines().any(|l| l.starts_with("||") || l.contains("##") || l.starts_with('!')) {
        return Err("does not look like a filter list".into());
    }
    Ok(text)
}

/// Update one list on disk + db. Returns new rule_count.
pub fn update_list(db: &Db, data_dir: &Path, name: &str, url: &str, kind: &str) -> Result<i64, String> {
    let text = fetch_list(url)?;
    let path = lists_dir(data_dir).join(format!("{}.txt", name));
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, text.as_bytes()).map_err(|e| format!("{}", e))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("{}", e))?;
    // count rules
    let rule_count = text
        .lines()
        .filter(|l| {
            let l = l.trim();
            !l.is_empty() && !l.starts_with('!') && !l.starts_with('[')
        })
        .count() as i64;
    db.exec(|c| {
        let _ = c.execute(
            "INSERT INTO filter_lists(name,url,kind,builtin,enabled,last_updated,rule_count)
             VALUES(?1,?2,?3,0,1,?4,?5)
             ON CONFLICT(name) DO UPDATE SET last_updated=?4, rule_count=?5, url=?2",
            rusqlite::params![name, url, kind, now_ms() as i64, rule_count],
        );
    });
    Ok(rule_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
! Title: Test list
||doubleclick.net^
||ads.example.com/banner
||tracker.io^$script,third-party
example.org/ads/
@@||allowed.com^
##.ad-banner
##div[id^="google_ads"]
example.com##.sidebar-ad
news.com,~mail.news.com##.sponsored
example.net#@#.promo
"#;

    #[test]
    fn parses_network_rules() {
        let e = Engine::build(&[("test".into(), "ads".into(), SAMPLE.into())]);
        assert!(e.host_class("doubleclick.net") == Some(BlockClass::Ad));
        assert!(e.host_class("ads.example.com") == Some(BlockClass::Ad));
        assert!(e.host_class("sub.tracker.io") == Some(BlockClass::Ad), "suffix match");
        assert!(e.host_class("allowed.com").is_none(), "exception");
        assert!(e.host_class("good.org").is_none());
    }

    #[test]
    fn parses_cosmetic_rules() {
        let e = Engine::build(&[("test".into(), "ads".into(), SAMPLE.into())]);
        assert!(e.generic_selectors.contains(&".ad-banner".to_string()));
        assert!(e.generic_selectors.iter().any(|s| s.contains("google_ads")));
        assert_eq!(e.domain_selectors.get("example.com").unwrap().0, vec![".sidebar-ad".to_string()]);
        let news = e.domain_selectors.get("news.com").unwrap();
        assert_eq!(news.0, vec![".sponsored".to_string()]);
        let exn = e.domain_selectors.get("example.net").unwrap();
        assert!(exn.1.contains(&".promo".to_string()));
    }

    #[test]
    fn builtin_lists_parse() {
        let e = Engine::build(&[
            ("easylist".into(), "ads".into(), BUILTIN_EASYLIST.into()),
            ("easyprivacy".into(), "trackers".into(), BUILTIN_EASYPRIVACY.into()),
            ("malicious".into(), "malicious".into(), BUILTIN_MALICIOUS.into()),
        ]);
        assert!(e.rule_count > 5000, "expected many rules, got {}", e.rule_count);
        assert!(e.host_class("doubleclick.net").is_some(), "doubleclick should be blocked");
        assert!(e.host_class("www.google-analytics.com") == Some(BlockClass::Tracker));
        assert!(e.generic_selectors.len() > 500, "generic selectors: {}", e.generic_selectors.len());
        assert!(e.domain_selectors.len() > 100, "domain rules: {}", e.domain_selectors.len());
    }

    #[test]
    fn payload_is_valid_js_object() {
        let prefs = crate::prefs::Prefs::default();
        let e = Engine::build(&[("test".into(), "ads".into(), SAMPLE.into())]);
        let js = e.filter_data_json(&prefs);
        assert!(js.starts_with('{') && js.ends_with('}'));
        let _: serde_json::Value = serde_json::from_str(&js).expect("valid json");
    }
}
