// Zephyr Browser — IPC protocol types shared by GUI and content scripts.
// Messages are JSON objects: { "ns": "chrome"|"content", "cmd": "...", "tab": id?, "data": {...} }
use serde_json::Value;

#[derive(Clone, Debug)]
pub struct IpcMsg {
    pub ns: String,
    pub cmd: String,
    pub tab: Option<i64>,
    pub data: Value,
}

impl IpcMsg {
    pub fn parse(raw: &str) -> Option<Self> {
        let v: Value = serde_json::from_str(raw.trim()).ok()?;
        let ns = v.get("ns")?.as_str()?.to_string();
        let cmd = v.get("cmd")?.as_str()?.to_string();
        let tab = v.get("tab").and_then(|t| t.as_i64());
        let data = v.get("data").cloned().unwrap_or(Value::Null);
        if ns.is_empty() || cmd.is_empty() {
            return None;
        }
        Some(Self { ns, cmd, tab, data })
    }

    pub fn s(&self, key: &str) -> String {
        self.data.get(key).and_then(|v| v.as_str()).unwrap_or("").to_string()
    }

    pub fn i(&self, key: &str) -> i64 {
        self.data.get(key).and_then(|v| v.as_i64()).unwrap_or(0)
    }

    pub fn b(&self, key: &str) -> bool {
        self.data.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
    }

    pub fn f(&self, key: &str) -> f64 {
        self.data.get(key).and_then(|v| v.as_f64()).unwrap_or(0.0)
    }
}

/// Build a push event for evaluate_script: `window.__zx && __zx.emit("event", payload)`
/// NOTE: two separate arguments — the JS emit handlers have signature (event, payload).
pub fn push_js(event: &str, payload: &Value) -> String {
    let ev = serde_json::to_string(event).unwrap_or_default();
    let s = serde_json::to_string(payload).unwrap_or_default();
    format!(
        "window.__zx&&__zx.emit({},{})",
        ev,
        s.replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic() {
        let m = IpcMsg::parse(r#"{"ns":"chrome","cmd":"nav","data":{"url":"https://x.com"}}"#).unwrap();
        assert_eq!(m.ns, "chrome");
        assert_eq!(m.cmd, "nav");
        assert_eq!(m.s("url"), "https://x.com");
        assert!(m.tab.is_none());
    }

    #[test]
    fn rejects_garbage() {
        assert!(IpcMsg::parse("not json").is_none());
        assert!(IpcMsg::parse("{}").is_none());
        assert!(IpcMsg::parse(r#"{"ns":"","cmd":"x"}"#).is_none());
    }

    #[test]
    fn push_js_is_safe() {
        let js = push_js("test", &serde_json::json!({"a": 1}));
        assert!(js.starts_with("window.__zx&&__zx.emit(\"test\",{"));
        assert!(js.ends_with(")"));
        // two arguments: quoted event name, then the payload object
        assert!(js.contains("\"test\","));
    }
}
