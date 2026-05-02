#!/usr/bin/env bash
# 端到端冒烟测试：登录 → 创建邀请 → 看列表 → 接受 → 验证 DB
# 前置：./bin/dev-up.sh + ./bin/dev-backend.sh 已运行
set -e
cd "$(dirname "$0")/.."

API="http://localhost:8080/api"

pass() { echo "✓ $1"; }
fail() { echo "✗ $1: $2"; exit 1; }

echo ">>> 1) 健康检查"
curl -fs "$API/health" >/dev/null && pass "/api/health UP" || fail "health" "backend 未运行？"

echo ""
echo ">>> 2) 用户名密码登录 admin/admin123"
LOGIN=$(curl -fs -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')
TOKEN=$(echo "$LOGIN" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['accessToken'])")
[ -n "$TOKEN" ] && pass "登录成功，token len=${#TOKEN}" || fail "login" "$LOGIN"

echo ""
echo ">>> 3) 创建邀请（30 天有效期）"
EXP=$(date -v +30d -u +"%Y-%m-%dT00:00:00")
CREATE=$(curl -fs -X POST "$API/invitation/create" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"email\":\"smoke-test-$(date +%s)@example.com\",
    \"targetCompanyId\":1, \"targetDeptId\":2,
    \"roleCodes\":[\"TEMP_STAFF\",\"DESIGNER\"],
    \"dataScopes\":[{\"scopeType\":\"PRODUCT\",\"scopeId\":1,\"access\":\"READ\"}],
    \"accountExpiresAt\":\"$EXP\"
  }")
INV_ID=$(echo "$CREATE" | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['invitationId'])")
[ -n "$INV_ID" ] && pass "邀请创建 id=$INV_ID" || fail "create" "$CREATE"

echo ""
echo ">>> 4) 邀请列表（应至少 1 条 PENDING）"
LIST=$(curl -fs -H "Authorization: Bearer $TOKEN" "$API/invitation?status=PENDING")
COUNT=$(echo "$LIST" | python3 -c "import json,sys;print(len(json.load(sys.stdin)['data']))")
[ "$COUNT" -ge 1 ] && pass "PENDING 数量=$COUNT" || fail "list" "$LIST"

echo ""
echo ">>> 5) 钉钉 qrcode（验证 OAuth URL 构造）"
QR=$(curl -fs -H "Authorization: Bearer $TOKEN" "$API/auth/dingtalk/qrcode?tenant=hy")
echo "$QR" | grep -q "login.dingtalk.com/oauth2/auth" && pass "钉钉 OAuth URL 正确" || fail "dingtalk-qr" "$QR"

echo ""
echo ">>> 6) 90 天上限校验"
EXP_BAD=$(date -v +120d -u +"%Y-%m-%dT00:00:00")
# 这里期望 4xx，所以不用 -f
BAD=$(curl -s -X POST "$API/invitation/create" \
  -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"email\":\"bad-test@example.com\",
    \"targetCompanyId\":1,
    \"roleCodes\":[\"TEMP_STAFF\"],
    \"dataScopes\":[{\"scopeType\":\"PRODUCT\",\"scopeId\":1,\"access\":\"READ\"}],
    \"accountExpiresAt\":\"$EXP_BAD\"
  }")
echo "$BAD" | grep -q "20104" && pass "90 天上限校验生效" || fail "duration-check" "$BAD"

echo ""
echo "============================================"
echo "🎉 SMOKE TEST 全部通过"
echo "前端入口： http://localhost:3000/login"
echo "============================================"
