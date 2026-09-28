// Zephyr Browser — loopback HTTP server that serves the embedded browser UI,
// internal pages, new-tab page, fixtures and error pages. Bound to 127.0.0.1
// with a random port and an unguessable token path prefix.
use std::io::Read;
use std::sync::mpsc::Sender;
use std::thread;
use tiny_http::{Header, Method, Response, Server};

pub struct ChromeServer {
    pub port: u16,
    pub token: String,
    shutdown: Option<Sender<()>>,
}

fn ctype(path: &str) -> &'static str {
    if path.ends_with(".html") {
        "text/html; charset=utf-8"
    } else if path.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if path.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if path.ends_with(".svg") {
        "image/svg+xml"
    } else if path.ends_with(".png") {
        "image/png"
    } else if path.ends_with(".ico") {
        "image/x-icon"
    } else if path.ends_with(".json") {
        "application/json"
    } else {
        "text/plain; charset=utf-8"
    }
}

fn asset(path: &str) -> Option<(&'static [u8], &'static str)> {
    let (data, ct): (&[u8], &str) = match path {
        "/ui/index.html" => (include_bytes!("../assets/ui/index.html"), "text/html; charset=utf-8"),
        "/ui/app.css" => (include_bytes!("../assets/ui/app.css"), "text/css; charset=utf-8"),
        "/ui/app.js" => (include_bytes!("../assets/ui/app.js"), "text/javascript; charset=utf-8"),
        "/ui/overlay.html" => (include_bytes!("../assets/ui/overlay.html"), "text/html; charset=utf-8"),
        "/ui/overlay.css" => (include_bytes!("../assets/ui/overlay.css"), "text/css; charset=utf-8"),
        "/ui/overlay.js" => (include_bytes!("../assets/ui/overlay.js"), "text/javascript; charset=utf-8"),
        "/find/find.html" => (include_bytes!("../assets/find/find.html"), "text/html; charset=utf-8"),
        "/find/find.css" => (include_bytes!("../assets/find/find.css"), "text/css; charset=utf-8"),
        "/find/find.js" => (include_bytes!("../assets/find/find.js"), "text/javascript; charset=utf-8"),
        "/img/google.svg" => (include_bytes!("../assets/img/google.svg"), "image/svg+xml"),
        "/img/youtube.svg" => (include_bytes!("../assets/img/youtube.svg"), "image/svg+xml"),
        "/img/gmail.svg" => (include_bytes!("../assets/img/gmail.svg"), "image/svg+xml"),
        "/img/maps.svg" => (include_bytes!("../assets/img/maps.svg"), "image/svg+xml"),
        "/img/drive.svg" => (include_bytes!("../assets/img/drive.svg"), "image/svg+xml"),
        "/img/shield.svg" => (include_bytes!("../assets/img/shield.svg"), "image/svg+xml"),
        "/content/edge.js" => (include_bytes!("../assets/content/edge.js"), "text/javascript; charset=utf-8"),
        "/ntp/index.html" => (include_bytes!("../assets/ntp/index.html"), "text/html; charset=utf-8"),
        "/ntp/ntp.css" => (include_bytes!("../assets/ntp/ntp.css"), "text/css; charset=utf-8"),
        "/ntp/ntp.js" => (include_bytes!("../assets/ntp/ntp.js"), "text/javascript; charset=utf-8"),
        "/pages/pages.css" => (include_bytes!("../assets/pages/pages.css"), "text/css; charset=utf-8"),
        "/pages/pages.js" => (include_bytes!("../assets/pages/pages.js"), "text/javascript; charset=utf-8"),
        "/pages/bookmarks.html" => (include_bytes!("../assets/pages/bookmarks.html"), "text/html; charset=utf-8"),
        "/pages/history.html" => (include_bytes!("../assets/pages/history.html"), "text/html; charset=utf-8"),
        "/pages/downloads.html" => (include_bytes!("../assets/pages/downloads.html"), "text/html; charset=utf-8"),
        "/pages/settings.html" => (include_bytes!("../assets/pages/settings.html"), "text/html; charset=utf-8"),
        "/pages/privacy.html" => (include_bytes!("../assets/pages/privacy.html"), "text/html; charset=utf-8"),
        "/pages/blocked.html" => (include_bytes!("../assets/pages/blocked.html"), "text/html; charset=utf-8"),
        "/pages/error.html" => (include_bytes!("../assets/pages/error.html"), "text/html; charset=utf-8"),
        "/pages/source.html" => (include_bytes!("../assets/pages/source.html"), "text/html; charset=utf-8"),
        "/fixtures/adtest.html" => (include_bytes!("../assets/fixtures/adtest.html"), "text/html; charset=utf-8"),
        "/fixtures/lorem.html" => (include_bytes!("../assets/fixtures/lorem.html"), "text/html; charset=utf-8"),
        _ => return None,
    };
    Some((data, ct))
}

