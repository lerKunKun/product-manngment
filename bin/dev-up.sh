#!/usr/bin/env bash
# 一键启动本地开发环境（docker 中间件 + backend + frontend）
# Backend / Frontend 在分别的终端 tab 运行更方便看日志，本脚本只起 docker。
set -e
cd "$(dirname "$0")/.."

echo ">>> 1) 起 docker 中间件（mysql 3307 / redis 6380 / rabbit 5672 / minio 9000）..."
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml ps

echo ""
echo ">>> 2) 等待 mysql healthy..."
for i in $(seq 1 30); do
  if docker exec shopify-hub-mysql mysqladmin ping -h 127.0.0.1 -uroot -proot >/dev/null 2>&1; then
    echo "    mysql ready (${i}s)"
    break
  fi
  sleep 1
done

echo ""
echo "✅ 中间件就绪。请分两个终端 tab 运行："
echo "   ./bin/dev-backend.sh    # backend on :8080"
echo "   ./bin/dev-frontend.sh   # frontend on :3000"
echo ""
echo "测试入口："
echo "   - 前端首页:  http://localhost:3000"
echo "   - 默认账号:  admin / admin123"
echo "   - API 健康:  http://localhost:8080/api/health"
echo "   - RabbitMQ:  http://localhost:15672 (guest/guest)"
echo "   - MinIO:     http://localhost:9001 (minioadmin/minioadmin)"
