// Zephyr Browser — data models: history, bookmarks, downloads, permissions,
// shortcuts, zooms, blocked stats.
use crate::db::Db;
use crate::util::{fnv1a, now_ms, url_host, url_origin};
use rusqlite::params;

// ---------------------------------------------------------------- history
#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub last_visit: u64,
    pub visit_count: i64,
    pub has_favicon: bool,
}

pub fn add_visit(db: &Db, url: &str, title: &str) {
    let now = now_ms() as i64;
    db.exec(|c| {
        let _ = c.execute(
            "INSERT INTO history(url,title,last_visit,visit_count) VALUES(?1,?2,?3,1)
             ON CONFLICT(url) DO UPDATE SET last_visit=?3, visit_count=visit_count+1, title=?2",
            params![url, title, now],
        );
        if let Ok(id) = c.query_row("SELECT last_insert_rowid()", [], |r| r.get::<_, i64>(0)) {
            let _ = c.execute("INSERT INTO visits(history_id, at) VALUES(?1,?2)", params![id, now]);
        }
    });
}

pub fn history_list(db: &Db, q: &str, limit: i64, offset: i64) -> Vec<HistoryEntry> {
    let like = format!("%{}%", q.trim().to_lowercase());
    db.exec(|c| {
        let sql = if q.trim().is_empty() {
            "SELECT id,url,title,last_visit,visit_count,favicon IS NOT NULL FROM history
             ORDER BY last_visit DESC LIMIT ?1 OFFSET ?2"
        } else {
            "SELECT id,url,title,last_visit,visit_count,favicon IS NOT NULL FROM history
             WHERE lower(url) LIKE ?3 OR lower(title) LIKE ?3
             ORDER BY last_visit DESC LIMIT ?1 OFFSET ?2"
        };
        let mut stmt = match c.prepare(sql) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let map = |r: &rusqlite::Row| -> Result<HistoryEntry, rusqlite::Error> {
            Ok(HistoryEntry {
                id: r.get(0)?,
                url: r.get(1)?,
                title: r.get(2)?,
                last_visit: r.get::<_, i64>(3)? as u64,
                visit_count: r.get(4)?,
                has_favicon: r.get::<_, i64>(5)? != 0,
            })
        };
        if q.trim().is_empty() {
            stmt.query_map(params![limit, offset], map).map(|it| it.flatten().collect()).unwrap_or_default()
        } else {
            stmt.query_map(params![limit, offset, like], map).map(|it| it.flatten().collect()).unwrap_or_default()
        }
    })
}

pub fn history_remove(db: &Db, id: i64) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM visits WHERE history_id=?1", params![id]);
        let _ = c.execute("DELETE FROM history WHERE id=?1", params![id]);
    });
}

pub fn history_clear(db: &Db) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM visits", []);
        let _ = c.execute("DELETE FROM history", []);
    });
}

pub fn favicon_get(db: &Db, url: &str) -> Option<Vec<u8>> {
    db.exec(|c| {
        c.query_row("SELECT favicon FROM history WHERE url=?1", params![url], |r| r.get(0)).ok()
    })
}

pub fn favicon_set(db: &Db, url: &str, host: &str, data: &[u8]) {
    db.exec(|c| {
        let _ = c.execute(
            "UPDATE history SET favicon=?3 WHERE url=?1 OR url LIKE ?2",
            params![url, format!("https://{}%", host), data],
        );
    });
}

#[derive(Clone, Debug)]
pub struct TopSite {
    pub host: String,
    pub url: String,
    pub title: String,
    pub visit_count: i64,
    pub last_visit: u64,
    pub has_favicon: bool,
}

pub fn top_sites(db: &Db, n: usize) -> Vec<TopSite> {
    let entries = history_list(db, "", 4000, 0);
    let mut by_host: std::collections::HashMap<String, TopSite> = std::collections::HashMap::new();
    for e in entries {
        if let Some(h) = url_host(&e.url) {
            let score = e.visit_count;
            let entry = by_host.entry(h.clone()).or_insert_with(|| TopSite {
                host: h,
                url: e.url.clone(),
                title: e.title.clone(),
                visit_count: 0,
                last_visit: 0,
                has_favicon: e.has_favicon,
            });
            entry.visit_count += score;
            if e.last_visit > entry.last_visit {
                entry.last_visit = e.last_visit;
                entry.url = e.url.clone();
                if !e.title.is_empty() {
                    entry.title = e.title.clone();
                }
            }
        }
    }
    let mut v: Vec<TopSite> = by_host.into_values().collect();
    v.sort_by(|a, b| b.visit_count.cmp(&a.visit_count).then(b.last_visit.cmp(&a.last_visit)));
    v.truncate(n);
    v
}

