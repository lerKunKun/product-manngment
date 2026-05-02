#!/usr/bin/env bash
# 备份恢复用：解密 db-YYYYMMDD.sql.gz.enc → db-YYYYMMDD.sql.gz
# 用法：bash decrypt.sh <input.enc> <output.sql.gz>
# 需 BACKUP_AES_KEY env（与 backend AesGcmUtil 同一 base64 32B 密钥）
set -euo pipefail

if [[ $# -lt 2 ]]; then
    echo "Usage: $0 <encrypted.enc> <output.sql.gz>" >&2
    exit 1
fi
SRC="$1"
DST="$2"

[[ -n "${BACKUP_AES_KEY:-}" ]] || { echo "BACKUP_AES_KEY missing" >&2; exit 2; }
[[ -r "${SRC}" ]]              || { echo "input not readable: ${SRC}" >&2; exit 2; }

# 优先：python3 + cryptography（与 rds-backup.sh 加密路径同算法）
if command -v python3 >/dev/null && python3 -c "import cryptography" 2>/dev/null; then
    python3 - "${SRC}" "${DST}" "${BACKUP_AES_KEY}" <<'PYEOF'
import base64, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
src, dst, b64key = sys.argv[1:]
key = base64.b64decode(b64key)
with open(src, "rb") as f:
    blob = f.read()
iv = blob[:12]
ct = blob[12:]
pt = AESGCM(key).decrypt(iv, ct, associated_data=None)
with open(dst, "wb") as f:
    f.write(pt)
print(f"[decrypt] {len(pt)} bytes")
PYEOF
    exit 0
fi

# 降级：openssl aes-256-cbc（仅当 backup 也走 CBC 路径时可用）
echo "[decrypt] python cryptography 不可用，尝试 aes-256-cbc 降级（仅适用 CBC backup）" >&2
echo "  备份元数据见 R2 object 的 x-amz-meta-mode 头：'aes-256-gcm' = 不支持，'aes-256-cbc' = 可用" >&2

# 解码 BACKUP_AES_KEY → raw hex
RAW_KEY_HEX=$(printf '%s' "${BACKUP_AES_KEY}" | base64 -d | xxd -p -c 256)

# CBC 模式需要 IV：从对象元数据读，命令行第三个参数；这里默认 fail-open 提示
echo "  CBC 解密需要 iv 十六进制，请用：" >&2
echo "    openssl enc -d -aes-256-cbc -K ${RAW_KEY_HEX} -iv <iv_hex> -in ${SRC} -out ${DST}" >&2
exit 3
