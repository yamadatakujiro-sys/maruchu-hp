#!/bin/bash
# =============================================================
#  LINE AIオフィス — tunnel-run（cloudflaredトンネルの常駐ラッパ）
#
#  launchd から keepalive で起動され、$TUNNEL_CMD を exec するだけの薄いラッパ。
#  プロセスが落ちる／Macが再起動すると launchd が自動で再起動するため、
#  「LINEに送っても無反応（＝トンネル切れ）」の恒久対策になる。
#
#  環境変数（install.sh が plist に流し込む）:
#    TUNNEL_CMD … トンネル起動コマンド（例: cloudflared tunnel run my-office）
#  設定元は config/office.conf の TUNNEL_CMD。
# =============================================================
set -eu

if [ -z "${TUNNEL_CMD:-}" ]; then
  echo "[tunnel-run] TUNNEL_CMD が未設定です。office.conf を確認してください。" >&2
  exit 1
fi

echo "[tunnel-run] $(date '+%Y-%m-%d %H:%M:%S') 起動: $TUNNEL_CMD"
# TUNNEL_CMD は複数語（例: cloudflared tunnel run my-office）なので、あえて単語分割して実行する。
# 値は office.conf 由来の信頼できる設定のため、意図的に非クオートで展開している。
# shellcheck disable=SC2086
exec $TUNNEL_CMD
