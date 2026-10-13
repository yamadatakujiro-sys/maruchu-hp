#!/bin/bash
# Lucent 請求書管理を専用フォルダ（~/LucentApp）に入れて、Mac起動時に自動で動くようにする（1回だけダブルクリック）
cd "$(dirname "$0")" || exit 1
LUCENT_REPO="$(cd .. && pwd)" bash tools/install.sh
echo ""
echo "このウィンドウは閉じてOKです。"
