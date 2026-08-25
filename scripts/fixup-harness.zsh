#!/bin/zsh
# 收敛式修复 pnpm deploy 产物缺失包：
# 反复启动内核，遇到 ERR_MODULE_NOT_FOUND 就从源仓库隐藏 hoist 层
# 解引用拷贝该包，直到服务能起或达到最大轮数。
# 用法: zsh scripts/fixup-harness.zsh [源仓库] [部署目录]
set -e
SRC="${1:-$HOME/deepseek-harness}"
DEST="${2:-$(cd "$(dirname "$0")/.." && pwd)/resources/harness}"

SRC_HOIST="$SRC/node_modules/.pnpm/node_modules"
DEST_HOIST="$DEST/node_modules/.pnpm/node_modules"
LOG=/tmp/dsh-fixup-probe.log

copy_pkg() {
  local rel="$1"   # 形如 @deepseek-ai/cordis-plugin-group
  local from="$SRC_HOIST/$rel"
  [[ -e "$from" ]] || from="$SRC/node_modules/$rel"
  if [[ ! -e "$from" ]]; then echo "源中也不存在 $rel"; return 1; fi
  # hoist 条目多为指向源仓库 packages/ 的符号链接：取真实路径，
  # 且不跟随内部 node_modules（避免循环；缺失依赖由后续轮次补入 hoist 层）
  if [[ -L "$from" ]]; then
    local t="$(readlink -f "$from" 2>/dev/null)"
    [[ -d "$t" && "$t" != "$from" ]] && from="$t"
    # 若链接目标在源仓库内，直接用仓库内的包目录（含已构建 lib）
    if [[ "$t" == "$SRC"/* ]]; then from="$t"; fi
  fi
  mkdir -p "$DEST_HOIST/$(dirname "$rel")"
  rm -rf "$DEST_HOIST/$rel" "$DEST_HOIST/$rel.tmp"
  rsync -a --exclude node_modules --exclude tests --exclude src \
    --exclude '*.tsbuildinfo' "$from/" "$DEST_HOIST/$rel.tmp/"
  if [[ ! -f "$DEST_HOIST/$rel.tmp/package.json" ]]; then
    echo "  ! 拷贝不完整：$rel"; return 1
  fi
  mv "$DEST_HOIST/$rel.tmp" "$DEST_HOIST/$rel"
  echo "  + 补 $rel (← $from)"
}

for round in {1..40}; do
  set +e
  cd "$DEST"
  node lib/bin.js web > "$LOG" 2>&1 &
  PID=$!
  OK=0
  for i in {1..20}; do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://127.0.0.1:3080/ 2>/dev/null)
    if [[ "$code" == "200" ]]; then OK=1; break; fi
    kill -0 $PID 2>/dev/null || break
    sleep 1
  done
  kill $PID 2>/dev/null
  wait $PID 2>/dev/null
  set -e
  if [[ $OK == 1 ]]; then
    echo "== 修复完成，服务可正常启动（第 $round 轮）=="
    exit 0
  fi
  # 批量收集全部缺失包（去重），一次补齐
  MISSES=$(grep -o "Cannot find package '[^']*'" "$LOG" | sed "s/Cannot find package '//;s/'//" | sort -u)
  if [[ -z "$MISSES" ]]; then
    echo "== 非缺包错误，最后日志：="
    tail -5 "$LOG"
    exit 2
  fi
  COPIED=0
  for M in "${(f)MISSES}"; do
    if [[ "$M" == "$DEST_HOIST"/* ]]; then
      rel="${M#$DEST_HOIST/}"
      parts=("${(s:/:)rel}")
      if [[ "$parts[1]" == @* ]]; then REL="$parts[1]/$parts[2]"; else REL="$parts[1]"; fi
    else
      REL="$M"
    fi
    echo "[round $round] 缺失: $REL"
    copy_pkg "$REL" && COPIED=$((COPIED+1))
  done
  [[ $COPIED == 0 ]] && { echo "== 无可补包，退出 =="; exit 3; }
done
echo "== 超过最大轮数仍失败 =="
exit 4
