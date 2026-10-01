#!/bin/bash
# Lucent 請求書管理を起動する（ダブルクリックで開く）
cd "$(dirname "$0")" || exit 1
# 最新版に更新（失敗しても起動は続ける）
git -C .. pull --ff-only -q 2>/dev/null && echo "最新版に更新しました"
exec python3 tools/server.py
