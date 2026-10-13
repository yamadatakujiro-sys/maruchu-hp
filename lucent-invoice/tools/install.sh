#!/bin/bash
# Lucent 請求書管理を専用フォルダ（~/LucentApp）に入れて、Mac起動時に自動で動くようにする。
# maruchu-hp フォルダで別のブランチに切り替えても、請求書管理が消えなくなる。
# データ（~/.lucent-invoice）はそのまま使う。
#   使い方：cd ~/maruchu-hp && git fetch origin claude/optimistic-ritchie-17e5z3 && git show FETCH_HEAD:lucent-invoice/tools/install.sh | bash
BRANCH="claude/optimistic-ritchie-17e5z3"
REPO="${LUCENT_REPO:-$HOME/maruchu-hp}"
APP="${LUCENT_APP:-$HOME/LucentApp}"
PLIST="$HOME/Library/LaunchAgents/com.lucent.invoice.plist"
set -e

echo "▶ 最新版を取得しています…"
git -C "$REPO" fetch -q origin "$BRANCH"
if [ -e "$APP/.git" ]; then
  git -C "$APP" fetch -q origin "$BRANCH"
  git -C "$APP" checkout -q --detach FETCH_HEAD
else
  git -C "$REPO" worktree prune
  git -C "$REPO" worktree add -q --detach "$APP" "origin/$BRANCH"
fi
touch "$APP/.lucent-app"
chmod +x "$APP/lucent-invoice/tools/start.sh"
echo "✅ $APP に入れました"

if ! command -v launchctl >/dev/null 2>&1; then
  echo "（launchctl が無い環境のため、自動起動の設定は省略しました）"
  exit 0
fi

echo "▶ 自動起動を設定しています…"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.lucent-invoice"
launchctl unload "$PLIST" 2>/dev/null || true
PID=$(lsof -ti tcp:8787 -sTCP:LISTEN 2>/dev/null || true)
[ -n "$PID" ] && kill $PID 2>/dev/null && sleep 1
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lucent.invoice</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string><string>"$APP/lucent-invoice/tools/start.sh"</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.lucent-invoice/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.lucent-invoice/server.log</string>
</dict>
</plist>
PL
launchctl load "$PLIST"
for i in 1 2 3 4 5 6 7 8 9 10; do
  lsof -ti tcp:8787 -sTCP:LISTEN >/dev/null 2>&1 && break
  sleep 1
done
if lsof -ti tcp:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 完了しました。これからはブックマーク（http://localhost:8787）から開けます。"
  open "http://localhost:8787/"
else
  echo "⚠ 起動を確認できませんでした。~/.lucent-invoice/server.log を確認してください。"
fi
