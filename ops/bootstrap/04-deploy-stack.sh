#!/usr/bin/env bash
# 拉镜像 + 起 compose（按节点 A/B/C 不同 compose 文件）
# 用法：bash 04-deploy-stack.sh <节点角色 a|b|c>
set -euo pipefail
echo ">>> [04] 部署应用栈（占位，Wave 1 完整实现）..."
echo "TODO: docker compose -f ops/deploy/node-\$ROLE-*/docker-compose.yml pull && up -d"
