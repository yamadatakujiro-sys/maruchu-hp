#!/usr/bin/env bash
# =============================================================
#  LINE AIオフィス インストーラ（install.sh）
#  config/office.conf を読み、全社員を組み立てて常駐させる。
#
#  使い方:  ./install.sh
#  前提  :  キット一式と同じ階層に config/office.conf があること
# =============================================================
set -euo pipefail

# --- 0. キット自身の場所を特定 -------------------------------
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="$KIT_DIR/config/office.conf"
ROLES_DIR="$KIT_DIR/roles"
TEMPLATES_DIR="$KIT_DIR/templates"
COMMON_LAYER="$TEMPLATES_DIR/SESSION-MODE-TEMPLATE.md"

log()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

# --- 1. 設定読み込み -----------------------------------------
[ -f "$CONF" ] || die "設定ファイルが見つかりません: $CONF"
# shellcheck source=/dev/null
source "$CONF"
log "設定を読み込みました: $CONF"

# --- 2. 事前チェック -----------------------------------------
log "事前チェック"
[ -n "${OFFICE_HOME:-}" ] || die "OFFICE_HOME が未設定です"
[ -x "${CLAUDE_BIN:-}" ]  || die "CLAUDE_BIN が実行可能ではありません: ${CLAUDE_BIN:-(未設定)}  → 'which claude' で確認"
command -v node >/dev/null 2>&1 || die "node が見つかりません"
[ "${#MEMBERS[@]}" -gt 0 ]   || die "MEMBERS が空です"
[ -f "$COMMON_LAYER" ]       || die "共通層テンプレが見つかりません: $COMMON_LAYER"
[[ "${MEMBERS[0]}" == member-leader:* ]] || err "警告: MEMBERS の先頭が leader ではありません（推奨: 先頭に leader）"
ok "事前チェック完了"

# --- 3. フォルダ構成の作成 -----------------------------------
log "フォルダ構成を作成: $OFFICE_HOME"
mkdir -p "$OFFICE_HOME/members" "$OFFICE_HOME/logs"
ok "members/ logs/ を用意"

# --- 4. 社員の組み立て（このキットの中核）--------------------
#   各社員 = 役割層(roles/<tpl>) + 共通層(SESSION-MODE-TEMPLATE)
log "社員を組み立て（役割層 → 共通層 の順で CLAUDE.md を生成）"
for entry in "${MEMBERS[@]}"; do
  IFS=':' read -r dir disp tpl <<< "$entry"
  [ -n "$dir" ] && [ -n "$disp" ] && [ -n "$tpl" ] || die "MEMBERS の書式が不正: '$entry' （正: dir:表示名:tpl.md）"

  role_src="$ROLES_DIR/$tpl"
  [ -f "$role_src" ] || die "役割テンプレが見つかりません: $role_src"

  member_dir="$OFFICE_HOME/members/$dir"
  mkdir -p "$member_dir/inbox"
  claude_md="$member_dir/CLAUDE.md"

  # 4-1. 役割層を配置
  cat "$role_src" > "$claude_md"

  # 4-2. 共通層を追記（プレースホルダを当該社員の値で置換）
  sed \
    -e "s|{{MEMBER_NAME}}|$disp|g" \
    -e "s|{{MEMBER_DIR}}|$dir|g" \
    -e "s|{{OFFICE_HOME}}|$OFFICE_HOME|g" \
    "$COMMON_LAYER" >> "$claude_md"

  ok "$disp（$dir） ← $tpl + 共通層"
done

# --- 5. 部品配置（実ソースはMac上。実装フェーズで埋める）-----
# TODO(実ソース提供後): キットの bin/ から下記7部品を $OFFICE_HOME へ配置し実行権限付与
#   - office-bridge.mjs   (旧 line-bridge/server.mjs)         : LINE push 受信→spawn
#   - spawn-watcher.mjs   (旧 scripts/auto-spawn-watcher.mjs) : task.md 監視→spawn
#   - leader-poll.sh      (旧 scripts/leader-poll.sh)         : 受付係
#   - watchdog.sh         (旧 scripts/watchdog.sh)            : 死活監視
#   - session-start-hook.sh / cwd-changed-hook.sh             : フック2種
#   - inject-session-mode.sh                                  : ルール一括注入
# これらは PORT/POLL_MS/MAX_CONCURRENT/THRESHOLD_MIN/OWNER_FRIEND_ID/MCP_NAME を
# 環境変数 or 引数で受け取る形にリファクタ済みであること（office.conf から流し込む）。
log "（TODO）7部品の配置 — 実ソース提供後に実装"

# --- 6. launchd 常駐登録（3本）-------------------------------
# TODO(実ソース提供後): bridge / watcher / leader-poll の3本を
#   ~/Library/LaunchAgents/com.lineaioffice.*.plist として生成し launchctl load
log "（TODO）launchd 登録（bridge / watcher / leader-poll）— 実ソース提供後に実装"

# --- 7. Claude Code フック登録 -------------------------------
# TODO(実ソース提供後): ~/.claude/settings.json の hooks に
#   SessionStart → session-start-hook.sh / CwdChanged → cwd-changed-hook.sh を登録
#   （既存 settings.json を壊さないよう jq でマージ）
log "（TODO）settings.json へフック登録 — 実ソース提供後に実装"

# --- 8. 自己テスト（実装済み範囲）----------------------------
log "自己テスト（組み立て結果の検証）"
fail=0
for entry in "${MEMBERS[@]}"; do
  IFS=':' read -r dir disp tpl <<< "$entry"
  f="$OFFICE_HOME/members/$dir/CLAUDE.md"
  if [ -s "$f" ] && grep -q "動作モード（全社員共通" "$f"; then
    ok "$disp: CLAUDE.md 生成OK（役割層＋共通層）"
  else
    err "$disp: CLAUDE.md の生成に問題あり ($f)"; fail=1
  fi
done
# TODO(実ソース提供後): curl http://127.0.0.1:$PORT/health が ok を返すか確認

[ "$fail" -eq 0 ] || die "自己テストで問題を検出しました"

log "完了。組み立て済み社員数: ${#MEMBERS[@]}"
log "次のステップ: 7部品の配置と launchd/フック登録（実ソース提供後）"
