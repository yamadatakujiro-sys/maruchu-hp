#!/bin/bash
# buy-parts.html で使う文字だけを Google Fonts から切り出して fonts/ に保存する
# 文言を変えたら再実行する： bash fetch-fonts.sh
set -e
cd "$(dirname "$0")"
mkdir -p fonts
# HTMLのタグを除いた本文の文字を集める
TEXT=$(sed -e 's/<[^>]*>//g' buy-parts.html | grep -v '^\s*$' | tr -d '\n' | python3 -c "import sys,urllib.parse;s=sys.stdin.read();print(urllib.parse.quote(''.join(sorted(set(s)))))")
get(){ # $1=family $2=weight $3=出力名
  url=$(curl -sS "https://fonts.googleapis.com/css2?family=$1:wght@$2&text=$TEXT" | grep -o 'https://[^)]*' | head -1)
  curl -sS -o "fonts/$3" "$url"; echo "fonts/$3"
}
get "Zen+Kaku+Gothic+New" 700 zkg-700.ttf
get "Zen+Kaku+Gothic+New" 900 zkg-900.ttf
get "Zen+Old+Mincho" 900 zom-900.ttf
