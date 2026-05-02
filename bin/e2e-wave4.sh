#!/usr/bin/env bash
# Wave 4 全功能 e2e 验收脚本（W4-RLS-03 自动化版 / Sprint5 T18）
# 对应《ops/release/wave4-regression-e2e.md》§1..§3 G1-G5 全覆盖
#
# Usage:   ./bin/e2e-wave4.sh
# Prereq:  ./bin/dev-up.sh + ./bin/dev-backend.sh 已运行
# Exits:   退出码 = FAIL 数量（0 = 全过）
# Compat:  macOS bash 3.2 + Linux bash 4+

set -uo pipefail
cd "$(dirname "$0")/.."

# ---- color ----
RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; CYAN=$'\e[36m'; RESET=$'\e[0m'

API="${API:-http://localhost:8080/api}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3307}"
MYSQL_USER="${MYSQL_USER:-shopifyhub}"
MYSQL_DB="${MYSQL_DB:-shopifyhub}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-shopifyhub}"

PASS=0; FAIL=0
RESULTS=()

# ---- helpers ----
step() {
    local name="$1"; shift
    if "$@" >/tmp/wave4-out 2>&1; then
        PASS=$((PASS+1))
        echo "  ${GREEN}✅${RESET} $name"
        RESULTS+=("${GREEN}PASS${RESET} $name")
    else
        FAIL=$((FAIL+1))
        echo "  ${RED}❌${RESET} $name"
        if [ -s /tmp/wave4-out ]; then
            echo "  --- output:"
            sed 's/^/      /' /tmp/wave4-out
        fi
        RESULTS+=("${RED}FAIL${RESET} $name")
    fi
}

api() {
    curl -fsS "$@"
}

mysql_q() {
    mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" "-p${MYSQL_PASSWORD}" -N -e "$1" "$MYSQL_DB" 2>/dev/null
}

table_exists() {
    local t="$1"
    mysql_q "SELECT 1 FROM information_schema.tables WHERE table_schema='${MYSQL_DB}' AND table_name='${t}' LIMIT 1" | grep -q 1
}

metric_exists() {
    api "$API/actuator/prometheus" | grep -q "$1"
}