// ---------------------------------------------------------------- bookmarks
#[derive(Clone, Debug)]
pub struct Bookmark {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub added: u64,
}

pub fn bookmark_add(db: &Db, url: &str, title: &str) -> bool {
    db.exec(|c| {
        c.execute(
            "INSERT OR IGNORE INTO bookmarks(url,title,added,position) VALUES(?1,?2,?3,
             COALESCE((SELECT MAX(position)+1 FROM bookmarks),0))",
            params![url, title, now_ms() as i64],
        )
        .map(|n| n > 0)
        .unwrap_or(false)
    })
}

pub fn bookmark_remove(db: &Db, id: i64) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM bookmarks WHERE id=?1", params![id]);
    });
}

pub fn bookmark_remove_url(db: &Db, url: &str) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM bookmarks WHERE url=?1", params![url]);
    });
}

pub fn bookmark_exists(db: &Db, url: &str) -> bool {
    db.exec(|c| {
        c.query_row("SELECT 1 FROM bookmarks WHERE url=?1", params![url], |_| Ok(true))
            .unwrap_or(false)
    })
}

pub fn bookmarks_list(db: &Db, q: &str) -> Vec<Bookmark> {
    let like = format!("%{}%", q.trim().to_lowercase());
    db.exec(|c| {
        let sql = if q.trim().is_empty() {
            "SELECT id,url,title,added FROM bookmarks ORDER BY position, added DESC"
        } else {
            "SELECT id,url,title,added FROM bookmarks WHERE lower(url) LIKE ?2 OR lower(title) LIKE ?2 ORDER BY position, added DESC"
        };
        let mut stmt = match c.prepare(sql) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        let map = |r: &rusqlite::Row| -> Result<Bookmark, rusqlite::Error> {
            Ok(Bookmark {
                id: r.get(0)?,
                url: r.get(1)?,
                title: r.get(2)?,
                added: r.get::<_, i64>(3)? as u64,
            })
        };
        if q.trim().is_empty() {
            stmt.query_map([], map).map(|it| it.flatten().collect()).unwrap_or_default()
        } else {
            stmt.query_map(params![like], map).map(|it| it.flatten().collect()).unwrap_or_default()
        }
    })
}

// ---------------------------------------------------------------- downloads
#[derive(Clone, Debug)]
pub struct DownloadRec {
    pub id: i64,
    pub url: String,
    pub path: String,
    pub size: i64,
    pub state: String, // active | done | cancelled | failed
    pub started: u64,
    pub finished: u64,
    pub mime: String,
}

pub fn download_add(db: &Db, url: &str, path: &str, mime: &str) -> i64 {
    db.exec(|c| {
        c.execute(
            "INSERT INTO downloads(url,path,size,state,started,finished,mime) VALUES(?1,?2,0,'active',?3,0,?4)",
            params![url, path, now_ms() as i64, mime],
        )
        .ok();
        c.last_insert_rowid()
    })
}

pub fn download_update(db: &Db, id: i64, size: i64, state: &str) {
    db.exec(|c| {
        let fin = if state == "done" || state == "failed" || state == "cancelled" {
            now_ms() as i64
        } else {
            0
        };
        let _ = c.execute(
            "UPDATE downloads SET size=?2, state=?3, finished=CASE WHEN ?4>0 THEN ?5 ELSE finished END WHERE id=?1",
            params![id, size, state, fin, fin],
        );
    });
}

