#!/usr/bin/env bash
# W4-OPS-02：RDS 每日 03:00 加密备份 → AES-256-GCM → R2，保留最新 1 份
# 节点 A 跑（cron：0 3 * * * /opt/shopifyhub/ops/backup/rds-backup.sh）
#
# 必备 env：
#   MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
#   BACKUP_AES_KEY                    base64(32B) 与后端 AesGcmUtil 同步
#   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
#   R2_BACKUP_BUCKET (默认 shopifyhub-backup)
#   BACKEND_INTERNAL_URL (默认 http://127.0.0.1:8080)
#
# 失败时调 backend-api /ops/backup/notify-fail 触发 BACKUP_FAIL 钉钉。
# 仅保留最新 1 份：上传成功后列出同前缀对象，删除非最新的。
#
# 注意：openssl 3.x 才支持 -aes-256-gcm；macOS 自带 LibreSSL 不行。生产 Linux 用 openssl@3。
set -euo pipefail

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DB="${MYSQL_DB:-shopifyhub}"
R2_BACKUP_BUCKET="${R2_BACKUP_BUCKET:-shopifyhub-backup}"
BACKEND_INTERNAL_URL="${BACKEND_INTERNAL_URL:-http://127.0.0.1:8080}"
WORK_DIR="${WORK_DIR:-/tmp}"

DATE=$(date +%Y%m%d)
BASENAME="db-${DATE}.sql.gz.enc"
PLAIN="${WORK_DIR}/db-${DATE}.sql"
GZ="${WORK_DIR}/db-${DATE}.sql.gz"
ENC="${WORK_DIR}/${BASENAME}"

cleanup() {
    rm -f "${PLAIN}" "${GZ}" "${ENC}" 2>/dev/null || true
}
trap cleanup EXIT

notify_fail() {
    local reason="$1"
    echo "[rds-backup] FAIL: ${reason}" >&2
    curl -s -X POST "${BACKEND_INTERNAL_URL}/api/ops/backup/notify-fail" \
        -H "Content-Type: application/json" \
        -d "{\"date\":\"${DATE:0:4}-${DATE:4:2}-${DATE:6:2}\",\"reason\":$(jq -Rs . <<<"${reason}")}" \
        >/dev/null 2>&1 || true
}

# ----- 前置检查 -----
[[ -n "${MYSQL_PASSWORD:-}" ]]      || { notify_fail "MYSQL_PASSWORD missing"; exit 2; }
[[ -n "${BACKUP_AES_KEY:-}" ]]      || { notify_fail "BACKUP_AES_KEY missing"; exit 2; }
[[ -n "${R2_ENDPOINT:-}" ]]         || { notify_fail "R2_ENDPOINT missing"; exit 2; }
[[ -n "${R2_ACCESS_KEY_ID:-}" ]]    || { notify_fail "R2_ACCESS_KEY_ID missing"; exit 2; }
[[ -n "${R2_SECRET_ACCESS_KEY:-}" ]] || { notify_fail "R2_SECRET_ACCESS_KEY missing"; exit 2; }

command -v mysqldump >/dev/null   || { notify_fail "mysqldump not in PATH"; exit 2; }
command -v aws >/dev/null         || { notify_fail "aws-cli not in PATH"; exit 2; }
command -v openssl >/dev/null     || { notify_fail "openssl not in PATH"; exit 2; }
command -v sha256sum >/dev/null || command -v shasum >/dev/null \
    || { notify_fail "sha256sum/shasum missing"; exit 2; }

# ----- 1) mysqldump --single-transaction（不阻塞业务读写） -----
echo "[rds-backup] dumping ${MYSQL_DB} ..."
mysqldump --host="${MYSQL_HOST}" --port="${MYSQL_PORT}" --user="${MYSQL_USER}" \
    --password="${MYSQL_PASSWORD}" \
    --single-transaction --routines --triggers --events --quick \
    --set-gtid-purged=OFF \
    "${MYSQL_DB}" > "${PLAIN}" || { notify_fail "mysqldump failed"; exit 3; }

