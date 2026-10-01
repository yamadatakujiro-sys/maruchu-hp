#!/bin/bash
# 自動起動用（Macのログイン時に launchd から呼ばれる）。最新版に更新してからサーバーを起動する。
cd "$(dirname "$0")/.." || exit 1
git -C .. pull --ff-only -q 2>/dev/null
export LUCENT_NO_BROWSER=1
exec python3 tools/server.py
