#!/usr/bin/env bash
# 改完 asset-worker/ 源码后一键 rebuild + 重启 container。
#
# 背景：asset-worker 是 docker compose 里的 build: ./asset-worker 服务，
# 仅 git push 不会让容器内代码生效，需要重新 build image + 重启容器。
# 不跑这个脚本的典型症状：worker /pull/* 或 /push/* 行为像旧版本（缺新字段
# 接收 / 缺新 endpoint），或新加的 routes/services 未生效。
set -e
cd "$(dirname "$0")/.."

echo ">>> rebuild + 重启 asset-worker container..."
docker compose -f docker-compose.dev.yml up -d --build asset-worker

echo ""
echo ">>> 等待 worker /health 返回 UP..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8765/health >/dev/null 2>&1; then
    uptime=$(curl -s http://localhost:8765/health | python3 -c 'import sys,json;print(json.load(sys.stdin).get("uptime_sec","?"))' 2>/dev/null || echo "?")
    echo "    worker ready (uptime=${uptime}s, attempt=${i})"
    break
  fi
  sleep 1
done

echo ""
echo "✅ asset-worker 已更新到最新源码。如还触发不到新行为：清浏览器/前端缓存，或重启 backend (Ctrl+C 后再跑 ./bin/dev-backend.sh)"
