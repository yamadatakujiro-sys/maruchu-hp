#!/bin/bash
# 自動起動用（Macのログイン時に launchd から呼ばれる）。最新版に更新してからサーバーを起動する。
BRANCH="claude/optimistic-ritchie-17e5z3"
cd "$(dirname "$0")/.." || exit 1
ROOT="$(cd .. && pwd)"
if [ -f "$ROOT/.lucent-app" ]; then
  # 専用フォルダ（~/LucentApp）なら、請求書管理のブランチの最新版にそろえる
  # （他の作業でブランチを切り替えても、このフォルダは影響を受けない）
  git -C "$ROOT" fetch -q origin "$BRANCH" 2>/dev/null && git -C "$ROOT" checkout -q --detach FETCH_HEAD 2>/dev/null
else
  git -C "$ROOT" pull --ff-only -q 2>/dev/null
fi
export LUCENT_NO_BROWSER=1
exec python3 tools/server.py
