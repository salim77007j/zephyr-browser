// Zephyr Browser — assembles the JavaScript bundle injected into every content
// page at document start: filter data + prefs + permission allowlists + all
// content scripts (bridge, netfilter, cosmetic, fingerprint protection, media
// control, gestures, find-in-page, page wrapper).
use crate::prefs::Prefs;

pub struct BundleInput<'a> {
    pub filter_json: &'a str,
    pub prefs: &'a Prefs,
    pub perms_json: &'a str,
    pub allowlist_json: &'a str,
    pub tab_id: i64,
    pub muted: bool,
    pub zoom: f64,
    pub find_open: bool,
}

pub fn build(input: &BundleInput) -> String {
    let prefs_json = serde_json::to_string(&input.prefs.to_json()).unwrap_or_default();
    let mut out = String::with_capacity(160 * 1024);
    out.push_str("(function(){\n\"use strict\";\n");
    out.push_str("if(window.__ZX_BUNDLE__)return;window.__ZX_BUNDLE__=1;\n");
    out.push_str(&format!("window.__ZX_TAB={};\n", input.tab_id));
    out.push_str(&format!("window.__ZX_MUTED={};\n", if input.muted { "true" } else { "false" }));
    out.push_str(&format!("window.__ZX_ZOOM={};\n", input.zoom));
    out.push_str(&format!("window.__ZX_FIND_OPEN={};\n", if input.find_open { "true" } else { "false" }));
    out.push_str(&format!("window.__ZXD={};\n", input.filter_json));
    out.push_str(&format!("window.__ZXP={};\n", prefs_json));
    out.push_str(&format!("window.__ZX_PERM={};\n", input.perms_json));
    out.push_str(&format!("window.__ZX_ALLOW={};\n", input.allowlist_json));
    // scripts
    out.push_str(include_str!("../assets/content/bridge.js"));
    out.push('\n');
    out.push_str(include_str!("../assets/content/netfilter.js"));
    out.push('\n');
    out.push_str(include_str!("../assets/content/cosmetic.js"));
    out.push('\n');
    out.push_str(include_str!("../assets/content/fp.js"));
    out.push('\n');
    out.push_str(include_str!("../assets/content/mediactrl.js"));
    out.push('\n');
    out.push_str(include_str!("../assets/content/gestures.js"));
    out.push('\n');
    out.push_str(include_str!("../assets/content/finder.js"));
    out.push('\n');
    out.push_str(include_str!("../assets/content/pagewrap.js"));
    out.push('\n');
    out.push_str("})();\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_contains_core_pieces() {
        let prefs = Prefs::default();
        let b = build(&BundleInput {
            filter_json: r#"{"ads":"","trackers":"","mal":"","exc":"","gen":[],"dom":{},"enabled":true}"#,
            prefs: &prefs,
            perms_json: r#"{"geolocation":"ask"}"#,
            allowlist_json: r#"{}"#,
            tab_id: 7,
            muted: false,
            zoom: 1.0,
            find_open: false,
        });
        assert!(b.contains("window.__ZX_TAB=7"));
        assert!(b.contains("__ZX_BUNDLE__"));
        assert!(b.contains("sendBeacon") || b.contains("netfilter"));
        // must be parseable-ish: balanced braces
        let open = b.matches('{').count();
        let close = b.matches('}').count();
        assert_eq!(open, close, "unbalanced braces in bundle");
    }
}