# ----- 2) gzip -----
gzip -f "${PLAIN}"   # → ${GZ}

# ----- 3) AES-256-GCM 加密 -----
# BACKUP_AES_KEY 为 base64(32B)。openssl 3.x 才支持 GCM；要求 IV 长度 12B。
# 输出格式：iv (12B) || ciphertext || tag (16B) — 与 backend AesGcmUtil 兼容。
RAW_KEY_HEX=$(printf '%s' "${BACKUP_AES_KEY}" | base64 -d | xxd -p -c 256)
IV_HEX=$(openssl rand -hex 12)

# openssl enc 不直接支持 GCM；用 dd / openssl 组合也复杂。生产推荐 python helper；
# 这里给两条降级路径：
#   优先：python3 + cryptography
#   降级：openssl enc -aes-256-cbc + sha256（不是 GCM，但加密 + 完整性可用）
if command -v python3 >/dev/null && python3 -c "import cryptography" 2>/dev/null; then
    python3 - "${GZ}" "${ENC}" "${BACKUP_AES_KEY}" "${IV_HEX}" <<'PYEOF'
import base64, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
src, dst, b64key, iv_hex = sys.argv[1:]
key = base64.b64decode(b64key)
iv = bytes.fromhex(iv_hex)
with open(src, "rb") as f:
    data = f.read()
ct = AESGCM(key).encrypt(iv, data, associated_data=None)
with open(dst, "wb") as f:
    f.write(iv + ct)  # iv || ciphertext (含 16B GCM tag in tail)
PYEOF
    ENC_MODE="aes-256-gcm"
else
    echo "[rds-backup] python cryptography 不可用，降级 aes-256-cbc + 独立 sha256 文件" >&2
    openssl enc -aes-256-cbc -salt -K "${RAW_KEY_HEX}" -iv "${IV_HEX}" \
        -in "${GZ}" -out "${ENC}" || { notify_fail "openssl encrypt failed"; exit 4; }
    ENC_MODE="aes-256-cbc"
fi

# ----- 4) SHA-256 校验 -----
if command -v sha256sum >/dev/null; then
    SHA256=$(sha256sum "${ENC}" | awk '{print $1}')
else
    SHA256=$(shasum -a 256 "${ENC}" | awk '{print $1}')
fi
SIZE=$(stat -c '%s' "${ENC}" 2>/dev/null || stat -f '%z' "${ENC}")
echo "[rds-backup] mode=${ENC_MODE} size=${SIZE} sha256=${SHA256}"

# ----- 5) 上传 R2 -----
export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}"
export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}"

aws s3 cp "${ENC}" "s3://${R2_BACKUP_BUCKET}/${BASENAME}" \
    --endpoint-url "${R2_ENDPOINT}" \
    --metadata "sha256=${SHA256},mode=${ENC_MODE},iv=${IV_HEX}" \
    || { notify_fail "R2 upload failed"; exit 5; }

# ----- 6) 仅保留最新 1 份：列出 db-*.sql.gz.enc，删除非今日的 -----
echo "[rds-backup] pruning older copies ..."
aws s3 ls "s3://${R2_BACKUP_BUCKET}/" --endpoint-url "${R2_ENDPOINT}" \
    | awk '{print $4}' \
    | grep -E '^db-[0-9]{8}\.sql\.gz\.enc$' \
    | grep -v "^${BASENAME}$" \
    | while read -r f; do
        echo "  rm s3://${R2_BACKUP_BUCKET}/${f}"
        aws s3 rm "s3://${R2_BACKUP_BUCKET}/${f}" --endpoint-url "${R2_ENDPOINT}" || true
    done

# ----- 7) 通知 backend 备份成功（让其更新 metric） -----
curl -s -X POST "${BACKEND_INTERNAL_URL}/api/ops/backup/notify-success" \
    -H "Content-Type: application/json" \
    -d "{\"date\":\"${DATE:0:4}-${DATE:4:2}-${DATE:6:2}\",\"bytes\":${SIZE},\"sha256\":\"${SHA256}\"}" \
    >/dev/null 2>&1 || true

echo "[rds-backup] DONE"
