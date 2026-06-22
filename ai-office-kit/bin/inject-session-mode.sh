#!/bin/bash
# =============================================================
#  LINE AIオフィス — inject-session-mode（共通層の一括注入）
#
#  全社員の CLAUDE.md に共通層（SESSION-MODE-TEMPLATE）を追記する。
#  既に追記済みならスキップ（冪等）。install.sh が組み立て済みでも、
#  後からテンプレを更新した際の再注入ツールとして使える。
#
#  プレースホルダは install.sh と統一：
#    {{MEMBER_NAME}} … 表示名 / {{MEMBER_DIR}} … 社員dir / {{OFFICE_HOME}} … 基準パス
#
#  設定はすべて環境変数で受け取る（install.sh が office.conf から流し込む）：
#    OFFICE_HOME   … オフィス本体の基準パス（必須）
#    COMMON_LAYER  … 共通層テンプレのパス（既定 $OFFICE_HOME/templates/SESSION-MODE-TEMPLATE.md）
# =============================================================
set -euo pipefail

: "${OFFICE_HOME:?OFFICE_HOME が未設定です（office.conf を確認）}"
COMMON_LAYER="${COMMON_LAYER:-$OFFICE_HOME/templates/SESSION-MODE-TEMPLATE.md}"
MANIFEST="$OFFICE_HOME/office-members.json"
MARKER="動作モード（全社員共通"

if [ ! -f "$COMMON_LAYER" ]; then
  echo "ERROR: 共通層テンプレが見つかりません: $COMMON_LAYER"
  exit 1
fi

# 社員一覧（dir<TAB>表示名）を取得：マニフェスト優先・無ければ members/ 走査
if [ -f "$MANIFEST" ] && command -v jq >/dev/null 2>&1; then
  MEMBERS_TSV=$(jq -r '.members[] | "\(.dir)\t\(.name // .dir)"' "$MANIFEST")
else
  MEMBERS_TSV=""
  for d in "$OFFICE_HOME"/members/*/; do
    [ -d "$d" ] || continue
    dir=$(basename "$d")
    MEMBERS_TSV+="$dir	$dir"$'\n'
  done
fi

while IFS=$'\t' read -r DIR NAME; do
  [ -n "$DIR" ] || continue
  CLAUDE_MD="$OFFICE_HOME/members/$DIR/CLAUDE.md"
  if [ ! -f "$CLAUDE_MD" ]; then
    echo "  - $DIR : CLAUDE.md がない → スキップ"
    continue
  fi
  if grep -q "$MARKER" "$CLAUDE_MD"; then
    echo "  - $DIR : 既に追記済み → スキップ"
    continue
  fi
  printf "\n\n" >> "$CLAUDE_MD"
  sed \
    -e "s|{{MEMBER_NAME}}|$NAME|g" \
    -e "s|{{MEMBER_DIR}}|$DIR|g" \
    -e "s|{{OFFICE_HOME}}|$OFFICE_HOME|g" \
    "$COMMON_LAYER" >> "$CLAUDE_MD"
  echo "  ✓ $DIR（$NAME）: 共通層を追記しました"
done <<< "$MEMBERS_TSV"

echo ""
echo "完了。以下で確認できます："
echo "  grep -l '$MARKER' $OFFICE_HOME/members/*/CLAUDE.md"
