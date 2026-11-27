#!/bin/sh
# Runs the game servers on this Mac for the real sites, through one Cloudflare Tunnel. See docs/game-host.md.
# Two servers, picked with SITE (default staging):
#   SITE=staging  builds `web`,  port 8090, https://game-staging.commandquest.app, for staging.commandquest.app
#   SITE=live     builds `live`, port 8091, https://game.commandquest.app,         for commandquest.app
#
#   forge-web-server/scripts/game-service.sh set-token       save the tunnel token (paste it, then Ctrl-D)
#   forge-web-server/scripts/game-service.sh deploy          build the pushed branch, install it, (re)start
#   forge-web-server/scripts/game-service.sh status          services, version running, health check
#   forge-web-server/scripts/game-service.sh logs            follow the server and tunnel logs
#   forge-web-server/scripts/game-service.sh restart         restart the server
#   forge-web-server/scripts/game-service.sh restart-tunnel  restart the tunnel (drops both servers' games)
#   forge-web-server/scripts/game-service.sh uninstall       stop and remove the server (and the tunnel, if it's the last)
#   forge-web-server/scripts/game-service.sh auto-on         every 15 min, deploy a newer branch when no game is running
#   forge-web-server/scripts/game-service.sh auto-off        stop doing that
#
# e.g. `SITE=live forge-web-server/scripts/game-service.sh status`.
# `deploy` builds a commit, not this working tree: it checks out REF (default the pushed branch) in its
# own worktree, so switching branches here never changes what players are on. Separate from the dev
# service (web/scripts/dev-service.sh), which uses port 8080.
set -eu

SITE=${SITE:-staging}
case "$SITE" in
staging)
  BRANCH=web PORT=${PORT:-8090} SUFFIX=
  PUBLIC=https://game-staging.commandquest.app
  ORIGINS=${ALLOWED_ORIGINS:-https://staging.commandquest.app}
  ISSUERS=${CONVEX_ISSUERS:-https://robust-barracuda-45.convex.site}
  ;;
live)
  BRANCH=live PORT=${PORT:-8091} SUFFIX=-live
  PUBLIC=https://game.commandquest.app
  ORIGINS=${ALLOWED_ORIGINS:-https://commandquest.app}
  ISSUERS=${CONVEX_ISSUERS:-https://impressive-manatee-540.convex.site}
  ;;
*) echo "SITE must be staging or live, not $SITE" >&2; exit 1 ;;
esac
# The pushed branch by default: a local branch can lag behind when another worktree has it checked out.
REF=${REF:-origin/$BRANCH}
HOME_DIR="$HOME/.commandquest/game$SUFFIX"
SRC="$HOME_DIR/src"
JAR="$HOME_DIR/forge-web-server.jar"
# Shared by both servers, in the staging server's folder (where they were before there were two).
SHARED="$HOME/.commandquest/game"
TOKEN="$SHARED/tunnel-token"
# The secret Convex accepts replay uploads with (docs/replays.md); the server reads it from this file.
REPLAY_SECRET_FILE="$SHARED/replay-secret"
LOGS="$HOME/Library/Logs"
# The auto-deploy job runs a copy of this script from $HOME_DIR, so it passes REPO explicitly.
REPO=${REPO:-$(cd "$(dirname "$0")/../.." && pwd)}
JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}
CLOUDFLARED=$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)
DOMAIN="gui/$(id -u)"
SERVER=com.commandquest.game$SUFFIX
TUNNEL=com.commandquest.tunnel
AUTO=com.commandquest.autodeploy$SUFFIX
OTHER_SERVER=com.commandquest.game$([ "$SITE" = live ] || echo -live)
GAME_LOG="$LOGS/commandquest-game$SUFFIX.log"

