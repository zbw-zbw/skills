#!/usr/bin/env bash
# 用法: fetch_slides.sh <url清单文件(一行一个)> <输出目录>
# 并行下载抖音图文原图（带 Referer），webp→png（sips 优先、ffmpeg 兜底）。
set -euo pipefail
LIST="${1:?用法: fetch_slides.sh <url清单文件> <输出目录>}"
OUT="${2:?用法: fetch_slides.sh <url清单文件> <输出目录>}"
mkdir -p "$OUT"

i=1
pids=()
while IFS= read -r url; do
  [ -n "$url" ] || continue
  n=$(printf '%02d' "$i")
  curl -sL --fail -o "$OUT/slide_$n.webp" -H 'Referer: https://www.douyin.com/' "$url" &
  pids+=($!)
  i=$((i + 1))
done < "$LIST"
for p in "${pids[@]}"; do
  wait "$p" || echo "WARN: 下载任务 $p 失败" >&2
done

for f in "$OUT"/slide_*.webp; do
  [ -e "$f" ] || continue
  png="${f%.webp}.png"
  if command -v sips >/dev/null 2>&1; then
    sips -s format png "$f" --out "$png" >/dev/null 2>&1 || ffmpeg -v error -y -i "$f" "$png"
  else
    ffmpeg -v error -y -i "$f" "$png"
  fi
done

echo "== 下载完成: $(ls "$OUT"/slide_*.png 2>/dev/null | wc -l | tr -d ' ') 张 png =="
ls -l "$OUT"/slide_*.png 2>/dev/null | awk '{print $5, $9}'
