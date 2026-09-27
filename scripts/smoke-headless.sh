#!/bin/bash
# Zephyr headless smoke test — direct Xvfb (no xauth dependency).
# Screenshot timings match the smoke driver schedule in src/smoke.rs:
#   t=1.2 boot/adtest open · 3.8 adtest · 4.5 NTP · 6.5 settings
#   8.5 privacy · 10.3 find · ~13.5 report+exit
# Usage: smoke-headless.sh [binary] [output-dir]
set -u
BIN=${1:-./target/release/zephyr}
OUT=${2:-./smoke-artifacts}
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/smoke-report.json 2>/dev/null

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-runtime}"
mkdir -p "$XDG_RUNTIME_DIR" 2>/dev/null

cd "$(dirname "$0")/.."

export DISPLAY=:95
Xvfb :95 -screen 0 1440x900x24 -nolisten tcp > /dev/null 2>&1 &
XPID=$!
sleep 0.8

"$BIN" --smoke --verbose > "$OUT/smoke.log" 2>&1 &
BPID=$!

sleep 2.5;  gm import -window root "$OUT/01-newtab.png" 2>/dev/null || true
sleep 1.7;  gm import -window root "$OUT/02-adtest.png" 2>/dev/null || true
sleep 1.6;  gm import -window root "$OUT/03-ntp.png" 2>/dev/null || true
sleep 2.0;  gm import -window root "$OUT/04-settings.png" 2>/dev/null || true
sleep 2.0;  gm import -window root "$OUT/05-privacy.png" 2>/dev/null || true
sleep 1.5;  gm import -window root "$OUT/06-find.png" 2>/dev/null || true

wait $BPID
RC=$?
kill $XPID 2>/dev/null

for c in "$HOME/.local/share/zephyr/smoke-run/smoke-report.json" "./smoke-report.json" "$OUT/smoke-report.json"; do
  if [ -f "$c" ]; then cp "$c" "$OUT/smoke-report.json"; break; fi
done
echo "exit code: $RC"
grep -E "STAGE:|CHECK:" "$OUT/smoke.log" 2>/dev/null | tail -40
exit $RC