pub fn downloads_list(db: &Db) -> Vec<DownloadRec> {
    db.exec(|c| {
        let mut stmt = match c.prepare(
            "SELECT id,url,path,size,state,started,finished,mime FROM downloads ORDER BY id DESC LIMIT 500",
        ) {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map([], |r| -> Result<DownloadRec, rusqlite::Error> {
            Ok(DownloadRec {
                id: r.get(0)?,
                url: r.get(1)?,
                path: r.get(2)?,
                size: r.get(3)?,
                state: r.get(4)?,
                started: r.get::<_, i64>(5)? as u64,
                finished: r.get::<_, i64>(6)? as u64,
                mime: r.get(7)?,
            })
        })
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    })
}

pub fn download_remove(db: &Db, id: i64) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM downloads WHERE id=?1", params![id]);
    });
}

pub fn downloads_clear(db: &Db) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM downloads WHERE state != 'active'", []);
    });
}

// ---------------------------------------------------------------- permissions
pub fn perm_get(db: &Db, origin: &str, kind: &str) -> Option<String> {
    db.exec(|c| {
        c.query_row(
            "SELECT value FROM permissions WHERE origin=?1 AND kind=?2",
            params![origin, kind],
            |r| r.get(0),
        )
        .ok()
    })
}

/// Effective policy for a site: per-site override > global default.
pub fn perm_effective(db: &Db, prefs: &crate::prefs::Prefs, url: &str, kind: &str) -> String {
    let origin = url_origin(url).unwrap_or_default();
    if origin.is_empty() {
        return "block".into();
    }
    if let Some(v) = perm_get(db, &origin, kind) {
        return v;
    }
    match kind {
        "geolocation" => prefs.geo_default.clone(),
        "notifications" => prefs.notifications_default.clone(),
        "autoplay" => prefs.autoplay_default.clone(),
        "camera" => prefs.camera_default.clone(),
        "microphone" => prefs.camera_default.clone(),
        _ => "block".into(),
    }
}

pub fn perm_set(db: &Db, origin: &str, kind: &str, value: &str) {
    db.exec(|c| {
        let _ = c.execute(
            "INSERT INTO permissions(origin,kind,value) VALUES(?1,?2,?3)
             ON CONFLICT(origin,kind) DO UPDATE SET value=?3",
            params![origin, kind, value],
        );
    });
}

pub fn perm_clear(db: &Db, origin: Option<&str>) {
    db.exec(|c| match origin {
        Some(o) => {
            let _ = c.execute("DELETE FROM permissions WHERE origin=?1", params![o]);
        }
        None => {
            let _ = c.execute("DELETE FROM permissions", []);
        }
    });
}

pub fn perm_list(db: &Db) -> Vec<(String, String, String)> {
    db.exec(|c| {
        let mut stmt = match c.prepare("SELECT origin,kind,value FROM permissions ORDER BY origin") {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map(|it| it.flatten().collect())
            .unwrap_or_default()
    })
}

/// Allowlist map (kind -> [origins]) embedded into content scripts.
pub fn perm_allowlist(db: &Db) -> serde_json::Value {
    let rows = perm_list(db);
    let mut map = serde_json::Map::new();
    for (origin, kind, value) in rows {
        if value == "allow" {
            let arr = map
                .entry(kind)
                .or_insert_with(|| serde_json::Value::Array(vec![]));
            if let serde_json::Value::Array(a) = arr {
                a.push(serde_json::Value::String(origin));
            }
        }
    }
    serde_json::Value::Object(map)
}

// ---------------------------------------------------------------- shortcuts (NTP quick links)
#[derive(Clone, Debug)]
pub struct Shortcut {
    pub id: i64,
    pub url: String,
    pub title: String,
}

pub fn shortcut_add(db: &Db, url: &str, title: &str) -> bool {
    db.exec(|c| {
        c.execute(
            "INSERT OR IGNORE INTO shortcuts(url,title,position) VALUES(?1,?2,
             COALESCE((SELECT MAX(position)+1 FROM shortcuts),0))",
            params![url, title],
        )
        .map(|_| true)
        .unwrap_or(false)
    })
}

pub fn shortcut_remove(db: &Db, id: i64) {
    db.exec(|c| {
        let _ = c.execute("DELETE FROM shortcuts WHERE id=?1", params![id]);
    });
}

