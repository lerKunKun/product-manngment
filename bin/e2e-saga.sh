#!/usr/bin/env bash
# Wave 3 W3-NEW-12 saga end-to-end smoke test.
# Boots worker (dry-run) + backend, seeds data, walks saga from INIT through as many steps
# as are available, verifies each transition + ctx outputs, prints PASS/FAIL summary.
#
# Usage:   ./bin/e2e-saga.sh
# Prereq:  ./bin/dev-up.sh   (docker compose services)
# Exits 0 on full pass (PASS + SKIPPED), 1 on any FAIL. SKIPPED steps don't fail the run.
#
# Endpoints exercised (today, 2026-05-02):
#   POST /api/saga/start                        — Day 1
#   POST /api/saga/{id}/dev-mock-auth           — Day 2
#   POST /api/saga/{id}/step/run-media          — Day 3
#   POST /api/saga/{id}/step/run-collections    — Day 3
#   POST /api/saga/{id}/step/run-products       — Day 4
#   POST /api/saga/{id}/step/run-guide          — Day 5 D2 (probe; SKIP if 404)
#   POST /api/saga/{id}/step/run-theme          — Day 5 D1 (probe; SKIP if 404)
#   POST /api/saga/{id}/advance                 — generic dev fallthrough

set -uo pipefail
cd "$(dirname "$0")/.."

# ---- color output ----
RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; CYAN=$'\e[36m'; RESET=$'\e[0m'

PASS=0; FAIL=0; SKIP=0
RESULTS=()

# ---- state for cleanup (set as we go; default safe values) ----
STORE_ID=""
PRODUCT_ID=""
TEMPLATE_ID=""
TASK_ID=""
WORKER_PID=""
BACKEND_PID=""
CLEANED=0

step_pass() { PASS=$((PASS+1)); RESULTS+=("${GREEN}PASS${RESET} $1"); echo "${GREEN}PASS${RESET} $1"; }
step_fail() { FAIL=$((FAIL+1)); RESULTS+=("${RED}FAIL${RESET} $1: $2"); echo "${RED}FAIL${RESET} $1: $2"; }
step_skip() { SKIP=$((SKIP+1)); RESULTS+=("${YELLOW}SKIP${RESET} $1: $2"); echo "${YELLOW}SKIP${RESET} $1: $2"; }

# ---- utilities ----
mysql_exec() {
  # quietly run sql, ignore warnings about password
  docker exec -i shopify-hub-mysql mysql -uroot -proot "$@" 2>/dev/null
}

# Test endpoint existence by POSTing empty body and checking for 404.
# 200/400/422/500 => handler exists (just bad args).
endpoint_exists() {
  local url=$1
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$url" -H 'content-type: application/json' -d '{}' 2>/dev/null)
  [ "$code" != "404" ] && [ "$code" != "000" ]
}

# Extract `data.step` from /api/saga/{id} response.
saga_step() {
  local task_id=$1
  curl -sf "http://localhost:8080/api/saga/$task_id" 2>/dev/null \
    | python3 -c "import json,sys;
try:
  d=json.load(sys.stdin)
  print(d.get('data',{}).get('step') or '')
except Exception:
  print('')" 2>/dev/null
}

assert_step() {
  local task_id=$1; local expected=$2; local label=$3
  local actual
  actual=$(saga_step "$task_id")
  if [ "$actual" = "$expected" ]; then
    step_pass "$label (step=$actual)"
  else
    step_fail "$label" "expected step=$expected got step='$actual'"
  fi
}

