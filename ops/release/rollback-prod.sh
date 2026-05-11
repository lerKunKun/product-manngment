#!/usr/bin/env bash
#
# rollback-prod.sh — 回退到 upgrade-prod.sh 留下的某个备份点
#
# 用法:
#   bash ops/release/rollback-prod.sh <TS>
#     # TS 是 upgrade-prod.sh 末尾打印的时间戳，如 20260511-093000
#
# 流程:
#   1. git reset --hard 到备份时记录的 HEAD（你升级前那个 commit）
#   2. 从 mysqldump 还原数据库（先 drop 现有库，再灌入备份）
#   3. 重建 backend + frontend 容器
#
# 危险动作（会破坏数据）：先看清备份目录里的文件再执行，不确定别按回车。
#

set -euo pipefail

TS="${1:-}"
if [[ -z "$TS" ]]; then
    echo "ERROR: 用法 bash ops/release/rollback-prod.sh <TS>" >&2
    echo "       近期备份：" >&2
    ls -1t .backups/ 2>/dev/null | head -5 | sed 's/^/         /' >&2
    exit 1
fi

BACKUP_DIR=".backups/$TS"
if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "ERROR: 备份目录不存在: $BACKUP_DIR" >&2
    echo "       现有备份：" >&2
    ls -1t .backups/ 2>/dev/null | head -10 | sed 's/^/         /' >&2
    exit 1
fi
if [[ ! -f "$BACKUP_DIR/git-head.txt" ]] || [[ ! -f "$BACKUP_DIR/mysql.sql.gz" ]]; then
    echo "ERROR: 备份不完整，缺少 git-head.txt 或 mysql.sql.gz" >&2
    exit 1
fi
if [[ ! -f docker-compose.prod.yml ]] || [[ ! -f .env.prod ]]; then
    echo "ERROR: 当前目录不是部署根目录。" >&2
    exit 1
fi

OLD_HEAD=$(cat "$BACKUP_DIR/git-head.txt")
CURRENT_HEAD_SHORT=$(git rev-parse --short HEAD)
OLD_HEAD_SHORT=$(git rev-parse --short "$OLD_HEAD" 2>/dev/null || echo "$OLD_HEAD")

echo "==============================="
echo "  生产回退 — 备份点 $TS"
echo "  当前 HEAD:  $CURRENT_HEAD_SHORT"
echo "  目标 HEAD:  $OLD_HEAD_SHORT"
echo "==============================="
echo
echo "  这一步会：1) git reset --hard 到目标 commit"
echo "            2) 用 $BACKUP_DIR/mysql.sql.gz 覆盖所有业务数据库"
echo "            3) 重建 backend + frontend"
echo
read -r -p "确定执行回退？输入 yes 继续: " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
    echo "已取消。"
    exit 0
fi

# ---------- 1. git ----------

echo "[1/3] git reset --hard $OLD_HEAD_SHORT ..."
git fetch --quiet origin
git reset --hard "$OLD_HEAD"

# ---------- 2. MySQL ----------

echo "[2/3] 还原 MySQL ..."
MYSQL_PASSWORD_VALUE=$(grep -E '^MYSQL_PASSWORD=' .env.prod | head -n1 | cut -d= -f2- | tr -d '\r' | sed 's/^"\(.*\)"$/\1/;s/^'"'"'\(.*\)'"'"'$/\1/' || true)
if [[ -z "${MYSQL_PASSWORD_VALUE:-}" ]]; then
    MYSQL_PASSWORD_VALUE="shub-root-prod"
fi

if ! docker ps --format '{{.Names}}' | grep -q '^shub-mysql$'; then
    echo "      ERROR: shub-mysql 容器没运行，无法还原。" >&2
    exit 1
fi

# 灌备份。备份是 --all-databases，里面包含 CREATE DATABASE / USE / DROP TABLE，会重建业务库。
gunzip -c "$BACKUP_DIR/mysql.sql.gz" \
  | docker exec -i -e MYSQL_PWD="$MYSQL_PASSWORD_VALUE" shub-mysql mysql -uroot
echo "      mysql 还原完成"

# ---------- 3. 重建 backend + frontend ----------

echo "[3/3] docker compose up -d --build backend frontend ..."
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build backend frontend

echo
echo "==============================="
echo "  ✓ 回退完成（$CURRENT_HEAD_SHORT → $OLD_HEAD_SHORT）"
echo "==============================="
