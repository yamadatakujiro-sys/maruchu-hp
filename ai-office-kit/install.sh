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
BIN_DIR="$KIT_DIR/bin"
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
[ -d "$BIN_DIR" ] || die "bin/ が見つかりません: $BIN_DIR"
# リーダーの社員ID（MEMBERS 先頭の dir フィールド）を確定
# ※ macOS の bash 3.2 でも確実に動くようパラメータ展開で切り出す
LEADER_ID="${MEMBERS[0]%%:*}"
ok "事前チェック完了（leader=$LEADER_ID）"

# --- 3. フォルダ構成の作成 -----------------------------------
log "フォルダ構成を作成: $OFFICE_HOME"
mkdir -p "$OFFICE_HOME/members" "$OFFICE_HOME/logs"
ok "members/ logs/ を用意"

# --- 4. 社員の組み立て（このキットの中核）--------------------
#   各社員 = 役割層(roles/<tpl>) + 共通層(SESSION-MODE-TEMPLATE)
log "社員を組み立て（役割層 → 共通層 の順で CLAUDE.md を生成）"
for entry in "${MEMBERS[@]}"; do
  dir="${entry%%:*}"; rest="${entry#*:}"; disp="${rest%%:*}"; tpl="${rest#*:}"
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

# --- 4.5 社員マニフェスト生成（bin/フックが表示名解決に使う）------
log "社員マニフェストを生成: office-members.json"
if command -v jq >/dev/null 2>&1; then
  members_json="$(
    for entry in "${MEMBERS[@]}"; do
      dir="${entry%%:*}"; rest="${entry#*:}"; disp="${rest%%:*}"; tpl="${rest#*:}"
      jq -n --arg dir "$dir" --arg name "$disp" '{dir:$dir, name:$name}'
    done | jq -s '.'
  )"
  jq -n --arg leader "$LEADER_ID" --argjson members "$members_json" \
    '{leaderId:$leader, members:$members}' > "$OFFICE_HOME/office-members.json"
  ok "office-members.json（leader=$LEADER_ID, ${#MEMBERS[@]}名）"
else
  err "jq が無いため office-members.json を生成できません（フックの表示名解決はフォルダ名にフォールバック）"
fi

# --- 5. 部品配置（キットの bin/ → $OFFICE_HOME/bin/）----------
log "7部品と共通層テンプレを配置: $OFFICE_HOME/bin, $OFFICE_HOME/templates"
mkdir -p "$OFFICE_HOME/bin" "$OFFICE_HOME/templates"
cp "$BIN_DIR"/office-bridge.mjs "$BIN_DIR"/spawn-watcher.mjs "$BIN_DIR"/leader-poll.sh \
   "$BIN_DIR"/watchdog.sh "$BIN_DIR"/session-start-hook.sh "$BIN_DIR"/cwd-changed-hook.sh \
   "$BIN_DIR"/inject-session-mode.sh "$OFFICE_HOME/bin/"