# ---- 0. 登录 ----
echo "${CYAN}>>> 0. 登录 admin/admin123${RESET}"
LOGIN=$(curl -fsS -X POST "$API/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"admin","password":"admin123"}' 2>/dev/null || true)

TOKEN=""
if [ -n "$LOGIN" ]; then
    TOKEN=$(echo "$LOGIN" | python3 -c "import json,sys
try:
    d=json.load(sys.stdin); print(d.get('data',{}).get('accessToken') or '')
except Exception:
    print('')" 2>/dev/null)
fi

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
    echo "  ${YELLOW}⚠️  登录失败（backend 未启动？继续跑可跑的检查）${RESET}"
    TOKEN=""
else
    echo "  ${GREEN}✅${RESET} 登录成功，token len=${#TOKEN}"
fi
AUTH_HEADER="Authorization: Bearer $TOKEN"

# ---- §1. Flyway V21..V24 表存在 ----
echo ""
echo "${CYAN}>>> §1. Flyway V21..V24 表存在${RESET}"
step "approval_flow 表存在 (V21)"        table_exists approval_flow
step "notification_event_def 表存在 (V22)" table_exists notification_event_def
step "inapp_message 表存在 (V23)"          table_exists inapp_message
step "audit_archive_log 表存在 (V24)"      table_exists audit_archive_log

# ---- §2. G1 审批中心 e2e ----
echo ""
echo "${CYAN}>>> §2. G1 审批中心 e2e${RESET}"

FLOW=""
if [ -n "$TOKEN" ]; then
    SUBMIT=$(curl -fsS -X POST "$API/approval" \
        -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
        -d '{"type":"PRODUCT_ACCESS","payload":{"productId":1,"reason":"e2e wave4 test"},"approverId":1}' 2>/dev/null || true)
    FLOW=$(echo "$SUBMIT" | python3 -c "import json,sys
try:
    d=json.load(sys.stdin); print(d.get('data',{}).get('id') or '')
except Exception:
    print('')" 2>/dev/null)
fi

step "提交 PRODUCT_ACCESS 申请 (POST /approval)" \
    bash -c "[ -n '$FLOW' ] && [ '$FLOW' != 'null' ]"

step "待办列表含该 flow (GET /approval/pending/me)" \
    bash -c "curl -fsS '$API/approval/pending/me' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); arr=d.get(\"data\",[]) or []
ids=[r.get(\"id\") for r in arr]
sys.exit(0 if $FLOW in ids else 1)' 2>/dev/null"

step "通过审批 (POST /approval/{id}/approve)" \
    bash -c "curl -fsS -X POST '$API/approval/$FLOW/approve' -H '$AUTH_HEADER' -H 'Content-Type: application/json' -d '{\"comment\":\"OK\"}' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

step "状态 = APPROVED (GET /approval/{id})" \
    bash -c "curl -fsS '$API/approval/$FLOW' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); st=(d.get(\"data\",{}) or {}).get(\"status\")
sys.exit(0 if st==\"APPROVED\" else 1)' 2>/dev/null"

step "时间线 ≥ 2 行 (SUBMIT + APPROVE)" \
    bash -c "[ -n '$FLOW' ] && n=\$(mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER -p${MYSQL_PASSWORD} -N -e 'SELECT COUNT(*) FROM approval_log WHERE flow_id=$FLOW' $MYSQL_DB 2>/dev/null) && [ -n \"\$n\" ] && [ \"\$n\" -ge 2 ]"

# ---- §3. G2 通知订阅 ----
echo ""
echo "${CYAN}>>> §3. G2 通知订阅${RESET}"

step "事件定义 ≥ 16 (GET /notification/events)" \
    bash -c "curl -fsS '$API/notification/events' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); data=d.get(\"data\")
n = sum(len(v) for v in data.values()) if isinstance(data, dict) else (len(data) if isinstance(data, list) else 0)
sys.exit(0 if n>=16 else 1)' 2>/dev/null"

step "我的订阅可拉 (GET /notification/subscriptions/me)" \
    bash -c "curl -fsS '$API/notification/subscriptions/me' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

step "更新订阅 (PUT /notification/subscriptions/me)" \
    bash -c "curl -fsS -X PUT '$API/notification/subscriptions/me' -H '$AUTH_HEADER' -H 'Content-Type: application/json' -d '[{\"userId\":1,\"eventCode\":\"INVITATION_SENT\",\"channels\":\"EMAIL\",\"enabled\":true}]' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

# ---- §4. G3 邮件 + 站内信 + 密码重置 ----
echo ""
echo "${CYAN}>>> §4. G3 邮件 + 站内信 + 密码重置${RESET}"

step "密码重置请求 200 (POST /auth/password-reset/request)" \
    bash -c "curl -fsS -X POST '$API/auth/password-reset/request' -H 'Content-Type: application/json' -d '{\"email\":\"admin@example.com\"}' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

step "站内信列表可拉 (GET /notification/inapp)" \
    bash -c "curl -fsS '$API/notification/inapp' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

step "站内信 unread-count (GET /notification/inapp/unread-count)" \
    bash -c "curl -fsS '$API/notification/inapp/unread-count' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

# ---- §5. G4 审计归档 + 备份 ----
echo ""
echo "${CYAN}>>> §5. G4 审计归档 + 备份${RESET}"

step "audit-archive list (GET /admin/audit-archive)" \
    bash -c "curl -fsS '$API/admin/audit-archive' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

step "backup-status (GET /admin/ops/backup-status)" \
    bash -c "curl -fsS '$API/admin/ops/backup-status' -H '$AUTH_HEADER' | python3 -c 'import json,sys
d=json.load(sys.stdin); sys.exit(0 if d.get(\"code\")==0 else 1)' 2>/dev/null"

step "audit_log 行 ≥ 1 (操作触发审计)" \
    bash -c "n=\$(mysql -h $MYSQL_HOST -P $MYSQL_PORT -u $MYSQL_USER -p${MYSQL_PASSWORD} -N -e 'SELECT COUNT(*) FROM sys_audit_log' $MYSQL_DB 2>/dev/null); [ -n \"\$n\" ] && [ \"\$n\" -ge 1 ]"

# ---- §6. G5 监控 ----
echo ""
echo "${CYAN}>>> §6. G5 监控${RESET}"

# Prometheus rules（未启动跳过，不计 fail）
if curl -fsS -o /dev/null -m 2 http://localhost:9090/-/ready 2>/dev/null; then
    step "Prometheus rules 含 ops-alerts group" \
        bash -c "curl -fsS http://localhost:9090/api/v1/rules | python3 -c 'import json,sys
d=json.load(sys.stdin); names=[g.get(\"name\") for g in d.get(\"data\",{}).get(\"groups\",[])]
sys.exit(0 if \"ops-alerts\" in names else 1)' 2>/dev/null"
else
    echo "  ${YELLOW}⚠️  prometheus 未启动，跳过 ops-alerts 检查${RESET}"
fi

# /actuator/prometheus 6 个 metric
step "/actuator/prometheus 含 shopifyhub_notification_send_total"        metric_exists shopifyhub_notification_send_total
step "/actuator/prometheus 含 shopifyhub_r2_upload_total"                 metric_exists shopifyhub_r2_upload_total
step "/actuator/prometheus 含 shopifyhub_auth_login_total"                metric_exists shopifyhub_auth_login_total
step "/actuator/prometheus 含 shopifyhub_backup_last_success_seconds"     metric_exists shopifyhub_backup_last_success_seconds
step "/actuator/prometheus 含 shopifyhub_audit_archive_last_success_seconds" metric_exists shopifyhub_audit_archive_last_success_seconds
step "/actuator/prometheus 含 shopifyhub_approval_pending_max_age_seconds" metric_exists shopifyhub_approval_pending_max_age_seconds

# ---- §7. 跨公司授权 / 任务 / 角色 admin endpoint ----
echo ""
echo "${CYAN}>>> §7. 跨公司授权 / Admin endpoints${RESET}"

step "GET /cross-auth 200" \
    bash -c "curl -fsS -o /dev/null -w '%{http_code}' '$API/cross-auth' -H '$AUTH_HEADER' | grep -q '^200\$'"

step "GET /admin/notification-log 200" \
    bash -c "curl -fsS -o /dev/null -w '%{http_code}' '$API/admin/notification-log' -H '$AUTH_HEADER' | grep -q '^200\$'"

step "GET /admin/audit-log 200" \
    bash -c "curl -fsS -o /dev/null -w '%{http_code}' '$API/admin/audit-log' -H '$AUTH_HEADER' | grep -q '^200\$'"

step "GET /admin/role 200" \
    bash -c "curl -fsS -o /dev/null -w '%{http_code}' '$API/admin/role' -H '$AUTH_HEADER' | grep -q '^200\$'"

# ---- 汇总 ----
echo ""
echo "${CYAN}=========================================${RESET}"
echo "${CYAN}Wave 4 E2E SUMMARY${RESET}"
echo "${CYAN}=========================================${RESET}"
TOTAL=$((PASS+FAIL))
echo "  Total: $TOTAL    ${GREEN}PASS: $PASS${RESET}    ${RED}FAIL: $FAIL${RESET}"
echo "${CYAN}=========================================${RESET}"

exit $FAIL
