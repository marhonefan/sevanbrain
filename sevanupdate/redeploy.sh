#!/usr/bin/env bash
# sevanbrain 本机重新部署（bun link 模式：工作树源码即生产 CLI，改完即生效）
# 用法: bash sevanupdate/redeploy.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
echo "==> 仓库: $REPO_ROOT"

# 1. 清理历史遗留的 npm 全局 gbrain（曾指向已失效的 npm 缓存临时目录）
if npm ls -g gbrain --depth=0 >/dev/null 2>&1; then
  echo "==> 移除遗留的 npm 全局 gbrain"
  npm rm -g gbrain || true
fi

# 2. 安装依赖
echo "==> bun install"
bun install

# 3. 把工作树注册为全局 gbrain CLI
echo "==> bun link"
bun link

# 4. 验证
if ! command -v gbrain >/dev/null 2>&1; then
  echo "!! gbrain 未出现在 PATH 中，请确认 ~/.bun/bin 在 PATH 里" >&2
  exit 1
fi
echo "==> 部署完成: $(command -v gbrain)"
gbrain --version
