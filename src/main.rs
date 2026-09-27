// Zephyr Browser — entry point
mod chrome_server;
mod content_scripts;
mod db;
mod filters;
mod logger;
mod messages;
mod models;
mod passwords;
mod prefs;
mod tabs;
mod util;

#[cfg(feature = "gui")]
mod app;
#[cfg(feature = "gui")]
mod commands;
#[cfg(feature = "gui")]
mod smoke;

use std::path::PathBuf;

fn default_data_dir() -> PathBuf {
    dirs::data_dir()
        .map(|d| d.join("zephyr"))
        .unwrap_or_else(|| PathBuf::from(".zephyr-data"))
}

fn print_version() {
    println!("Zephyr Browser 0.1.0 — privacy-first, ultra-light browser built in Rust");
    println!("engine: WebView2 (Windows) / WebKitGTK (Linux) via wry 0.51");
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let smoke_mode = args.iter().any(|a| a == "--smoke");
    let verbose = args.iter().any(|a| a == "--verbose" || a == "-v");
    let data_dir_arg = args.iter().find(|a| a.starts_with("--data-dir=")).map(|a| a[11..].to_string());

    if args.iter().any(|a| a == "--version" || a == "-V" || a == "--help" || a == "-h") {
        print_version();
        if args.iter().any(|a| a == "--help" || a == "-h") {
            println!();
            println!("Usage: zephyr [OPTIONS]");
            println!("  --smoke            run headless smoke test (for CI / xvfb)");
            println!("  --verbose          debug logging");
            println!("  --data-dir=PATH    profile/data directory");
            println!("  --filter-check     parse bundled filter lists and print stats, then exit");
            println!("  --version          print version");
        }
        return;
    }

    // ---- core-only utility: filter list verification (works without GUI deps)
    if args.iter().any(|a| a == "--filter-check") {
        let e = filters::Engine::build(&[
            ("easylist".into(), "ads".into(), filters::BUILTIN_EASYLIST.into()),
            ("easyprivacy".into(), "trackers".into(), filters::BUILTIN_EASYPRIVACY.into()),
            ("malicious".into(), "malicious".into(), filters::BUILTIN_MALICIOUS.into()),
        ]);
        println!("filter engine ready");
        println!("  network rules: {}", e.rule_count);
        println!("  ad hosts:       {}", e.ad_hosts.len());
        println!("  tracker hosts:  {}", e.tracker_hosts.len());
        println!("  malicious:      {}", e.malicious_hosts.len());
        println!("  exceptions:     {}", e.exceptions.len());
        println!("  generic selectors: {}", e.generic_selectors.len());
        println!("  domain rules:   {}", e.domain_selectors.len());
        let spot = [
            ("doubleclick.net", true),
            ("www.google-analytics.com", true),
            ("example.com", false),
        ];
        for (h, expect) in spot {
            let got = e.host_class(h).is_some();
            println!("  check {} -> {} (expected {})", h, got, expect);
            assert_eq!(got, expect, "host check failed for {}", h);
        }
        println!("filter-check: OK");
        return;
    }

    #[cfg(feature = "gui")]
    {
        let data_dir = match (&data_dir_arg, smoke_mode) {
            (Some(d), _) => PathBuf::from(d),
            (None, true) => {
                let d = default_data_dir().join("smoke-run");
                let _ = std::fs::remove_dir_all(&d);
                d
            }
            (None, false) => default_data_dir(),
        };
        let _ = std::fs::create_dir_all(&data_dir);
        logger::init(Some(&data_dir.join("zephyr.log")), verbose || smoke_mode);

        // Isolate the web engine profile inside our data dir (cookies, cache).
        // On Linux, WebKitGTK honors XDG_DATA_HOME / XDG_CACHE_HOME, so redirect
        // them BEFORE any GTK/WebKit initialization. This makes
        // "clear cookies & site data" a real, complete operation.
        #[cfg(target_os = "linux")]
        {
            let profile = data_dir.join("engine-profile");
            let _ = std::fs::create_dir_all(&profile);
            // unsafe: single-threaded at this point, before any threads spawn
            unsafe {
                std::env::set_var("XDG_DATA_HOME", profile.join("data"));
                std::env::set_var("XDG_CACHE_HOME", profile.join("cache"));
            }
            if std::env::var("ZEPHYR_SOFTWARE_RENDER").map(|v| v == "1").unwrap_or(false) {
                unsafe {
                    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
                }
            }
        }

        let event_loop = tao::event_loop::EventLoopBuilder::<app::UserEvent>::with_user_event().build();
        let app_obj = match app::App::new(&event_loop, data_dir.clone(), smoke_mode) {
            Ok(a) => a,
            Err(e) => {
                eprintln!("fatal: {}", e);
                std::process::exit(2);
            }
        };
        let mut app_obj = app_obj;

        // smoke driver
        if smoke_mode {
            app_obj.smoke = Some(smoke::SmokeCtx::new());
            let proxy = app_obj.proxy.clone();
            smoke::start_driver(std::sync::mpsc::channel().0, proxy);
        }

        // ticker: autosave / suspension / download progress
        {
            let proxy = app_obj.proxy.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(5));
                if proxy.send_event(app::UserEvent::Tick).is_err() {
                    break;
                }
            });
        }

        // first window (+ session restore)
        let session_tabs = if !smoke_mode && app_obj.prefs.startup_mode == "session" {
            tabs::load_session(&app_obj.data_dir).map(|s| {
                s.windows.first().map(|w| w.tabs.clone()).unwrap_or_default()
            })
        } else {
            None
        };
        let target_init: &tao::event_loop::EventLoop<app::UserEvent> = &event_loop;
        if let Err(e) = app_obj.create_window(target_init, session_tabs) {
            eprintln!("fatal: {}", e);
            std::process::exit(2);
        }

        crate::zinfo!("core", "zephyr up — data dir {}", app_obj.data_dir.display());

        let mut app_obj = app_obj;
        event_loop.run(move |event, target, control_flow| {
            app_obj.handle_event(event, target, control_flow);
        });
    }

    #[cfg(not(feature = "gui"))]
    {
        let _ = (data_dir_arg, smoke_mode, verbose);
        println!("built without the gui feature — only --filter-check / --version are available");
    }
}
