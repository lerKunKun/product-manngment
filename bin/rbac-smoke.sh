#!/usr/bin/env bash
# RBAC 冒烟测试：admin path（COMPANY_ADMIN）+ employee path 的 endpoint 级权限校验。
# 前置：./bin/dev-up.sh + ./bin/dev-backend.sh 运行中。
#
# 期望：
#   - admin (COMPANY_ADMIN): /admin/users 200, /admin/users/1/impersonate 403,
#     /admin/audit-log 200, /admin/tenant/datasource 403, /admin/role POST 403,
#     /org/1/dingtalk-config 403, /store 200
#   - employee (EMPLOYEE 单角色): /admin/* 全 403, /store /product 200
#
# Setup（一次性）：
#   1. 设 admin 密码（默认 V3 seed admin123；如已改请 export ADMIN_PWD=xxx）
#   2. dev 环境给某 EMPLOYEE 用户临时设密码用于登录测试；测完会清
#
# 失败条件：任一断言不符合期望 → exit 1。
set -e
cd "$(dirname "$0")/.."

API="http://localhost:8080/api"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PWD="${ADMIN_PWD:-admin123}"
EMP_USER_ID="${EMP_USER_ID:-4}"           # zz / EMPLOYEE 测试账号
EMP_TEMP_PWD="${EMP_TEMP_PWD:-rbac-smoke-pwd-$$}"
DOCKER_DB="${DOCKER_DB:-shopify-hub-mysql}"
DOCKER_REDIS="${DOCKER_REDIS:-shopify-hub-redis}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YEL='\033[0;33m'
NC='\033[0m'

PASS=0
FAIL=0

assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo -e "${GREEN}✓${NC} $label → HTTP $actual"
    PASS=$((PASS+1))
  else
    echo -e "${RED}✗${NC} $label → expected $expected got $actual"
    FAIL=$((FAIL+1))
  fi
}

call_status() {
  local method="$1" path="$2" token="$3" body="${4:-}"
  if [ -n "$body" ]; then
    curl -sS -o /dev/null -w "%{http_code}" -X "$method" "$API$path" \
      -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "$body"
  else
    curl -sS -o /dev/null -w "%{http_code}" -X "$method" "$API$path" \
      -H "Authorization: Bearer $token"
  fi
}

login() {
  local user="$1" pwd="$2"
  curl -fsS -X POST "$API/auth/login" -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$pwd\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['accessToken'])"
}

echo ">>> 0) 健康检查"
curl -fs "$API/health" >/dev/null || { echo -e "${RED}backend 未运行${NC}"; exit 1; }

echo ""
echo ">>> 1) admin 登录 ($ADMIN_USER)"
docker exec "$DOCKER_REDIS" redis-cli DEL "auth:fail:$ADMIN_USER" >/dev/null 2>&1 || true
ADMIN_TOKEN=$(login "$ADMIN_USER" "$ADMIN_PWD")
[ -n "$ADMIN_TOKEN" ] || { echo -e "${RED}admin 登录失败 — 改 export ADMIN_PWD${NC}"; exit 1; }
echo -e "${GREEN}admin token 拿到${NC}"

echo ""
echo ">>> 2) admin (COMPANY_ADMIN) endpoint 矩阵"
assert_status "GET /admin/users (USER:READ)"          200 "$(call_status GET /admin/users "$ADMIN_TOKEN")"
assert_status "GET /admin/role (ROLE:READ)"           200 "$(call_status GET /admin/role "$ADMIN_TOKEN")"
assert_status "GET /admin/audit-log (AUDIT:READ)"     200 "$(call_status GET /admin/audit-log "$ADMIN_TOKEN")"
assert_status "GET /admin/notification-log"           200 "$(call_status GET /admin/notification-log "$ADMIN_TOKEN")"
assert_status "GET /admin/tenant/datasource"          403 "$(call_status GET /admin/tenant/datasource "$ADMIN_TOKEN")"
assert_status "GET /admin/ops/backup-status"          403 "$(call_status GET /admin/ops/backup-status "$ADMIN_TOKEN")"
assert_status "POST /admin/users/1/impersonate"       403 "$(call_status POST /admin/users/1/impersonate "$ADMIN_TOKEN")"
assert_status "POST /admin/role"                      403 "$(call_status POST /admin/role "$ADMIN_TOKEN" '{"code":"X","name":"X"}')"
assert_status "GET /org/1/dingtalk-config"            403 "$(call_status GET /org/1/dingtalk-config "$ADMIN_TOKEN")"
assert_status "GET /cross-auth"                       200 "$(call_status GET /cross-auth "$ADMIN_TOKEN")"
assert_status "GET /store"                            200 "$(call_status GET /store "$ADMIN_TOKEN")"
assert_status "GET /product"                          200 "$(call_status GET /product "$ADMIN_TOKEN")"

