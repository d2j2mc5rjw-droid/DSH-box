#!/bin/zsh
# 从本地 deepseek-harness 源码仓库构建生产部署树到 resources/harness
# 用法: zsh scripts/sync-harness.sh [源码目录]
set -e
SRC="${1:-$HOME/deepseek-harness}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/resources/harness"

if [[ ! -d "$SRC" ]]; then
  echo "错误: 未找到 Harness 源码目录 $SRC"
  echo "用法: zsh scripts/sync-harness.sh [deepseek-harness 源码目录]"
  exit 1
fi

cd "$SRC"
echo "==> 当前版本: $(node -p "require('./apps/cli/package.json').version")"

rm -rf "$DEST"
mkdir -p "$DEST"
corepack pnpm --filter @deepseek-ai/dsh deploy --prod --legacy "$DEST"

# --prod 部署可能遗漏部分 workspace/vendor 包（如 cordis-plugin-group），
# 用源仓库的解析层补全，保证运行时与源码环境等价：
SRC_NM="$SRC/node_modules"
DEST_NM="$DEST/node_modules"
if [[ -d "$SRC_NM/.pnpm/node_modules" ]]; then
  echo "==> 补全隐藏 hoist 解析层（解引用，避免悬空链接）…"
  mkdir -p "$DEST_NM/.pnpm/node_modules"
  rsync -aL --ignore-existing "$SRC_NM/.pnpm/node_modules/" "$DEST_NM/.pnpm/node_modules/"
fi
if [[ -d "$SRC_NM/@deepseek-ai" ]]; then
  echo "==> 补全顶层 @deepseek-ai 链接（解引用）…"
  mkdir -p "$DEST_NM/@deepseek-ai"
  for d in "$SRC_NM/@deepseek-ai"/*(N); do
    name="$(basename "$d")"
    [[ -e "$DEST_NM/@deepseek-ai/$name" ]] || cp -RL "$d" "$DEST_NM/@deepseek-ai/$name"
  done
fi

echo ""
echo "==> 部署完成 → $DEST ($(du -sh "$DEST" | cut -f1))"
