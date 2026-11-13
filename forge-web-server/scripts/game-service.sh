#!/bin/sh
# Runs the game server on this Mac for the real sites, reachable at https://game.commandquest.app
# through a Cloudflare Tunnel. See docs/game-host.md.
#
#   forge-web-server/scripts/game-service.sh set-token   save the tunnel token (paste it, then Ctrl-D)
#   forge-web-server/scripts/game-service.sh deploy      build the pushed `web` branch, install it, (re)start
#   forge-web-server/scripts/game-service.sh status      services, version running, health check
#   forge-web-server/scripts/game-service.sh logs        follow the server log
#   forge-web-server/scripts/game-service.sh restart     restart the server (and tunnel)
#   forge-web-server/scripts/game-service.sh uninstall   stop and remove the services
#   forge-web-server/scripts/game-service.sh auto-on     every 15 min, deploy a new `web` when no game is running
#   forge-web-server/scripts/game-service.sh auto-off    stop doing that
#
# `deploy` builds a commit, not this working tree: it checks out REF (default `origin/web`) in its own
# worktree, so switching branches here never changes what players are on. Separate from the dev
# service (web/scripts/dev-service.sh), which uses port 8080; this one uses 8090.
set -eu

# The pushed web branch by default: a local `web` can lag behind when another worktree has it checked out.
REF=${REF:-origin/web}
PORT=${PORT:-8090}
ORIGINS=${ALLOWED_ORIGINS:-https://commandquest.app,https://staging.commandquest.app}
HOME_DIR="$HOME/.commandquest/game"
SRC="$HOME_DIR/src"
JAR="$HOME_DIR/forge-web-server.jar"
TOKEN="$HOME_DIR/tunnel-token"
LOGS="$HOME/Library/Logs"
# The auto-deploy job runs a copy of this script from $HOME_DIR, so it passes REPO explicitly.
REPO=${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}
CLOUDFLARED=$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)
DOMAIN="gui/$(id -u)"
SERVER=com.commandquest.game
TUNNEL=com.commandquest.tunnel
AUTO=com.commandquest.autodeploy

# Games in progress, from /health (empty if the server isn't answering).
games() {
  curl -fsS -m 5 "http://127.0.0.1:$PORT/health" 2>/dev/null | sed -n 's/.*"games":\([0-9]*\).*/\1/p'
}

plist() { # label, log file, then the program and its arguments
  label=$1 log=$2; shift 2
  args=""
  for a in "$@"; do args="$args<string>$a</string>"; done
  mkdir -p "$HOME/Library/LaunchAgents" "$LOGS"
  cat > "$HOME/Library/LaunchAgents/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array>$args</array>
  <key>WorkingDirectory</key><string>$SRC</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key><string>$PORT</string>
    <key>ALLOWED_ORIGINS</key><string>$ORIGINS</string>
    <key>GIT_SHA</key><string>$(cat "$HOME_DIR/version" 2>/dev/null || echo unknown)</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF
  stop "$label"
  launchctl bootstrap "$DOMAIN" "$HOME/Library/LaunchAgents/$label.plist"
}

# bootout returns before launchd has finished unloading, and bootstrapping again too soon fails
# with "Bootstrap failed: 5", so wait until the old job is really gone.
stop() {
  launchctl bootout "$DOMAIN/$1" 2>/dev/null || true
  i=0
  while launchctl print "$DOMAIN/$1" > /dev/null 2>&1 && [ $i -lt 50 ]; do
    sleep 0.2
    i=$((i + 1))
  done
}

remove() {
  stop "$1"
  rm -f "$HOME/Library/LaunchAgents/$1.plist"
}

case "${1:-}" in
set-token)
  mkdir -p "$HOME_DIR"
  umask 077
  echo "Paste the tunnel token, then press Ctrl-D:" >&2
  tr -d ' \r\n' > "$TOKEN"
  [ -s "$TOKEN" ] || { rm -f "$TOKEN"; echo "No token given." >&2; exit 1; }
  echo "Saved to $TOKEN. Run deploy (or restart) to start the tunnel." >&2
  ;;