# ---- cleanup (idempotent) ----
finish() {
  if [ "$CLEANED" = "1" ]; then return 0; fi
  CLEANED=1
  echo "${CYAN}>>> cleanup${RESET}"

  # Stop processes (ignore failures)
  if [ -n "$BACKEND_PID" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
  if [ -n "$WORKER_PID" ]; then kill "$WORKER_PID" 2>/dev/null || true; fi
  pkill -f spring-boot:run 2>/dev/null || true
  pkill -f 'uvicorn app.main:app' 2>/dev/null || true
  sleep 2

  # Clean seeded rows. Use the natural keys (myshopify_domain / handle / code) so reruns
  # work even if STORE_ID etc. weren't captured (e.g. seed step itself failed).
  local cleanup_sql
  cleanup_sql=$(cat <<'SQL'
USE platform;
-- task rows by store domain (saga task references store_id)
DELETE FROM task
  WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com')
     OR (type='NEW_STORE_SAGA' AND payload_json LIKE '%e2e-saga.myshopify.com%');
DELETE FROM store_product_variant
  WHERE store_product_id IN (
    SELECT id FROM store_product
      WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com')
  );
DELETE FROM store_product
  WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com');
DELETE FROM push_conflict
  WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com');
DELETE FROM product_variant
  WHERE product_id IN (SELECT id FROM product WHERE handle='e2e-saga-product');
DELETE FROM product WHERE handle='e2e-saga-product';
DELETE FROM base_template_version
  WHERE template_id IN (SELECT id FROM base_template WHERE code='e2e-tpl');
UPDATE base_template SET default_template_version_id=NULL WHERE code='e2e-tpl';
DELETE FROM base_template WHERE code='e2e-tpl';
DELETE FROM guide_doc WHERE code LIKE 'E2E_%';
DELETE FROM store WHERE myshopify_domain='e2e-saga.myshopify.com';
SQL
)
  mysql_exec -e "$cleanup_sql" || true
  docker exec shopify-hub-redis redis-cli flushdb >/dev/null 2>&1 || true
}

trap finish EXIT INT TERM

# ---- 1) Prereqs ----
echo "${CYAN}>>> 1) Prereqs: docker services${RESET}"
required_services="shopify-hub-mysql shopify-hub-redis shopify-hub-rabbitmq shopify-hub-minio"
running=$(docker ps --format '{{.Names}}' 2>/dev/null || true)
prereq_fail=0
for svc in $required_services; do
  if echo "$running" | grep -q "^${svc}$"; then
    step_pass "$svc running"
  else
    step_fail "$svc" "not running (run ./bin/dev-up.sh first)"
    prereq_fail=1
  fi
done
if [ "$prereq_fail" = "1" ]; then
  echo "${RED}prereq failed, aborting${RESET}"
  # Summary still useful
  for r in "${RESULTS[@]}"; do echo "  $r"; done
  exit 1
fi

# Ensure no stale processes on our ports
if lsof -ti :8080 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "${YELLOW}port 8080 occupied, killing existing backend${RESET}"
  pkill -f spring-boot:run 2>/dev/null || true
  sleep 3
fi
if lsof -ti :8765 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "${YELLOW}port 8765 occupied, killing existing worker${RESET}"
  pkill -f 'uvicorn app.main:app' 2>/dev/null || true
  sleep 2
fi

# Pre-cleanup any stale e2e rows from a previous failed run
finish_pre_sql=$(cat <<'SQL'
USE platform;
DELETE FROM task
  WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com')
     OR (type='NEW_STORE_SAGA' AND payload_json LIKE '%e2e-saga.myshopify.com%');
DELETE FROM store_product_variant
  WHERE store_product_id IN (
    SELECT id FROM store_product
      WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com')
  );
DELETE FROM store_product
  WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com');
DELETE FROM push_conflict
  WHERE store_id IN (SELECT id FROM store WHERE myshopify_domain='e2e-saga.myshopify.com');
DELETE FROM product_variant
  WHERE product_id IN (SELECT id FROM product WHERE handle='e2e-saga-product');
DELETE FROM product WHERE handle='e2e-saga-product';
DELETE FROM base_template_version
  WHERE template_id IN (SELECT id FROM base_template WHERE code='e2e-tpl');
UPDATE base_template SET default_template_version_id=NULL WHERE code='e2e-tpl';
DELETE FROM base_template WHERE code='e2e-tpl';
DELETE FROM guide_doc WHERE code LIKE 'E2E_%';
DELETE FROM store WHERE myshopify_domain='e2e-saga.myshopify.com';
SQL
)
mysql_exec -e "$finish_pre_sql" >/dev/null 2>&1 || true

# ---- 2) Boot worker (dry-run) ----
echo "${CYAN}>>> 2) Boot worker (dry-run)${RESET}"
if [ ! -f asset-worker/.venv/bin/activate ]; then
  step_fail "worker venv" "asset-worker/.venv missing — run `cd asset-worker && python3 -m venv .venv && pip install -r requirements.txt`"
  exit 1
fi

(
  cd asset-worker
  # shellcheck disable=SC1091
  source .venv/bin/activate
  WORKER_DRY_RUN=true \
  R2_ENDPOINT=http://localhost:9000 \
  R2_ACCESS_KEY_ID=minioadmin \
  R2_SECRET_ACCESS_KEY=minioadmin \
  R2_BUCKET=shopify-assets-dev \
  exec python -m uvicorn app.main:app --port 8765 >/tmp/e2e-worker.log 2>&1
) &
WORKER_PID=$!

ok=0
for i in $(seq 1 30); do
  if curl -sf http://localhost:8765/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" = "1" ]; then
  step_pass "worker up (port 8765)"
else
  step_fail "worker boot" "30s timeout — see /tmp/e2e-worker.log"
  exit 1
fi

# ---- 3) Boot backend ----
echo "${CYAN}>>> 3) Boot backend${RESET}"
SHOPIFY_WORKER_BASE_URL=http://localhost:8765 \
R2_ENDPOINT=http://localhost:9000 \
R2_ACCESS_KEY_ID=minioadmin \
R2_SECRET_ACCESS_KEY=minioadmin \
R2_BUCKET=shopify-assets-dev \
bash bin/dev-backend.sh >/tmp/e2e-backend.log 2>&1 &
BACKEND_PID=$!

ok=0
for i in $(seq 1 90); do
  if curl -sf http://localhost:8080/api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [ "$ok" = "1" ]; then
  step_pass "backend up (port 8080)"
else
  step_fail "backend boot" "180s timeout — see /tmp/e2e-backend.log"
  exit 1
fi

# ---- 4) Seed test data ----
echo "${CYAN}>>> 4) Seed test data${RESET}"
SQL_SEED=$(cat <<'SQL'
USE platform;
INSERT INTO store (tenant_id, dept_id, myshopify_domain, brand_name, token_type, encrypted_access_token, status, is_dev_store, is_partner_collab, created_at, updated_at)
  VALUES (1, NULL, 'e2e-saga.myshopify.com', 'E2E Saga', 'custom_app', 'enc:dummy', 'ACTIVE', 1, 1, NOW(), NOW());
SET @sid := LAST_INSERT_ID();
INSERT INTO product (owner_company_id, handle, title, vendor, status, created_at, updated_at)
  VALUES (1, 'e2e-saga-product', 'E2E Saga Product', 'V', 'active', NOW(), NOW());
SET @pid := LAST_INSERT_ID();
INSERT INTO product_variant (product_id, sku, price, position) VALUES (@pid, 'E2E-V1', 9.99, 1);
INSERT INTO base_template (code, name, status, default_template_version_id)
  VALUES ('e2e-tpl', 'E2E Template', 'PUBLISHED', NULL);
SET @tid := LAST_INSERT_ID();
INSERT INTO base_template_version (template_id, version, zip_r2_key, status, default_replace_rules_json)
  VALUES (@tid, '1.0.0', 'templates/e2e/theme.zip', 'PUBLISHED', '{"BIOU":"ACME"}');
SET @vid := LAST_INSERT_ID();
UPDATE base_template SET default_template_version_id=@vid WHERE id=@tid;
INSERT INTO guide_doc (code, title, category, body_html, show_in_saga_step, status)
  VALUES ('E2E_GUIDE_MENU', 'E2E menu guide', 'menu', '<p>foo</p>', 'GUIDE', 'PUBLISHED');
SELECT @sid, @pid, @tid, @vid;
SQL
)

SEED=$(mysql_exec -sN -e "$SQL_SEED" | tail -1)
STORE_ID=$(echo "$SEED" | awk '{print $1}')
PRODUCT_ID=$(echo "$SEED" | awk '{print $2}')
TEMPLATE_ID=$(echo "$SEED" | awk '{print $3}')

if [ -z "${STORE_ID:-}" ] || [ "$STORE_ID" = "NULL" ] || ! [[ "$STORE_ID" =~ ^[0-9]+$ ]]; then
  step_fail "seed" "row ids not captured (got '$SEED')"
  exit 1
fi
step_pass "seed store=$STORE_ID product=$PRODUCT_ID template=$TEMPLATE_ID"

# ---- 5) Walk the saga ----
echo "${CYAN}>>> 5) Walk saga${RESET}"

# 5a: start
START_RESP=$(curl -sf -X POST 'http://localhost:8080/api/saga/start' \
  -H 'content-type: application/json' \
  -d "{\"tenantId\":1,\"triggeredBy\":1,\"templateId\":$TEMPLATE_ID,\"productIds\":[$PRODUCT_ID]}" 2>/dev/null || true)
TASK_ID=$(echo "$START_RESP" | python3 -c "import json,sys;
try:
  d=json.load(sys.stdin); print(d.get('data',{}).get('taskId') or '')
except Exception:
  print('')" 2>/dev/null)
if [ -n "$TASK_ID" ] && [[ "$TASK_ID" =~ ^[0-9]+$ ]]; then
  step_pass "saga start taskId=$TASK_ID"
else
  step_fail "saga start" "no taskId in response: $START_RESP"
  exit 1
fi
assert_step "$TASK_ID" "INIT" "INIT state"

# 5b: dev-mock-auth → AUTH_DONE
AUTH_RESP=$(curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/dev-mock-auth" \
  -H 'content-type: application/json' \
  -d '{"shopDomain":"e2e-saga.myshopify.com","accessToken":"shpat_e2e_dev"}' 2>/dev/null || true)
if [ -z "$AUTH_RESP" ]; then
  step_fail "dev-mock-auth call" "empty response (auth service may need shopify.dev-mock-oauth=true)"
else
  assert_step "$TASK_ID" "AUTH_DONE" "AUTH_DONE step"
fi

# 5c: run-media → MEDIA
curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/step/run-media" >/dev/null 2>&1 || true
assert_step "$TASK_ID" "MEDIA" "MEDIA step"

# 5d: run-collections → COLLECTIONS
curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/step/run-collections" >/dev/null 2>&1 || true
assert_step "$TASK_ID" "COLLECTIONS" "COLLECTIONS step"

# 5e: products step.
# 清技术债 #12 已修复：SagaService.start() 会自动 merge initialPayload 的
# templateId / productIds → ctx，AUTH_DONE 步会填 storeId / shopDomain。
# 此处不再需要 SQL workaround。如需排查请取消下行注释复活旧 JSON_SET。
# mysql_exec -e "USE platform; UPDATE task SET saga_data_json = JSON_SET(COALESCE(saga_data_json,'{}'), '\$.productIdsToPush', JSON_ARRAY($PRODUCT_ID), '\$.storeId', $STORE_ID, '\$.templateId', $TEMPLATE_ID, '\$.shopDomain', 'e2e-saga.myshopify.com') WHERE id=$TASK_ID;" >/dev/null 2>&1 || true

curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/step/run-products" >/dev/null 2>&1 || true
assert_step "$TASK_ID" "PRODUCTS" "PRODUCTS step"

# 5f: run-guide (Day 5 D2). Probe first.
if endpoint_exists "http://localhost:8080/api/saga/$TASK_ID/step/run-guide"; then
  curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/step/run-guide" >/dev/null 2>&1 || true
  assert_step "$TASK_ID" "GUIDE" "GUIDE step"
else
  step_skip "GUIDE step" "endpoint not implemented yet (W3-NEW-08)"
fi

# 5g: run-theme (Day 5 D1). Probe first.
if endpoint_exists "http://localhost:8080/api/saga/$TASK_ID/step/run-theme"; then
  curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/step/run-theme" >/dev/null 2>&1 || true
  assert_step "$TASK_ID" "THEME" "THEME step"
else
  step_skip "THEME step" "endpoint not implemented yet (W3-NEW-06)"
fi

# 5h: PUBLISH + SUCCESS via generic /advance — only meaningful if we reached THEME.
CURRENT=$(saga_step "$TASK_ID")
case "$CURRENT" in
  THEME)
    curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/advance" >/dev/null 2>&1 || true
    assert_step "$TASK_ID" "PUBLISH" "PUBLISH step (via /advance)"
    curl -sf -X POST "http://localhost:8080/api/saga/$TASK_ID/advance" >/dev/null 2>&1 || true
    assert_step "$TASK_ID" "SUCCESS" "SUCCESS terminal"
    ;;
  *)
    step_skip "PUBLISH/SUCCESS" "prerequisites not at THEME (current='$CURRENT')"
    ;;
esac

# Optional: check final task row & ctx outputs
FINAL_JSON=$(curl -sf "http://localhost:8080/api/saga/$TASK_ID" 2>/dev/null || true)
if [ -n "$FINAL_JSON" ]; then
  HAS_CTX=$(echo "$FINAL_JSON" | python3 -c "import json,sys;
try:
  d=json.load(sys.stdin).get('data',{})
  print('1' if d.get('context') else '0')
except Exception:
  print('0')" 2>/dev/null)
  if [ "$HAS_CTX" = "1" ]; then
    step_pass "final ctx populated"
  else
    step_skip "final ctx" "no context returned"
  fi
fi

# ---- 6) Cleanup happens on EXIT trap ----

# ---- 7) Summary ----
finish
echo "${CYAN}=========================================${RESET}"
echo "${CYAN}E2E SAGA SUMMARY${RESET}"
echo "${CYAN}=========================================${RESET}"
for r in "${RESULTS[@]}"; do echo "  $r"; done
echo "${CYAN}=========================================${RESET}"
echo "${GREEN}PASS: $PASS${RESET}  ${RED}FAIL: $FAIL${RESET}  ${YELLOW}SKIP: $SKIP${RESET}"

if [ "$FAIL" -gt 0 ]; then exit 1; fi
exit 0
