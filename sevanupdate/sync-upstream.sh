#!/usr/bin/env bash
# 同步上游 gbrain (garrytan/gbrain) 到 sevanbrain，并推回 fork (origin)
# 用法: bash sevanupdate/sync-upstream.sh
set -euo pipefail

UPSTREAM_URL="git@github.com:garrytan/gbrain.git"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
echo "==> 仓库: $REPO_ROOT"

# 0. 前置检查：在 master 分支、工作树干净
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "master" ]; then
  echo "!! 当前在分支 $BRANCH，请先切回 master 再同步" >&2
  exit 1
fi
if [ -n "$(git status --porcelain -uno)" ]; then
  echo "!! 工作树有未提交的已跟踪文件改动，请先 commit 或 stash" >&2
  exit 1
fi

# 1. 确保 upstream 远程存在
git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_URL"

# 2. 拉取上游
echo "==> git fetch upstream master"
git fetch upstream master

# 3. 对比并合并
BEHIND="$(git rev-list --count master..upstream/master)"
if [ "$BEHIND" -eq 0 ]; then
  echo "==> 已是最新，无需合并"
  exit 0
fi
echo "==> 上游有 $BEHIND 个新提交，开始合并："
git log --oneline master..upstream/master | head -20

LOCK_BEFORE="$(git rev-parse HEAD:bun.lock 2>/dev/null || echo none)"
git merge --no-edit upstream/master
# 合并冲突时 set -e 会在此中止；解决冲突后 git commit，再重跑本脚本即可

# 4. 推回 fork
echo "==> git push origin master"
git push origin master

# 5. 依赖有变则重装（link 模式下源码即生效，无需重新 link）
LOCK_AFTER="$(git rev-parse HEAD:bun.lock 2>/dev/null || echo none)"
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  echo "==> bun.lock 有变化，执行 bun install"
  bun install
fi

echo "==> 同步完成: $(git log -1 --oneline)"