deploy)
  mkdir -p "$HOME_DIR"
  [ "$REF" = origin/web ] && git -C "$REPO" fetch -q origin web
  sha=$(git -C "$REPO" rev-parse --verify "$REF^{commit}")
  if [ -d "$SRC" ]; then
    git -C "$SRC" checkout -q --detach "$sha"
  else
    git -C "$REPO" worktree add -q --detach "$SRC" "$sha"
  fi
  # A Forge merge can bump the version, which would leave the old version's jars beside the new ones.
  rm -f "$SRC"/forge-web-server/target/forge-web-server-*.jar
  echo "Building $REF ($(git -C "$SRC" log -1 --format='%h %s'))…"
  (cd "$SRC" && JAVA_HOME="$JAVA_HOME" mvn -q -f forge-web-server/reactor.xml package > "$HOME_DIR/build.log" 2>&1) \
    || { echo "Build or tests failed; the running server is unchanged. See $HOME_DIR/build.log" >&2; exit 1; }
  # Auto-deploy: a game may have started during the build. Don't cut it off; try again later.
  if [ -n "${IF_IDLE:-}" ]; then
    n=$(games)
    if [ -n "$n" ] && [ "$n" != 0 ]; then
      echo "A game started during the build; not restarting the server. Will try again." >&2
      exit 3
    fi
  fi
  cp "$SRC"/forge-web-server/target/forge-web-server-*-all.jar "$JAR.new"
  mv "$JAR.new" "$JAR"
  git -C "$SRC" rev-parse --short HEAD > "$HOME_DIR/version"
  # The copy auto-deploy runs. Replaced by rename, so a running copy keeps reading the old file.
  cp "$SRC/forge-web-server/scripts/game-service.sh" "$HOME_DIR/game-service.sh.new"
  mv "$HOME_DIR/game-service.sh.new" "$HOME_DIR/game-service.sh"
  plist "$SERVER" "$LOGS/commandquest-game.log" "$JAVA_HOME/bin/java" -jar "$JAR"
  if [ -s "$TOKEN" ]; then
    plist "$TUNNEL" "$LOGS/commandquest-tunnel.log" "$CLOUDFLARED" tunnel --no-autoupdate run --token-file "$TOKEN"
  else
    echo "No tunnel token yet (set-token), so the server is only on localhost:$PORT." >&2
  fi
  "$0" status
  ;;
restart)
  launchctl kickstart -k "$DOMAIN/$SERVER"
  [ -s "$TOKEN" ] && launchctl kickstart -k "$DOMAIN/$TUNNEL" 2>/dev/null || true
  ;;
status)
  for l in "$SERVER" "$TUNNEL" "$AUTO"; do
    printf '%s: ' "$l"
    launchctl print "$DOMAIN/$l" 2>/dev/null | awk '/^\tstate =/ {s=$3} /^\tpid =/ {p=$3} END {print (s ? s : "not installed") (p ? " (pid " p ")" : "")}'
  done
  echo "built: $(cat "$HOME_DIR/version" 2>/dev/null || echo never)"
  sleep 1
  printf 'local:  '; curl -fsS "http://127.0.0.1:$PORT/health" || echo "not answering"; echo
  printf 'public: '; curl -fsS -m 10 https://game.commandquest.app/health || echo "not answering"; echo
  ;;
logs)
  tail -n 50 -f "$LOGS/commandquest-game.log" "$LOGS/commandquest-tunnel.log"
  ;;
auto-deploy)
  # Run by launchd (auto-on). Deploys origin/web when it has moved past what's running, and only
  # while no game is in progress, so nobody's game is cut off by the restart.
  echo "$(date '+%F %T') checking"
  git -C "$REPO" fetch -q origin web
  want=$(git -C "$REPO" rev-parse origin/web)
  have=$(git -C "$REPO" rev-parse --verify -q "$(cat "$HOME_DIR/version" 2>/dev/null || echo none)^{commit}" || true)
  if [ "$want" = "$have" ]; then
    echo "up to date"
    exit 0
  fi
  # A commit whose build or tests failed isn't retried every 15 minutes; a newer commit is.
  if [ "$(cat "$HOME_DIR/failed" 2>/dev/null)" = "$want" ]; then
    echo "$want failed to build before; waiting for a newer commit"
    exit 0
  fi
  n=$(games)
  if [ -n "$n" ] && [ "$n" != 0 ]; then
    echo "$n game(s) in progress; deploying later"
    exit 0
  fi
  status=0
  REF=$want IF_IDLE=1 "$0" deploy || status=$?
  case $status in
    0) rm -f "$HOME_DIR/failed" ;;
    3) ;; # a game started during the build
    *) echo "$want" > "$HOME_DIR/failed"; echo "deploy failed ($status); see $HOME_DIR/build.log" ;;
  esac
  exit 0
  ;;
auto-on)
  mkdir -p "$HOME_DIR" "$HOME/Library/LaunchAgents" "$LOGS"
  [ -s "$HOME_DIR/game-service.sh" ] || cp "$0" "$HOME_DIR/game-service.sh"
  cat > "$HOME/Library/LaunchAgents/$AUTO.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$AUTO</string>
  <key>ProgramArguments</key><array><string>/bin/sh</string><string>$HOME_DIR/game-service.sh</string><string>auto-deploy</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>REPO</key><string>$REPO</string>
    <key>JAVA_HOME</key><string>$JAVA_HOME</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/commandquest-autodeploy.log</string>
  <key>StandardErrorPath</key><string>$LOGS/commandquest-autodeploy.log</string>
</dict>
</plist>
PLIST
  stop "$AUTO"
  launchctl bootstrap "$DOMAIN" "$HOME/Library/LaunchAgents/$AUTO.plist"
  echo "Auto-deploy is on: every 15 minutes, a new origin/web is deployed when no game is running."
  echo "Log: $LOGS/commandquest-autodeploy.log"
  ;;
auto-off)
  remove "$AUTO"
  echo "Auto-deploy is off."
  ;;
uninstall)
  remove "$AUTO"
  remove "$SERVER"
  remove "$TUNNEL"
  echo "Removed the services. The build and token stay in $HOME_DIR."
  ;;
*)
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
