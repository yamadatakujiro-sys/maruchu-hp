#!/bin/bash
# 使い方動画（字幕版）を書き出す
# 実行： bash build.sh                       … 無音で書き出す
#        bash build.sh bgm.mp3               … BGMを付けて書き出す
#        bash build.sh "" 出力名.mp4         … 出力名を変える
# 前提： NODE_PATH="$(npm root -g)" node render.cjs でPNGを作ってから
#
# ⚠️ BGMは YouTube Studio の「オーディオ ライブラリ」からDLしたものを使う。
#    「帰属表示が必要」な曲は避ける（納品物として顧客に配るため）。
set -e
cd "$(dirname "$0")"

BGM="$1"                # BGMファイル（省略可）
OUT="${2:-使い方ガイド.mp4}"  # 出力ファイル名（省略可）
# BGMの音量は「LUFS」で指定する。曲によって元の音量がバラバラなため、
# 倍率（volume=0.08 等）で指定すると曲を替えた時に音量が狂う。ここは自動で揃える方式にした。
#   -18 ＝ この動画（ナレーション無し）でちょうどよい背景音量
#   -30 ＝ あとからナレーションを乗せる場合はここまで下げる
BGM_LOUDNESS=-18
FADE_IN=2               # フェードイン（秒）
FADE_OUT=3              # フェードアウト（秒）
XFADE=5                 # ループの継ぎ目をクロスフェードする秒数（曲が動画より短い時に使う）

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

  # --- ① 曲の末尾の無音を自動で切る -------------------------------------
  # 曲は最後に無音が付いていることが多い。そのままループすると
  # 「途中で数秒黙って、いきなり頭から鳴り出す」ので必ず切る。
  BGMDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$BGM")
  SIL=$(ffmpeg -i "$BGM" -af silencedetect=n=-40dB:d=0.5 -f null /dev/null 2>&1 \
        | grep -oE "silence_start: [0-9.]+" | tail -1 | grep -oE "[0-9.]+$" || true)
  BODY="$BGMDUR"
  if [ -n "$SIL" ]; then
    # 検出した無音が「末尾の無音」なら、そこを曲の終わりとして採用する
    BODY=$(python3 -c "d=$BGMDUR; s=$SIL; print(s if d - s < 10 else d)")
  fi
  echo "  曲の長さ ${BGMDUR}秒 → 実際に鳴っている部分 ${BODY}秒"

  # --- ② 動画の長さに足りなければクロスフェードでつないで伸ばす ---------
  BED=bgm-bed.wav
  NEED=$(python3 -c "
import math
body=$BODY; total=$TOTAL; x=$XFADE
if body >= total:
    print(1)
else:
    print(max(2, math.ceil((total - x) / (body - x))))")

  if [ "$NEED" -le 1 ]; then
    ffmpeg -y -loglevel error -t "$BODY" -i "$BGM" -c:a pcm_s16le "$BED"
  else
    echo "  曲が動画より短いので ${NEED}回つなぎます（継ぎ目は${XFADE}秒クロスフェード）"
    ARGS=(); FILTER=""; PREV="0:a"
    for n in $(seq 0 $((NEED - 1))); do
      ARGS+=(-t "$BODY" -i "$BGM")
    done
    for n in $(seq 1 $((NEED - 1))); do
      LBL="x$n"   # ※変数名は OUT と衝突させない（OUT は出力ファイル名）
      FILTER="${FILTER}[${PREV}][${n}:a]acrossfade=d=${XFADE}:c1=tri:c2=tri[${LBL}];"
      PREV="$LBL"
    done
    FILTER="${FILTER%;}"
    ffmpeg -y -loglevel error "${ARGS[@]}" \
      -filter_complex "$FILTER" -map "[$PREV]" -c:a pcm_s16le "$BED"
  fi

  # --- ③ 音量を揃えて、フェードを付けて動画に合成 -----------------------
  ffmpeg -y -loglevel error \
    -f concat -safe 0 -i "$LIST" \
    -i "$BED" \
    -vf "fps=30,format=yuv420p" \
    -af "loudnorm=I=${BGM_LOUDNESS}:TP=-2.0,afade=t=in:st=0:d=${FADE_IN},afade=t=out:st=${FADE_START}:d=${FADE_OUT}" \
    -c:v libx264 -preset medium -crf 20 \
    -c:a aac -b:a 160k -shortest \
    -movflags +faststart \
    "$OUT"
  rm -f "$BED"
else
  # 無音の音声トラックを付ける（付けないと再生できないプレイヤーがあるため）
  ffmpeg -y -loglevel error \
    -f concat -safe 0 -i "$LIST" \
    -f lavfi -i anullsrc=r=48000:cl=stereo \
    -vf "fps=30,format=yuv420p" \
    -c:v libx264 -preset medium -crf 20 \
    -c:a aac -b:a 96k -shortest \
    -movflags +faststart \
    "$OUT"
fi

rm -f "$LIST"
echo "---"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
echo "できました： $OUT"
