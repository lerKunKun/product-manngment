#!/usr/bin/env bash
# W4-OPS-03：软删除 90 天后物理删（R2 端清理）
# 节点 A 跑（cron：30 4 * * * /opt/shopifyhub/ops/backup/audit-purge.sh）
#
# 注：MySQL 侧的物理删 DELETE 已由 backend RecycleBinPurgeScheduler 执行；
# 本脚本只负责 R2 上的孤儿 object 清理（图片 / 富文本 / 主题资产）。
#
# 策略：
#   1) 查 product_image / product_doc / theme_asset_file 中所有 r2_key
#   2) 列 R2 桶相同 prefix 下的全部 key
#   3) diff → 不在数据库的 key 视作孤儿，删除（保留最近 24h 的 key 避免与上传期竞态）
set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DB="${MYSQL_DB:-shopifyhub}"
R2_MEDIA_BUCKET="${R2_MEDIA_BUCKET:-product-media}"
R2_THEME_BUCKET="${R2_BUCKET:-shopify-themes}"

[[ -n "${MYSQL_PASSWORD:-}" ]]      || { echo "MYSQL_PASSWORD missing" >&2; exit 2; }
[[ -n "${R2_ENDPOINT:-}" ]]         || { echo "R2_ENDPOINT missing" >&2; exit 2; }
[[ -n "${R2_ACCESS_KEY_ID:-}" ]]    || { echo "R2_ACCESS_KEY_ID missing" >&2; exit 2; }
[[ -n "${R2_SECRET_ACCESS_KEY:-}" ]] || { echo "R2_SECRET_ACCESS_KEY missing" >&2; exit 2; }

export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"

WORK=$(mktemp -d)
trap 'rm -rf "${WORK}"' EXIT

mysql_q() {
    mysql --host="${MYSQL_HOST}" --port="${MYSQL_PORT}" --user="${MYSQL_USER}" \
        --password="${MYSQL_PASSWORD}" -N -B "${MYSQL_DB}" -e "$1"
}

list_db_keys() {
    # 兼容 schema：表 / 列名缺失时静默跳过
    {
        mysql_q "SELECT r2_key FROM product_image WHERE deleted_at IS NULL OR deleted_at >= NOW() - INTERVAL 90 DAY" 2>/dev/null || true
        mysql_q "SELECT r2_key FROM product_doc   WHERE deleted_at IS NULL OR deleted_at >= NOW() - INTERVAL 90 DAY" 2>/dev/null || true
        mysql_q "SELECT zip_r2_key FROM base_template_version" 2>/dev/null || true
        mysql_q "SELECT json_r2_key FROM product_snapshot WHERE created_at >= NOW() - INTERVAL 90 DAY" 2>/dev/null || true
        mysql_q "SELECT csv_r2_key  FROM product_snapshot WHERE created_at >= NOW() - INTERVAL 90 DAY" 2>/dev/null || true
    } | grep -v '^$' | sort -u > "${WORK}/db_keys.txt"
}

list_bucket_keys() {
    local bucket="$1"
    local prefix="${2:-}"
    aws s3api list-objects-v2 --bucket "${bucket}" --endpoint-url "${R2_ENDPOINT}" \
        ${prefix:+--prefix "${prefix}"} \
        --query 'Contents[?LastModified<=`'"$(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)"'`].Key' \
        --output text 2>/dev/null \
        | tr '\t' '\n' | sort -u
}

purge_bucket() {
    local bucket="$1"
    local prefix="${2:-}"
    list_bucket_keys "${bucket}" "${prefix}" > "${WORK}/bucket_keys.txt"
    if [[ ! -s "${WORK}/bucket_keys.txt" ]]; then
        echo "[audit-purge] ${bucket}/${prefix}* empty / no candidates"
        return
    fi
    comm -23 "${WORK}/bucket_keys.txt" "${WORK}/db_keys.txt" > "${WORK}/orphans.txt"
    local cnt
    cnt=$(wc -l < "${WORK}/orphans.txt" | tr -d ' ')
    echo "[audit-purge] ${bucket}/${prefix}* orphans=${cnt}"
    while IFS= read -r key; do
        [[ -z "${key}" ]] && continue
        echo "  rm s3://${bucket}/${key}"
        aws s3 rm "s3://${bucket}/${key}" --endpoint-url "${R2_ENDPOINT}" >/dev/null || true
    done < "${WORK}/orphans.txt"
}

list_db_keys
echo "[audit-purge] db_keys=$(wc -l < ${WORK}/db_keys.txt | tr -d ' ')"

# 仅清理产品/快照前缀（避免误删主题）
purge_bucket "${R2_MEDIA_BUCKET}" "products/"
purge_bucket "${R2_THEME_BUCKET}"  "snapshots/"

echo "[audit-purge] DONE"
