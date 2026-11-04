#!/usr/bin/env bash
# Lotus Shorts 源码部署更新脚本
# 用法：
#   chmod +x /llm/lotus-shorts/update-server.sh
#   /llm/lotus-shorts/update-server.sh
#
# 环境变量（可选）：
#   ROOT=/llm/lotus-shorts
#   SERVICE=lotus-shorts
#   SKIP_FRONTEND=1          # 只更新后端时跳过前端构建
#   SKIP_BACKEND_DEPS=1      # 跳过 backend npm ci
#   SKIP_FRONTEND_DEPS=1     # 跳过 frontend npm ci（仍会 generate）
set -euo pipefail

ROOT="${ROOT:-/llm/lotus-shorts}"
SERVICE="${SERVICE:-lotus-shorts}"
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
SKIP_BACKEND_DEPS="${SKIP_BACKEND_DEPS:-0}"
SKIP_FRONTEND_DEPS="${SKIP_FRONTEND_DEPS:-0}"

export PATH="/usr/local/nodejs/bin:${PATH}"

cd "$ROOT"

echo "==> [1/4] git pull"
git pull --ff-only
echo "    HEAD=$(git rev-parse --short HEAD)"

if [[ "$SKIP_BACKEND_DEPS" != "1" ]]; then
  echo "==> [2/4] backend npm ci"
  (cd backend && npm ci)
else
  echo "==> [2/4] skip backend npm ci"
fi

if [[ "$SKIP_FRONTEND" != "1" ]]; then
  echo "==> [3/4] frontend build"
  (
    cd frontend
    if [[ "$SKIP_FRONTEND_DEPS" != "1" ]]; then
      npm ci
    else
      echo "    skip frontend npm ci"
    fi
    npm run generate
    rm -rf dist
    cp -r .output/public dist
  )
else
  echo "==> [3/4] skip frontend"
fi

echo "==> [4/4] restart ${SERVICE}"
if systemctl cat "$SERVICE" >/dev/null 2>&1; then
  sudo systemctl restart "$SERVICE"
  sleep 1
  sudo systemctl --no-pager --full status "$SERVICE" || true
else
  echo "    未找到 systemd 单元 ${SERVICE}，请手动重启后端"
  exit 1
fi

echo "==> done $(git rev-parse --short HEAD)"
