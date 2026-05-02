#!/usr/bin/env bash
# 连 RDS + 跑 Flyway 迁移 + 预创建 5 个租户库
# 用法：bash 05-init-db.sh
set -euo pipefail
echo ">>> [05] 数据库初始化（占位，Wave 1 完整实现）..."
echo "TODO: create databases tenant_01..tenant_05, run mvn flyway:migrate against platform db"
