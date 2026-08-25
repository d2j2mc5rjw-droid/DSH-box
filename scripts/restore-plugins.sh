#!/bin/zsh
# 恢复被误删的自定义插件到源仓库并重新接线（幂等）
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$HOME/deepseek-harness}"

cd "$SRC"
if [[ ! -d packages/llm/llm-ollama ]]; then
  echo "==> 插件目录缺失，从 DSH-box vendor 恢复..."
  tar -xzf "$ROOT/vendor/custom-llm-plugins.tgz" -C "$SRC"
fi

node "$ROOT/scripts/apply-wiring.mjs" "$SRC"
echo "==> 恢复完成"
