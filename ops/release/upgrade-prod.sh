#!/usr/bin/env bash
#
# upgrade-prod.sh — 单机生产部署一键升级（带备份）
#
# 必须在 docker-compose.prod.yml 所在目录运行（也就是仓库根）。
# 它会：
#   1. 用当前 git HEAD + mysqldump 在 .backups/<TS>/ 下做一份快照
#   2. git fetch + 把 main 拉到本地（reset --hard origin/main，丢弃任何本地未提交改动）
#   3. docker compose 重建 backend + frontend（不动 mysql/redis/rabbit/minio/asset-worker）
#   4. 打印回退命令
#
# 中间件容器（mysql 等）刻意不重启，避免数据库连接被抖断、cache 全冷启。
# asset-worker 如果有改动也不会自动重建——本次升级不涉及，需要时手工 docker compose ... up -d --build asset-worker。
#
# 用法:
#   bash ops/release/upgrade-prod.sh
#
# 回退:
#   bash ops/release/rollback-prod.sh <TS>     # TS 在脚本末尾打印
#

set -euo pipefail

# ---------- 0. sanity ----------

if [[ ! -f docker-compose.prod.yml ]]; then
    echo "ERROR: docker-compose.prod.yml 不在当前目录。请到部署根目录再运行。" >&2
    exit 1
fi
if [[ ! -f .env.prod ]]; then
    echo "ERROR: .env.prod 不存在（生产配置）。" >&2
    exit 1
fi
if [[ ! -d .git ]]; then
    echo "ERROR: 不是 git 工作树。" >&2
    exit 1
fi

TS=$(date -u +%Y%m%d-%H%M%S)
BACKUP_DIR=".backups/$TS"
mkdir -p "$BACKUP_DIR"

OLD_HEAD=$(git rev-parse HEAD)
OLD_HEAD_SHORT=$(git rev-parse --short HEAD)

echo "==============================="
echo "  生产升级 — $TS"
echo "  当前 HEAD: $OLD_HEAD_SHORT"
echo "  备份目录:  $BACKUP_DIR"
echo "==============================="
echo

# ---------- 1. 显示将要拉入的 commit ----------

echo "[1/5] fetch origin ..."
git fetch --quiet origin main
INCOMING=$(git log --oneline "$OLD_HEAD..origin/main" || true)
if [[ -z "$INCOMING" ]]; then
    echo "      origin/main 没有新 commit，无事可做。"
    rmdir "$BACKUP_DIR" 2>/dev/null || true
    exit 0
fi
echo "      即将合入的 commit:"
echo "$INCOMING" | sed 's/^/        /'
echo

# ---------- 2. 备份 git HEAD ----------

echo "[2/5] 记录当前 commit → $BACKUP_DIR/git-head.txt"
echo "$OLD_HEAD" > "$BACKUP_DIR/git-head.txt"

# ---------- 3. 备份代码 ----------

echo "[3/5] tar 备份代码到 $BACKUP_DIR/code.tar.gz ..."
tar --warning=no-file-changed \
    --exclude='./.git' \
    --exclude='./.backups' \
    --exclude='./backend-api/target' \
    --exclude='./frontend-admin/node_modules' \
    --exclude='./frontend-admin/.next' \
    --exclude='./asset-worker/.venv' \
    --exclude='./asset-worker/__pycache__' \
    -czf "$BACKUP_DIR/code.tar.gz" . \
    || { echo "      tar 备份失败"; exit 1; }
echo "      $(du -h "$BACKUP_DIR/code.tar.gz" | cut -f1)"

# ---------- 4. 备份 MySQL ----------

echo "[4/5] mysqldump 备份数据库到 $BACKUP_DIR/mysql.sql.gz ..."

# 从 .env.prod 读密码；.env.prod 未定义则用 compose 文件里的默认值
MYSQL_PASSWORD_VALUE=$(grep -E '^MYSQL_PASSWORD=' .env.prod | head -n1 | cut -d= -f2- | tr -d '\r' | sed 's/^"\(.*\)"$/\1/;s/^'"'"'\(.*\)'"'"'$/\1/' || true)
if [[ -z "${MYSQL_PASSWORD_VALUE:-}" ]]; then
    MYSQL_PASSWORD_VALUE="shub-root-prod"
    echo "      WARN: .env.prod 没找到 MYSQL_PASSWORD，回落到 compose 默认 'shub-root-prod'"
fi

if ! docker ps --format '{{.Names}}' | grep -q '^shub-mysql$'; then
    echo "      ERROR: shub-mysql 容器没运行。" >&2
    exit 1
fi

docker exec -e MYSQL_PWD="$MYSQL_PASSWORD_VALUE" shub-mysql \
    mysqldump -uroot --all-databases --single-transaction --routines --triggers --quick \
    | gzip -c > "$BACKUP_DIR/mysql.sql.gz"
echo "      $(du -h "$BACKUP_DIR/mysql.sql.gz" | cut -f1)"

# ---------- 5. 拉新代码并重建 ----------

echo "[5/5] git reset --hard origin/main 并重建容器 ..."
git reset --hard origin/main
NEW_HEAD_SHORT=$(git rev-parse --short HEAD)
echo "      新 HEAD: $NEW_HEAD_SHORT"
echo

echo "      docker compose up -d --build backend frontend ..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build backend frontend

echo
echo "==============================="
echo "  ✓ 升级完成（$OLD_HEAD_SHORT → $NEW_HEAD_SHORT）"
echo "==============================="
echo
echo "如需回退到升级前状态，复制下面这一行执行："
echo
echo "    bash ops/release/rollback-prod.sh $TS"
echo
echo "（备份位置：$BACKUP_DIR/）"