pub fn shortcuts_list(db: &Db) -> Vec<Shortcut> {
    db.exec(|c| {
        let mut stmt = match c.prepare("SELECT id,url,title FROM shortcuts ORDER BY position") {
            Ok(s) => s,
            Err(_) => return vec![],
        };
        stmt.query_map([], |r| -> Result<Shortcut, rusqlite::Error> {
            Ok(Shortcut {
                id: r.get(0)?,
                url: r.get(1)?,
                title: r.get(2)?,
            })
        })
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
    })
}

// ---------------------------------------------------------------- zooms
pub fn zoom_get(db: &Db, url: &str) -> f64 {
    let origin = url_origin(url).unwrap_or_default();
    if origin.is_empty() {
        return 1.0;
    }
    db.exec(|c| {
        c.query_row("SELECT factor FROM zooms WHERE origin=?1", params![origin], |r| {
            r.get::<_, f64>(0)
        })
        .unwrap_or(1.0)
    })
}

pub fn zoom_set(db: &Db, url: &str, factor: f64) {
    let origin = url_origin(url).unwrap_or_default();
    if origin.is_empty() {
        return;
    }
    db.exec(|c| {
        let _ = c.execute(
            "INSERT INTO zooms(origin,factor) VALUES(?1,?2)
             ON CONFLICT(origin) DO UPDATE SET factor=?2",
            params![origin, factor],
        );
    });
}

// ---------------------------------------------------------------- stats
#[derive(Clone, Copy, Debug, Default)]
pub struct StatCounts {
    pub ads: u64,
    pub trackers: u64,
    pub cosmetic: u64,
    pub params: u64,
    pub malicious: u64,
}

pub fn stats_add_day(db: &Db, day: &str, c: StatCounts) {
    db.exec(|cnx| {
        let _ = cnx.execute(
            "INSERT INTO blocked_stats(day,ads,trackers,cosmetic,params) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(day) DO UPDATE SET
               ads=ads+?2, trackers=trackers+?3, cosmetic=cosmetic+?4, params=params+?5",
            params![day, c.ads as i64, c.trackers as i64, c.cosmetic as i64, c.params as i64],
        );
    });
}

pub fn stats_get_day(db: &Db, day: &str) -> StatCounts {
    db.exec(|c| {
        c.query_row(
            "SELECT ads,trackers,cosmetic,params FROM blocked_stats WHERE day=?1",
            params![day],
            |r| -> Result<StatCounts, rusqlite::Error> {
                Ok(StatCounts {
                    ads: r.get::<_, i64>(0)? as u64,
                    trackers: r.get::<_, i64>(1)? as u64,
                    cosmetic: r.get::<_, i64>(2)? as u64,
                    params: r.get::<_, i64>(3)? as u64,
                    malicious: 0,
                })
            },
        )
        .unwrap_or_default()
    })
}

/// Deterministic pleasant color for avatar chips.
pub fn host_color(host: &str) -> String {
    let h = fnv1a(host);
    let hue = h % 360;
    format!("hsl({}, 55%, 45%)", hue)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> Db {
        let dir = std::env::temp_dir().join(format!("zephyr-models-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        Db::open(&dir.join("m.db")).unwrap()
    }

    #[test]
    fn history_upsert() {
        let db = tmp_db();
        add_visit(&db, "https://example.com/a", "Example");
        add_visit(&db, "https://example.com/a", "Example 2");
        let l = history_list(&db, "", 10, 0);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].visit_count, 2);
        assert_eq!(l[0].title, "Example 2");
    }

    #[test]
    fn bookmarks() {
        let db = tmp_db();
        assert!(bookmark_add(&db, "https://rust-lang.org", "Rust"));
        assert!(!bookmark_add(&db, "https://rust-lang.org", "Rust"));
        assert!(bookmark_exists(&db, "https://rust-lang.org"));
        bookmark_remove_url(&db, "https://rust-lang.org");
        assert!(bookmarks_list(&db, "").is_empty());
    }

    #[test]
    fn permissions() {
        let db = tmp_db();
        let mut prefs = crate::prefs::Prefs::default();
        prefs.geo_default = "ask".into();
        perm_set(&db, "https://maps.example", "geolocation", "allow");
        assert_eq!(perm_effective(&db, &prefs, "https://maps.example/x", "geolocation"), "allow");
        assert_eq!(perm_effective(&db, &prefs, "https://other.com", "geolocation"), "ask");
    }
}
