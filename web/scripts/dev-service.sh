#!/bin/sh
# Runs the dev supervisor (scripts/dev-all.mjs) as a macOS login service and shares
# the Vite port on your tailnet, so the client is always at https://<mac>.<tailnet>.ts.net/
#
#   web/scripts/dev-service.sh install     start now and at every login, and share on the tailnet
#   web/scripts/dev-service.sh uninstall   stop, remove the service, and stop sharing
#   web/scripts/dev-service.sh restart     restart the supervisor (e.g. after editing dev-all.mjs)
#   web/scripts/dev-service.sh status      show whether it's running and the tailnet URL
#   web/scripts/dev-service.sh logs        follow the log
#
# Stop-gap until we have real hosting. The service runs whatever is checked out in
# this working tree.
set -eu

LABEL=com.commandquest.dev
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/commandquest-dev.log"
WEB=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node)
TS=$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)
DOMAIN="gui/$(id -u)"

case "${1:-}" in
install)
  mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$WEB/scripts/dev-all.mjs</string></array>
  <key>WorkingDirectory</key><string>$WEB</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  launchctl bootstrap "$DOMAIN" "$PLIST"
  "$TS" serve --bg 5173
  echo "Installed. Logs: $LOG"
  ;;
uninstall)
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  "$TS" serve --https=443 off 2>/dev/null || true
  echo "Removed service and tailnet share."
  ;;
restart)
  launchctl kickstart -k "$DOMAIN/$LABEL"
  ;;
status)
  launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -E "^\t(state|pid) =" || echo "service not installed"
  "$TS" serve status
  ;;
logs)
  tail -n 50 -f "$LOG"
  ;;
*)
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