impl ChromeServer {
    pub fn start() -> std::io::Result<Self> {
        // tiny_http doesn't resolve ephemeral port 0 for us — pick a random port
        let mut server = None;
        let mut port = 0u16;
        for _ in 0..24 {
            let cand = 20000u16 + (rand::random::<u16>() % 30000);
            match Server::http(format!("127.0.0.1:{}", cand)) {
                Ok(s) => {
                    server = Some(s);
                    port = cand;
                    break;
                }
                Err(_) => continue,
            }
        }
        let server = server.ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::AddrInUse, "no free port for chrome server")
        })?;
        // unguessable token
        let mut tok = [0u8; 16];
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut tok);
        let token: String = tok.iter().map(|b| format!("{:02x}", b)).collect();
        let token_c = token.clone();

        let (tx, rx) = std::sync::mpsc::channel::<()>();
        thread::Builder::new()
            .name("chrome-http".into())
            .spawn(move || {
                let server = server;
                // Poll for shutdown between requests
                loop {
                    if rx.try_recv().is_ok() {
                        break;
                    }
                    let request = match server.recv_timeout(std::time::Duration::from_millis(250)) {
                        Ok(Some(r)) => r,
                        Ok(None) => continue,
                        Err(_) => break,
                    };
                    Self::handle(request, &token_c);
                }
            })
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        Ok(Self { port, token, shutdown: Some(tx) })
    }

    fn handle(mut request: tiny_http::Request, token: &str) {
        let url = request.url().to_string();
        let method = request.method().clone();
        // drain body if any
        if method != Method::Get && method != Method::Head {
            let mut buf = [0u8; 4096];
            let _ = request.as_reader().read(&mut buf);
        }
        // strip query
        let path_q = url.split('?').next().unwrap_or("").to_string();
        let prefix = format!("/{}/", token);
        let sub: String = if path_q == format!("/{}", token) || path_q == "/" {
            "/ui/index.html".to_string()
        } else if let Some(rest) = path_q.strip_prefix(&prefix) {
            format!("/{}", rest)
        } else {
            // unauthorized
            let resp = Response::from_string("not found").with_status_code(404);
            let _ = request.respond(resp);
            return;
        };
        let sub = if sub == "/" { "/ui/index.html".to_string() } else { sub };
        match asset(sub.as_str()) {
            Some((data, ct)) => {
                let resp = Response::from_data(data.to_vec())
                    .with_header(Header::from_bytes(&b"Content-Type"[..], ct.as_bytes()).unwrap())
                    .with_header(Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap())
                    .with_header(Header::from_bytes(&b"X-Content-Type-Options"[..], &b"nosniff"[..]).unwrap());
                let _ = request.respond(resp);
            }
            None => {
                let resp = Response::from_string("not found")
                    .with_status_code(404)
                    .with_header(Header::from_bytes(&b"Content-Type"[..], &b"text/plain"[..]).unwrap());
                let _ = request.respond(resp);
            }
        }
    }

    pub fn url_for(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}/{}/{}", self.port, self.token, path.trim_start_matches('/'))
    }

    pub fn base(&self) -> String {
        format!("http://127.0.0.1:{}/{}", self.port, self.token)
    }

    pub fn is_internal(&self, url: &str) -> bool {
        url.starts_with(&format!("http://127.0.0.1:{}/", self.port))
    }
}

impl Drop for ChromeServer {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_serves_ui() {
        let srv = ChromeServer::start().unwrap();
        let url = srv.url_for("ui/app.css");
        let body = ureq::get(&url).call().unwrap().into_string().unwrap();
        assert!(body.contains("--strip-bg") || body.contains("--bg"));
        let bad = format!("http://127.0.0.1:{}/nope", srv.port);
        let status = match ureq::get(&bad).call() {
            Ok(r) => r.status(),
            Err(ureq::Error::Status(c, _)) => c,
            Err(_) => 0,
        };
        assert_eq!(status, 404, "unauthorized path must 404");
        let no_token = srv.url_for("ui/index.html");
        assert!(no_token.contains(&srv.token));
    }
}