loaded() { launchctl print "$DOMAIN/$1" > /dev/null 2>&1; }

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
    <key>CONVEX_ISSUERS</key><string>$ISSUERS</string>
    <key>GIT_SHA</key><string>$(cat "$HOME_DIR/version" 2>/dev/null || echo unknown)</string>
    <key>REPLAY_SECRET_FILE</key><string>$REPLAY_SECRET_FILE</string>
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
  while loaded "$1" && [ $i -lt 50 ]; do
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
  mkdir -p "$SHARED"
  umask 077
  echo "Paste the tunnel token, then press Ctrl-D:" >&2
  tr -d ' \r\n' > "$TOKEN"
  [ -s "$TOKEN" ] || { rm -f "$TOKEN"; echo "No token given." >&2; exit 1; }
  echo "Saved to $TOKEN. Run deploy (or restart) to start the tunnel." >&2
  ;;
deploy)
  mkdir -p "$HOME_DIR"
  [ "$REF" = "origin/$BRANCH" ] && git -C "$REPO" fetch -q origin "$BRANCH"
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
  plist "$SERVER" "$GAME_LOG" "$JAVA_HOME/bin/java" -jar "$JAR"
  # The tunnel carries both servers, so a deploy only starts it if it isn't running: restarting it
  # would drop the other server's games too.
  if [ -s "$TOKEN" ]; then
    loaded "$TUNNEL" || plist "$TUNNEL" "$LOGS/commandquest-tunnel.log" "$CLOUDFLARED" tunnel --no-autoupdate run --token-file "$TOKEN"
  else
    echo "No tunnel token yet (set-token), so the server is only on localhost:$PORT." >&2
  fi
  "$0" status
  ;;
restart)
  launchctl kickstart -k "$DOMAIN/$SERVER"
  ;;
restart-tunnel)
  launchctl kickstart -k "$DOMAIN/$TUNNEL"
  ;;
status)
  for l in "$SERVER" "$TUNNEL" "$AUTO"; do
    printf '%s: ' "$l"
    launchctl print "$DOMAIN/$l" 2>/dev/null | awk '/^\tstate =/ {s=substr($0, index($0, "=") + 2)} /^\tpid =/ {p=$3} END {print (s ? s : "not installed") (p ? " (pid " p ")" : "")}'
  done
  echo "site:   $SITE (builds $BRANCH, port $PORT)"
  echo "built:  $(cat "$HOME_DIR/version" 2>/dev/null || echo never)"
  sleep 1
  printf 'local:  '; curl -fsS "http://127.0.0.1:$PORT/health" || echo "not answering"; echo
  printf 'public: '; curl -fsS -m 10 "$PUBLIC/health" || echo "not answering ($PUBLIC)"; echo
  ;;
logs)
  tail -n 50 -f "$GAME_LOG" "$LOGS/commandquest-tunnel.log"
  ;;
auto-deploy)
  # Run by launchd (auto-on). Deploys origin/$BRANCH when it has moved past what's running, and only
  # while no game is in progress, so nobody's game is cut off by the restart.
  echo "$(date '+%F %T') checking"
  git -C "$REPO" fetch -q origin "$BRANCH"
  want=$(git -C "$REPO" rev-parse "origin/$BRANCH")
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
    <key>SITE</key><string>$SITE</string>
    <key>REPO</key><string>$REPO</string>
    <key>JAVA_HOME</key><string>$JAVA_HOME</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartInterval</key><integer>900</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOGS/commandquest-autodeploy$SUFFIX.log</string>
  <key>StandardErrorPath</key><string>$LOGS/commandquest-autodeploy$SUFFIX.log</string>
</dict>
</plist>
PLIST
  stop "$AUTO"
  launchctl bootstrap "$DOMAIN" "$HOME/Library/LaunchAgents/$AUTO.plist"
  echo "Auto-deploy is on: every 15 minutes, a new origin/$BRANCH is deployed when no game is running."
  echo "Log: $LOGS/commandquest-autodeploy$SUFFIX.log"
  ;;
auto-off)
  remove "$AUTO"
  echo "Auto-deploy is off."
  ;;
uninstall)
  remove "$AUTO"
  remove "$SERVER"
  if loaded "$OTHER_SERVER"; then
    echo "Removed the $SITE server. The tunnel stays for the other one."
  else
    remove "$TUNNEL"
    echo "Removed the $SITE server and the tunnel."
  fi
  echo "The build stays in $HOME_DIR, the token in $SHARED."
  ;;
*)
  sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
  ;;
esac