echo ""
echo ">>> 3) 临时给 user_id=$EMP_USER_ID (EMPLOYEE) 设密码 → 登录测反向"
# 临时改 password_hash + clear fail counter
HASH='$2b$12$0P8qp12yx8c51tD.gn9mHegGdbGccahMmyudzah5SBaLGK839fDRO'  # admin123 BCrypt
TEMP_SQL=$(mktemp)
trap 'rm -f $TEMP_SQL' EXIT
cat > "$TEMP_SQL" <<EOF
SELECT @uname := username FROM sys_user WHERE id = $EMP_USER_ID;
SELECT @oldhash := password_hash FROM sys_user WHERE id = $EMP_USER_ID;
UPDATE sys_user SET password_hash='$HASH', password_must_change=0 WHERE id=$EMP_USER_ID;
EOF
EMP_USER=$(docker exec -i "$DOCKER_DB" mysql -uroot -proot platform -Bse "SELECT username FROM sys_user WHERE id=$EMP_USER_ID;" 2>/dev/null)
[ -n "$EMP_USER" ] || { echo -e "${RED}EMP_USER_ID=$EMP_USER_ID 不存在${NC}"; exit 1; }
docker exec -i "$DOCKER_DB" mysql -uroot -proot platform < "$TEMP_SQL" 2>&1 | { grep -v Warning || true; } >/dev/null
docker exec "$DOCKER_REDIS" redis-cli DEL "auth:fail:$EMP_USER" >/dev/null 2>&1 || true

# 清缓存确保新 user_role / perm 生效（不过 V34 之后这些用户已经有 EMPLOYEE 行了）
docker exec "$DOCKER_REDIS" redis-cli --raw KEYS "cache:rbac:user:$EMP_USER_ID:*" 2>/dev/null \
  | xargs -r docker exec -i "$DOCKER_REDIS" redis-cli DEL >/dev/null 2>&1 || true

EMP_TOKEN=$(login "$EMP_USER" "admin123")
[ -n "$EMP_TOKEN" ] || { echo -e "${RED}employee 登录失败${NC}"; exit 1; }
echo -e "${GREEN}employee ($EMP_USER) token 拿到${NC}"

echo ""
echo ">>> 4) employee (EMPLOYEE) endpoint 矩阵 — 期望 admin 路径全 403"
assert_status "GET /admin/users"             403 "$(call_status GET /admin/users "$EMP_TOKEN")"
assert_status "GET /admin/role"              403 "$(call_status GET /admin/role "$EMP_TOKEN")"
assert_status "GET /admin/audit-log"         403 "$(call_status GET /admin/audit-log "$EMP_TOKEN")"
assert_status "GET /admin/tenant/datasource" 403 "$(call_status GET /admin/tenant/datasource "$EMP_TOKEN")"
assert_status "GET /admin/ops/backup-status" 403 "$(call_status GET /admin/ops/backup-status "$EMP_TOKEN")"
assert_status "POST /admin/users/1/impersonate" 403 "$(call_status POST /admin/users/1/impersonate "$EMP_TOKEN")"
assert_status "POST /admin/role"             403 "$(call_status POST /admin/role "$EMP_TOKEN" '{"code":"X","name":"X"}')"
assert_status "GET /org/1/dingtalk-config"   403 "$(call_status GET /org/1/dingtalk-config "$EMP_TOKEN")"
assert_status "GET /cross-auth"              403 "$(call_status GET /cross-auth "$EMP_TOKEN")"
assert_status "GET /admin/notification-log"  403 "$(call_status GET /admin/notification-log "$EMP_TOKEN")"
echo "---"
echo "    业务路径 EMPLOYEE 应该可以读："
assert_status "GET /store"                   200 "$(call_status GET /store "$EMP_TOKEN")"
assert_status "GET /product"                 200 "$(call_status GET /product "$EMP_TOKEN")"

echo ""
echo ">>> 5) 清理：恢复 user_id=$EMP_USER_ID 的 password_hash 到原值"
cat > "$TEMP_SQL" <<EOF
UPDATE sys_user SET password_hash = NULL WHERE id = $EMP_USER_ID;
EOF
docker exec -i "$DOCKER_DB" mysql -uroot -proot platform < "$TEMP_SQL" 2>&1 | { grep -v Warning || true; } >/dev/null

echo ""
echo "============================================"
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}✓ 全部通过 ($PASS/$((PASS+FAIL)))${NC}"
else
  echo -e "${RED}✗ $FAIL 个失败 / $((PASS+FAIL)) 个总用例${NC}"
  exit 1
fi