chmod +x "$OFFICE_HOME"/bin/*.sh
cp "$COMMON_LAYER" "$OFFICE_HOME/templates/"
ok "bin/（7部品）と templates/SESSION-MODE-TEMPLATE.md を配置"

# 各部品へ流し込む共通の環境変数（office.conf 由来）
read -r -d '' COMMON_ENV <<EOF || true
OFFICE_HOME='$OFFICE_HOME' CLAUDE_BIN='$CLAUDE_BIN' MCP_NAME='$MCP_NAME' LEADER_ID='$LEADER_ID' OWNER_FRIEND_ID='$OWNER_FRIEND_ID'
EOF

# --- 6. launchd 常駐登録（bridge / watcher / leader-poll）-----
LA_DIR="$HOME/Library/LaunchAgents"
if command -v launchctl >/dev/null 2>&1; then
  log "launchd 常駐を登録（bridge / watcher / leader-poll）"
  mkdir -p "$LA_DIR"
  NODE_BIN="$(command -v node)"
  BIN_PATH_DIR="$(dirname "$CLAUDE_BIN")"

  # plist を1本生成して load し直すヘルパ
  #   $1=ラベル接尾 $2=ProgramArguments(XML断片) $3=常駐方式(keepalive|interval)
  register_agent() {
    local suffix="$1" prog_xml="$2" mode="$3"
    local label="com.lineaioffice.$suffix"
    local plist="$LA_DIR/$label.plist"
    local run_xml
    if [ "$mode" = "interval" ]; then
      run_xml="    <key>StartInterval</key><integer>30</integer>"
    else
      run_xml="    <key>KeepAlive</key><true/>
    <key>RunAtLoad</key><true/>"
    fi
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$label</string>
    <key>ProgramArguments</key>
    <array>
$prog_xml
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>OFFICE_HOME</key><string>$OFFICE_HOME</string>
        <key>CLAUDE_BIN</key><string>$CLAUDE_BIN</string>
        <key>MCP_NAME</key><string>$MCP_NAME</string>
        <key>LEADER_ID</key><string>$LEADER_ID</string>
        <key>OWNER_FRIEND_ID</key><string>$OWNER_FRIEND_ID</string>
        <key>PORT</key><string>$PORT</string>
        <key>POLL_MS</key><string>$POLL_MS</string>
        <key>MAX_CONCURRENT</key><string>$MAX_CONCURRENT</string>
        <key>THRESHOLD_MIN</key><string>$THRESHOLD_MIN</string>
        <key>PATH</key><string>$BIN_PATH_DIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
$run_xml
    <key>StandardOutPath</key><string>$OFFICE_HOME/logs/$suffix.log</string>
    <key>StandardErrorPath</key><string>$OFFICE_HOME/logs/$suffix.err.log</string>
</dict>
</plist>
PLIST
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
    ok "launchd: $label"
  }

  register_agent "bridge" \
"        <string>$NODE_BIN</string>
        <string>$OFFICE_HOME/bin/office-bridge.mjs</string>" keepalive
  register_agent "watcher" \
"        <string>$NODE_BIN</string>
        <string>$OFFICE_HOME/bin/spawn-watcher.mjs</string>" keepalive
  register_agent "leaderpoll" \
"        <string>/bin/bash</string>
        <string>$OFFICE_HOME/bin/leader-poll.sh</string>" interval
else
  err "launchctl が無いため常駐登録をスキップ（macOS以外。Macで再実行すると登録されます）"
fi

# --- 7. Claude Code フック登録（settings.json へ jq マージ）----
SETTINGS="$HOME/.claude/settings.json"
if command -v jq >/dev/null 2>&1; then
  log "settings.json にフックを登録（SessionStart / CwdChanged）"
  mkdir -p "$HOME/.claude"
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  SS_CMD="$COMMON_ENV /bin/bash '$OFFICE_HOME/bin/session-start-hook.sh'"
  CC_CMD="$COMMON_ENV /bin/bash '$OFFICE_HOME/bin/cwd-changed-hook.sh'"
  tmp="$(mktemp)"
  # 既存の当キット由来エントリ（スクリプト名で判定）を除去してから追記＝冪等
  jq --arg ss "$SS_CMD" --arg cc "$CC_CMD" \
     --arg ssp "session-start-hook.sh" --arg ccp "cwd-changed-hook.sh" '
    .hooks = (.hooks // {})
    | .hooks.SessionStart = (((.hooks.SessionStart // [])
        | map(select(any(.hooks[]?; (.command // "") | contains($ssp)) | not)))
        + [{hooks:[{type:"command", command:$ss}]}])
    | .hooks.CwdChanged = (((.hooks.CwdChanged // [])
        | map(select(any(.hooks[]?; (.command // "") | contains($ccp)) | not)))
        + [{hooks:[{type:"command", command:$cc}]}])
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  ok "settings.json 更新（既存設定は保持）"
else
  err "jq が無いためフック登録をスキップ（jq を入れて再実行してください）"
fi

# --- 8. 自己テスト ------------------------------------------
log "自己テスト（組み立て結果の検証）"
fail=0
for entry in "${MEMBERS[@]}"; do
  dir="${entry%%:*}"; rest="${entry#*:}"; disp="${rest%%:*}"; tpl="${rest#*:}"
  f="$OFFICE_HOME/members/$dir/CLAUDE.md"
  if [ -s "$f" ] && grep -q "動作モード（全社員共通" "$f"; then
    ok "$disp: CLAUDE.md 生成OK（役割層＋共通層）"
  else
    err "$disp: CLAUDE.md の生成に問題あり ($f)"; fail=1
  fi
done
# 部品が配置されているか
for b in office-bridge.mjs spawn-watcher.mjs leader-poll.sh watchdog.sh \
         session-start-hook.sh cwd-changed-hook.sh inject-session-mode.sh; do
  [ -s "$OFFICE_HOME/bin/$b" ] || { err "部品が未配置: bin/$b"; fail=1; }
done
# ブリッジ稼働確認（launchd 登録時のみ。起動の猶予を見て health を叩く）
if command -v launchctl >/dev/null 2>&1 && command -v curl >/dev/null 2>&1; then
  sleep 2
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
    ok "bridge /health 応答OK（:$PORT）"
  else
    err "bridge /health 無応答（:$PORT）。logs/bridge.err.log を確認してください"; fail=1
  fi
fi

[ "$fail" -eq 0 ] || die "自己テストで問題を検出しました"

log "完了。組み立て済み社員数: ${#MEMBERS[@]}（leader=$LEADER_ID）"
log "常駐確認: launchctl list | grep com.lineaioffice"
