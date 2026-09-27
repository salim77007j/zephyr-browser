// Zephyr Browser — small shared utilities
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn today_key() -> String {
    // YYYY-MM-DD in UTC — good enough for daily stats buckets
    let secs = now_ms() / 1000;
    let days = secs / 86400;
    // Convert epoch days to civil date (Howard Hinnant's algorithm)
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { yoe as i64 + era * 400 + 1 } else { yoe as i64 + era * 400 };
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Extract host from a URL string, tolerating partial inputs like "example.com/x".
pub fn url_host(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() {
        return None;
    }
    let with_scheme = if u.contains("://") {
        u.to_string()
    } else {
        format!("http://{}", u)
    };
    if let Ok(parsed) = url::Url::parse(&with_scheme) {
        let h = parsed.host_str()?;
        return Some(h.to_lowercase());
    }
    None
}

pub fn url_origin(url: &str) -> Option<String> {
    let with_scheme = if url.contains("://") {
        url.to_string()
    } else {
        format!("http://{}", url)
    };
    url::Url::parse(&with_scheme).ok().map(|u| {
        let port = u.port().map(|p| format!(":{}", p)).unwrap_or_default();
        format!("{}://{}{}", u.scheme(), u.host_str().unwrap_or(""), port)
    })
}

/// Turn an arbitrary string into a safe file name.
pub fn sanitize_filename(name: &str) -> String {
    let mut out = String::new();
    for c in name.chars() {
        if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' || c == ' ' {
            out.push(c);
        } else {
            out.push('_');
        }
    }
    let out = out.trim().trim_matches('.').to_string();
    if out.is_empty() {
        "download".to_string()
    } else {
        out.chars().take(120).collect()
    }
}

/// Avoid clobbering existing files: returns path with " (n)" inserted before extension.
pub fn unique_path(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
    let base = dir.join(sanitize_filename(name));
    if !base.exists() {
        return base;
    }
    let stem = base
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("download")
        .to_string();
    let ext = base
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{}", e))
        .unwrap_or_default();
    for i in 1..1000 {
        let p = dir.join(format!("{} ({}){}", stem, i, ext));
        if !p.exists() {
            return p;
        }
    }
    base
}

/// Simple deterministic string hash (FNV-1a 32) — used for avatar colors etc.
pub fn fnv1a(s: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in s.as_bytes() {
        h ^= *b as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

/// Read total RSS (KiB) of this process and any WebKit helper processes (best effort).
pub fn process_tree_rss_kib() -> u64 {
    let mut total = read_status_rss("/proc/self/status").unwrap_or(0);
    if let Ok(entries) = std::fs::read_dir("/proc") {
        for e in entries.flatten() {
            let comm = e.path().join("comm");
            if let Ok(name) = std::fs::read_to_string(&comm) {
                let name = name.trim();
                if name.starts_with("WebKit") || name.starts_with("WPEWeb") {
                    if let Some(rss) = read_status_rss(&e.path().join("status").to_string_lossy()) {
                        total += rss;
                    }
                }
            }
        }
    }
    total
}

fn read_status_rss(path: &str) -> Option<u64> {
    let txt = std::fs::read_to_string(path).ok()?;
    for line in txt.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: u64 = rest.trim().trim_end_matches("kB").trim().parse().ok()?;
            return Some(kb);
        }
    }
    None
}

pub fn human_bytes(n: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = n as f64;
    let mut i = 0usize;
    while v >= 1024.0 && i < 4 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{} {}", n, U[0])
    } else {
        format!("{:.1} {}", v, U[i])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_host() {
        assert_eq!(url_host("https://Example.com/path"), Some("example.com".into()));
        assert_eq!(url_host("example.com"), Some("example.com".into()));
        assert_eq!(url_host("http://localhost:8080/x"), Some("localhost".into()));
    }

    #[test]
    fn test_today() {
        let t = today_key();
        assert_eq!(t.len(), 10);
        assert!(t.starts_with("20"));
    }

    #[test]
    fn test_sanitize() {
        assert!(!sanitize_filename("../etc/passwd").contains('/'));
        assert_eq!(sanitize_filename("a b.txt"), "a b.txt");
    }
}
