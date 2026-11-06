#!/usr/bin/env bash
# Lotus Shorts 源码部署更新脚本
# 用法：
#   /llm/lotus-shorts/update-server.sh
#
# 默认按 git 变更按需执行：
#   - package.json / package-lock.json 有变，或 node_modules 不存在 → npm ci
#   - frontend/ 有变 → generate + 复制 dist
#   - 后端/前端相关有变 → restart
#
# 环境变量（可选）：
#   ROOT=/llm/lotus-shorts
#   SERVICE=lotus-shorts
#   FORCE_DEPS=1             # 强制前后端都 npm ci
#   FORCE_FRONTEND=1         # 强制前端重新 generate
#   SKIP_FRONTEND=1          # 完全跳过前端
#   SKIP_RESTART=1           # 不重启服务
set -euo pipefail

ROOT="${ROOT:-/llm/lotus-shorts}"
SERVICE="${SERVICE:-lotus-shorts}"
FORCE_DEPS="${FORCE_DEPS:-0}"
FORCE_FRONTEND="${FORCE_FRONTEND:-0}"
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
SKIP_RESTART="${SKIP_RESTART:-0}"

export PATH="/usr/local/nodejs/bin:${PATH}"

cd "$ROOT"

changed() {
  # 用法: changed <path>...
  git diff --name-only "$OLD_HEAD" "$NEW_HEAD" -- "$@" | grep -q .
}

echo "==> [1/4] git pull"
OLD_HEAD="$(git rev-parse HEAD)"
git fetch origin
# 服务器上对已跟踪文件的本地改动丢掉，以远程为准。未跟踪的 .env、data/ 不受影响
git reset --hard origin/main
# reset 会按仓库记录的权限写回；这里再保证脚本可执行，避免下次 ./ 被拒绝
chmod +x "$ROOT/update-server.sh" || true
NEW_HEAD="$(git rev-parse HEAD)"
echo "    ${OLD_HEAD:0:7} -> ${NEW_HEAD:0:7}"

if [[ "$OLD_HEAD" == "$NEW_HEAD" ]]; then
  echo "==> 已是最新，无需更新"
  exit 0
fi

need_backend_deps=0
need_frontend_deps=0
need_frontend_build=0
need_restart=0

if [[ "$FORCE_DEPS" == "1" ]] \
  || [[ ! -d backend/node_modules ]] \
  || changed backend/package.json backend/package-lock.json; then
  need_backend_deps=1
fi

if [[ "$SKIP_FRONTEND" != "1" ]]; then
  if [[ "$FORCE_DEPS" == "1" ]] \
    || [[ ! -d frontend/node_modules ]] \
    || changed frontend/package.json frontend/package-lock.json; then
    need_frontend_deps=1
  fi
  if [[ "$FORCE_FRONTEND" == "1" ]] || changed frontend/; then
    need_frontend_build=1
  fi
fi

if changed backend/ frontend/ update-server.sh; then
  need_restart=1
fi
# 依赖重装后也重启，确保加载新模块
if [[ "$need_backend_deps" == "1" || "$need_frontend_build" == "1" ]]; then
  need_restart=1
fi

if [[ "$need_backend_deps" == "1" ]]; then
  echo "==> [2/4] backend npm ci"
  (cd backend && npm ci)
else
  echo "==> [2/4] skip backend npm ci（依赖无变化）"
fi

if [[ "$SKIP_FRONTEND" == "1" ]]; then
  echo "==> [3/4] skip frontend"
elif [[ "$need_frontend_build" == "1" || "$need_frontend_deps" == "1" ]]; then
  echo "==> [3/4] frontend"
  (
    cd frontend
    if [[ "$need_frontend_deps" == "1" ]]; then
      echo "    npm ci"
      npm ci
    else
      echo "    skip npm ci（依赖无变化）"
    fi
    if [[ "$need_frontend_build" == "1" ]]; then
      echo "    generate"
      npm run generate
      rm -rf dist
      cp -r .output/public dist
    else
      echo "    skip generate（前端源码无变化）"
    fi
  )
else
  echo "==> [3/4] skip frontend（无相关变更）"
fi

if [[ "$SKIP_RESTART" == "1" ]]; then
  echo "==> [4/4] skip restart"
elif [[ "$need_restart" != "1" ]]; then
  echo "==> [4/4] skip restart（无服务相关变更）"
elif systemctl cat "$SERVICE" >/dev/null 2>&1; then
  echo "==> [4/4] restart ${SERVICE}"
  sudo systemctl restart "$SERVICE"
  sleep 1
  sudo systemctl --no-pager --full status "$SERVICE" || true
else
  echo "    未找到 systemd 单元 ${SERVICE}，请手动重启后端"
  exit 1
fi

echo "==> done ${NEW_HEAD:0:7}"
