#!/bin/bash
# Lucent 請求書管理を開く（ダブルクリック）
cd "$(dirname "$0")" || exit 1
if [ -f "$HOME/LucentApp/.lucent-app" ]; then
  # 専用フォルダに入れてあれば、そちらで自動起動しているのでブラウザを開くだけ
  open "http://localhost:8787/"
  exit 0
fi
git -C .. pull --ff-only -q 2>/dev/null && echo "最新版に更新しました"
exec python3 tools/server.py
