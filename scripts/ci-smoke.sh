#!/bin/bash
# CI smoke runner — uses system webkit (apt) on a GitHub runner.
# Usage: ci-smoke.sh [binary] [output-dir]
set -u
BIN=$(readlink -f "${1:-./zephyr}")
OUT=${2:-./smoke-artifacts}
mkdir -p "$OUT"
rm -f "$OUT"/*.png "$OUT"/smoke-report.json 2>/dev/null

# headless-friendly GL stack (runners have no GPU) + speed optimizations
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
export GDK_RENDER_MODE=image
export LP_NUM_THREADS=2
# fresh profile every run (deterministic checks)
rm -rf "$HOME/.local/share/zephyr/smoke-run" 2>/dev/null
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp/xdg-run}"
mkdir -p "$XDG_RUNTIME_DIR" 2>/dev/null || true

REPO_DIR="$PWD"

xvfb-run -a -s "-screen 0 1440x900x24 -nolisten tcp" bash -c "
  cd '$REPO_DIR'
  '$BIN' --smoke --verbose > '$OUT/smoke.log' 2>&1 &
  BPID=\$!
  sleep 2.5;  { xwininfo -root -tree; } > '$OUT/shots.err' 2>&1 || true
  import -window root '$OUT/01-newtab.png' 2>>'$OUT/shots.err' || true
  sleep 1.7;  import -window root '$OUT/02-adtest.png' 2>>'$OUT/shots.err' || true
  sleep 1.6;  import -window root '$OUT/03-ntp.png' 2>>'$OUT/shots.err' || true
  sleep 2.0;  import -window root '$OUT/04-settings.png' 2>>'$OUT/shots.err' || true
  sleep 2.0;  import -window root '$OUT/05-privacy.png' 2>>'$OUT/shots.err' || true
  sleep 2.8;  import -window root '$OUT/06-find.png' 2>>'$OUT/shots.err' || true
  sleep 1.3;  import -window root '$OUT/07-menu.png' 2>>'$OUT/shots.err' || true
  sleep 5.6;  import -window root '$OUT/08-siteinfo.png' 2>>'$OUT/shots.err' || true
  sleep 4.3;  import -window root '$OUT/09-findbar.png' 2>>'$OUT/shots.err' || true
  sleep 3.1;  import -window root '$OUT/10-suggest.png' 2>>'$OUT/shots.err' || true
  wait \$BPID
  exit \$?
"
RC=$?

for c in "$HOME/.local/share/zephyr/smoke-run/smoke-report.json" "./smoke-report.json"; do
  if [ -f "$c" ]; then cp "$c" "$OUT/smoke-report.json"; break; fi
done
echo "smoke exit code: $RC"
grep -E "STAGE:|CHECK:" "$OUT/smoke.log" | tail -40
exit $RC
