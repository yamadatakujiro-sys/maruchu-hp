#!/bin/bash
# 使い方動画（字幕版）を書き出す
# 実行： bash build.sh
# 前提： NODE_PATH="$(npm root -g)" node render.cjs でPNGを作ってから
set -e
cd "$(dirname "$0")"

# 各スライドの表示秒数（読む時間に合わせて設定）
# 文字が多いスライドは長く、見出しだけのスライドは短く
DUR=(7 16 5 16 24 5 14 20 5 16 18 18 18 22 20 24 10)

LIST=list.txt
: > "$LIST"
i=0
for f in slide-*.png; do
  echo "file '$f'" >> "$LIST"
  echo "duration ${DUR[$i]}" >> "$LIST"
  i=$((i+1))
done
# concat の仕様上、最後のファイルはもう一度書く
echo "file '$(ls slide-*.png | tail -1)'" >> "$LIST"

# 無音の音声トラックを付ける（付けないと再生できないプレイヤーがあるため）
ffmpeg -y -loglevel error \
  -f concat -safe 0 -i "$LIST" \
  -f lavfi -i anullsrc=r=48000:cl=stereo \
  -vf "fps=30,format=yuv420p" \
  -c:v libx264 -preset medium -crf 20 \
  -c:a aac -b:a 96k -shortest \
  -movflags +faststart \
  使い方ガイド.mp4

rm -f "$LIST"
echo "---"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 使い方ガイド.mp4
echo "できました： 使い方ガイド.mp4"
