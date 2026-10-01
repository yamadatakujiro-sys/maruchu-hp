#!/bin/bash
# 自動起動をやめる（使うときは「Lucent請求書.command」をダブルクリック）
PLIST="$HOME/Library/LaunchAgents/com.lucent.invoice.plist"
launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"
echo "自動起動をオフにしました。このウィンドウは閉じてOKです。"
