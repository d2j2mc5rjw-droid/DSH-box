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

# pnpm 某些操作会清掉未跟踪的自定义插件目录，先自愈
if [[ ! -d packages/llm/llm-ollama ]]; then
  echo "==> 自定义插件缺失，从 vendor 恢复..."
  tar -xzf "$ROOT/vendor/custom-llm-plugins.tgz" -C "$SRC"
fi
node "$ROOT/scripts/apply-wiring.mjs" "$SRC"

rm -rf "$DEST"
mkdir -p "$DEST"
corepack pnpm --filter @deepseek-ai/dsh deploy --prod --legacy "$DEST"

echo "==> 部署完成 ($(du -sh "$DEST" | cut -f1))，静态全量补齐缺失包…"
node "$ROOT/scripts/fill-harness.mjs" "$SRC" "$DEST"

echo "==> 硬化部署树（清除树外链接）..."
node "$ROOT/scripts/harden-harness.mjs" "$SRC" "$DEST"

echo "==> 在沙箱副本中收敛验证…"
# 在与打包环境等价的中立位置收敛（避免部署树依赖源仓库的相对符号链接）
SANDBOX="$(mktemp -d /tmp/dsh-box-sandbox.XXXXXX)"
cp -R "$DEST" "$SANDBOX/harness"
# 随机高端口探测，避免与运行中的服务产生假阳性
PROBE_PORT=$((20000 + RANDOM % 20000))
if node "$ROOT/scripts/fixup-harness.mjs" "$SRC" "$SANDBOX/harness" "--port=$PROBE_PORT"; then
  rm -rf "$DEST"
  mv "$SANDBOX/harness" "$DEST"
  echo "==> 沙箱验证通过，已换入 $DEST"
  rm -rf "$SANDBOX"
else
  echo "!! 沙箱收敛失败，保留原树并保留沙箱供排查: $SANDBOX"
  exit 1
fi
