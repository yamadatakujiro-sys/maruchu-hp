#!/bin/bash
# HTMLで使う文字だけを Google Fonts から切り出して fonts/ に保存する
# 文言を変えたら再実行する： bash fetch-fonts.sh（＝buy-parts.html）
#   別のHTML： bash fetch-fonts.sh arrival.html → fonts/zkg-700-arrival.ttf 等（名前にHTML名が付く）
set -e
cd "$(dirname "$0")"
mkdir -p fonts
HTML=${1:-buy-parts.html}
# buy-parts.html 以外はフォント名にHTML名を付けて、既存のフォントを上書きしない
SUF=""; [ "$HTML" != "buy-parts.html" ] && SUF="-${HTML%.html}"
# HTMLのタグを除いた本文の文字を集める（英字は大文字・小文字の両方を入れる）
TEXT=$(sed -e 's/<[^>]*>//g' "$HTML" | grep -v '^\s*$' | tr -d '\n' | python3 -c "import sys,urllib.parse;s=sys.stdin.read();s+=s.upper()+s.lower();print(urllib.parse.quote(''.join(sorted(set(s)))))")
get(){ # $1=family(:wght付き可) $2=出力名
  url=$(curl -sS "https://fonts.googleapis.com/css2?family=$1&text=$TEXT" | grep -o 'https://[^)]*' | head -1)
  curl -sS -o "fonts/$2" "$url"; echo "fonts/$2"
}
get "Zen+Kaku+Gothic+New:wght@700" "zkg-700$SUF.ttf"
get "Anton" "anton$SUF.ttf"
