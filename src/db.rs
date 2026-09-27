// Zephyr Browser — SQLite storage (rusqlite, bundled)
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct Db {
    pub conn: Arc<Mutex<Connection>>,
}

const MIGRATIONS: &[&str] = &[
    // v1
    "CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT DEFAULT '',
        last_visit INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 1,
        favicon BLOB
    );",
    "CREATE TABLE IF NOT EXISTS visits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        history_id INTEGER NOT NULL,
        at INTEGER NOT NULL
    );",
    "CREATE INDEX IF NOT EXISTS idx_visits_at ON visits(at DESC);",
    "CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT DEFAULT '',
        added INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
    );",
    "CREATE TABLE IF NOT EXISTS downloads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        path TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        state TEXT NOT NULL DEFAULT 'active',
        started INTEGER NOT NULL,
        finished INTEGER DEFAULT 0,
        mime TEXT DEFAULT ''
    );",
    "CREATE TABLE IF NOT EXISTS passwords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL,
        username TEXT NOT NULL,
        secret BLOB NOT NULL,
        nonce BLOB NOT NULL,
        created INTEGER NOT NULL,
        UNIQUE(origin, username)
    );",
    "CREATE TABLE IF NOT EXISTS permissions (
        origin TEXT NOT NULL,
        kind TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (origin, kind)
    );",
    "CREATE TABLE IF NOT EXISTS filter_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        url TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'ads',
        builtin INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_updated INTEGER NOT NULL DEFAULT 0,
        rule_count INTEGER NOT NULL DEFAULT 0
    );",
    "CREATE TABLE IF NOT EXISTS blocked_stats (
        day TEXT PRIMARY KEY,
        ads INTEGER NOT NULL DEFAULT 0,
        trackers INTEGER NOT NULL DEFAULT 0,
        cosmetic INTEGER NOT NULL DEFAULT 0,
        params INTEGER NOT NULL DEFAULT 0
    );",
    "CREATE TABLE IF NOT EXISTS shortcuts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0
    );",
    "CREATE TABLE IF NOT EXISTS zooms (
        origin TEXT PRIMARY KEY,
        factor REAL NOT NULL DEFAULT 1.0
    );",
    "CREATE INDEX IF NOT EXISTS idx_history_last ON history(last_visit DESC);",
];

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        if let Some(dir) = path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY;",
        )?;
        let db = Self { conn: Arc::new(Mutex::new(conn)) };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL);")?;
        let v: i64 = conn
            .query_row("SELECT COALESCE(MAX(v),0) FROM schema_version", [], |r| r.get(0))
            .unwrap_or(0);
        let cur = MIGRATIONS.len() as i64;
        for stmt in MIGRATIONS.iter() {
            conn.execute_batch(stmt)?;
        }
        if v < cur {
            conn.execute("INSERT INTO schema_version(v) VALUES (?1)", [cur])?;
        }
        Ok(())
    }

    pub fn exec<F, T>(&self, f: F) -> T
    where
        F: FnOnce(&Connection) -> T,
    {
        let guard = self.conn.lock().unwrap();
        f(&guard)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn db_opens_and_migrates() {
        let dir = std::env::temp_dir().join(format!("zephyr-test-db-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let db = Db::open(&dir.join("t.db")).expect("open");
        let n: i64 = db.exec(|c| {
            c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table'", [], |r| r.get(0))
                .unwrap()
        });
        assert!(n >= 10, "expected tables, got {}", n);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
