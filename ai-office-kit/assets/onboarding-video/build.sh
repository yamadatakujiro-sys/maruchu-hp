#!/bin/bash
# 使い方動画（字幕版）を書き出す
# 実行： bash build.sh              … 無音で書き出す
#        bash build.sh bgm.mp3      … BGMを付けて書き出す
# 前提： NODE_PATH="$(npm root -g)" node render.cjs でPNGを作ってから
#
# ⚠️ BGMは YouTube Studio の「オーディオ ライブラリ」からDLしたものを使う。
#    「帰属表示が必要」な曲は避ける（納品物として顧客に配るため）。
set -e
cd "$(dirname "$0")"

BGM="$1"                # BGMファイル（省略可）
# BGMの音量は「LUFS」で指定する。曲によって元の音量がバラバラなため、
# 倍率（volume=0.08 等）で指定すると曲を替えた時に音量が狂う。ここは自動で揃える方式にした。
#   -18 ＝ この動画（ナレーション無し）でちょうどよい背景音量
#   -30 ＝ あとからナレーションを乗せる場合はここまで下げる
BGM_LOUDNESS=-18
FADE_IN=2               # フェードイン（秒）
FADE_OUT=3              # フェードアウト（秒）

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

# 動画の総再生時間（フェードアウトの開始位置に使う）
TOTAL=0
for d in "${DUR[@]}"; do TOTAL=$((TOTAL + d)); done
FADE_START=$((TOTAL - FADE_OUT))

if [ -n "$BGM" ] && [ -f "$BGM" ]; then
  echo "BGMを合成します： $BGM （音量 ${BGM_LOUDNESS} LUFS）"
  # BGMが動画より短い場合はループさせる（-stream_loop -1）
  ffmpeg -y -loglevel error \
    -f concat -safe 0 -i "$LIST" \
    -stream_loop -1 -i "$BGM" \
    -vf "fps=30,format=yuv420p" \
    -af "loudnorm=I=${BGM_LOUDNESS}:TP=-2.0,afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${FADE_START}:d=${FADE_OUT}" \
    -c:v libx264 -preset medium -crf 20 \
    -c:a aac -b:a 128k -shortest \
    -movflags +faststart \
    使い方ガイド.mp4
else
  # 無音の音声トラックを付ける（付けないと再生できないプレイヤーがあるため）
  ffmpeg -y -loglevel error \
    -f concat -safe 0 -i "$LIST" \
    -f lavfi -i anullsrc=r=48000:cl=stereo \
    -vf "fps=30,format=yuv420p" \
    -c:v libx264 -preset medium -crf 20 \
    -c:a aac -b:a 96k -shortest \
    -movflags +faststart \
    使い方ガイド.mp4
fi

rm -f "$LIST"
echo "---"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 使い方ガイド.mp4
echo "できました： 使い方ガイド.mp4"
