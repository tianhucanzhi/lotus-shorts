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
#   SKIP_DEPS=1              # 跳过前后端 npm ci（机器内存紧张时用）
#   SKIP_RESTART=1           # 不重启服务
set -euo pipefail

ROOT="${ROOT:-/llm/lotus-shorts}"
SERVICE="${SERVICE:-lotus-shorts}"
FORCE_DEPS="${FORCE_DEPS:-0}"
FORCE_FRONTEND="${FORCE_FRONTEND:-0}"
SKIP_FRONTEND="${SKIP_FRONTEND:-0}"
SKIP_DEPS="${SKIP_DEPS:-0}"
SKIP_RESTART="${SKIP_RESTART:-0}"

export PATH="/usr/local/nodejs/bin:${PATH}"
# 降低 npm/node 峰值内存，减少被 OOM Killer 直接 Killed
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
NPM_CI=(npm ci --no-audit --no-fund --maxsockets 3)

cd "$ROOT"

changed() {
  # 用法: changed <path>...
  git diff --name-only "$OLD_HEAD" "$NEW_HEAD" -- "$@" | grep -q .
}

echo "==> [1/4] git pull"
OLD_HEAD="$(git rev-parse HEAD)"
# 国内机房直连 github 常会挂死；强制超时并关闭交互凭据提示
export GIT_TERMINAL_PROMPT=0
FETCH_TIMEOUT="${GIT_FETCH_TIMEOUT:-25}"
if ! timeout "$FETCH_TIMEOUT" git fetch origin; then
  echo "ERROR: git fetch origin 在 ${FETCH_TIMEOUT}s 内未完成（多为无法访问 github.com）。"
  echo "       请配置代理 / 镜像后再试，或改用本机同步代码。当前服务未改动。"
  exit 1
fi
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

if [[ "$SKIP_DEPS" != "1" ]]; then
  if [[ "$FORCE_DEPS" == "1" ]] \
    || [[ ! -d backend/node_modules ]] \
    || changed backend/package.json backend/package-lock.json; then
    need_backend_deps=1
  fi
fi

if [[ "$SKIP_FRONTEND" != "1" ]]; then
  if [[ "$SKIP_DEPS" != "1" ]]; then
    if [[ "$FORCE_DEPS" == "1" ]] \
      || [[ ! -d frontend/node_modules ]] \
      || changed frontend/package.json frontend/package-lock.json; then
      need_frontend_deps=1
    fi
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
  (cd backend && "${NPM_CI[@]}")
else
  echo "==> [2/4] skip backend npm ci（依赖无变化或 SKIP_DEPS=1）"
fi

if [[ "$SKIP_FRONTEND" == "1" ]]; then
  echo "==> [3/4] skip frontend"
elif [[ "$need_frontend_build" == "1" || "$need_frontend_deps" == "1" ]]; then
  echo "==> [3/4] frontend"
  (
    cd frontend
    if [[ "$need_frontend_deps" == "1" ]]; then
      echo "    npm ci"
      "${NPM_CI[@]}"
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
