#!/bin/bash
# Lucent 請求書管理を「Macを起動したら自動で動く」ようにする（1回だけダブルクリック）
DIR="$(cd "$(dirname "$0")" && pwd)"
PLIST="$HOME/Library/LaunchAgents/com.lucent.invoice.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.lucent-invoice"
chmod +x "$DIR/tools/start.sh"

# すでに手動で起動していたら止める（自動起動に切り替えるため）
PID=$(lsof -ti tcp:8787 -sTCP:LISTEN 2>/dev/null)
[ -n "$PID" ] && kill $PID 2>/dev/null && sleep 1

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.lucent.invoice</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-lc</string><string>"$DIR/tools/start.sh"</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.lucent-invoice/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.lucent-invoice/server.log</string>
</dict>
</plist>
PL

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST"
sleep 2
if lsof -ti tcp:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "✅ 自動起動をオンにしました。"
  echo "   これからは Mac を起動するだけで http://localhost:8787 が使えます。"
  echo "   ブラウザのブックマークから開いてください。"
  open "http://localhost:8787/"
else
  echo "⚠ 起動を確認できませんでした。~/.lucent-invoice/server.log を確認してください。"
fi
echo ""
echo "このウィンドウは閉じてOKです。"
