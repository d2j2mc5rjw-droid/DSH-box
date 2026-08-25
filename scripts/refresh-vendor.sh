#!/bin/zsh
# 重新生成 DSH-box 的 vendor 插件包与接线补丁（从本地已修复的源码树）
set -e
SRC="${1:-$HOME/deepseek-harness}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$SRC"
# 接线改动可能在暂存区（git apply --3way 会 stage），用 HEAD 取全部改动
git diff HEAD -- packages/bundle/base/cordis.patch.yml packages/bundle/base/package.json tsconfig.host.json > "$ROOT/patches/local-wiring.patch"

rm -f "$ROOT/vendor/custom-llm-plugins.tgz"
tar --exclude node_modules -czf "$ROOT/vendor/custom-llm-plugins.tgz" packages/llm/llm-deepseek-web packages/llm/llm-ollama

echo "patch: $(wc -l < "$ROOT/patches/local-wiring.patch") lines"
ls -la "$ROOT/vendor/"
