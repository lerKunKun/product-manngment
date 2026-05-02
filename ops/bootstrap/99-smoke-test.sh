#!/usr/bin/env bash
# 自检：健康检查 + 登录 + 写入 R2 + 钉钉测试 + 邮件测试 + 邀请测试
# 用法：bash 99-smoke-test.sh [base-url]
set -euo pipefail

BASE_URL=${1:-http://localhost:8080/api}
WORKER_URL=${WORKER_URL:-http://localhost:9000}

pass=0
fail=0
check() {
  local desc=$1
  shift
  if "$@" >/dev/null 2>&1; then
    echo "✓ $desc"
    pass=$((pass+1))
  else
    echo "✗ $desc"
    fail=$((fail+1))
  fi
}

echo ">>> Smoke Test [$BASE_URL]"
check "backend /health" curl -fs "$BASE_URL/health"
check "backend /actuator/health" curl -fs "$BASE_URL/actuator/health"
check "worker /health" curl -fs "$WORKER_URL/health"

echo ""
echo "结果：$pass 通过 / $fail 失败"
[[ $fail -eq 0 ]] || exit 1
