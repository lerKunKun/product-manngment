#!/usr/bin/env bash
# ============================================================================
# build-artifacts.sh — 在 CI / 工作机本地打三套构件供生产部署使用
#
# 产出（默认 /tmp/shopifyhub-artifacts/）：
#   - backend-api.jar         （Spring Boot fat jar）
#   - frontend.tar.gz         （Next.js standalone：server.js + .next/standalone + .next/static + public）
#   - asset-worker.tar.gz     （Python 源码 + requirements.txt，目标节点重建 venv）
#
# 用法：
#   bash ops/deploy/build-artifacts.sh
#   ARTIFACTS_DIR=/path bash ops/deploy/build-artifacts.sh
#   COMPONENT=backend bash ops/deploy/build-artifacts.sh    # 只打一个
#
# 推送到节点：
#   scp /tmp/shopifyhub-artifacts/*.{jar,tar.gz} ops@10.88.0.10:/tmp/shopifyhub-artifacts/
#   ssh ops@10.88.0.10 'sudo bash /opt/shopifyhub/src/ops/bootstrap/04-deploy-stack.sh a'
# ============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/tmp/shopifyhub-artifacts}"
COMPONENT="${COMPONENT:-all}"

mkdir -p "$ARTIFACTS_DIR"
echo "构件目录：$ARTIFACTS_DIR"

build_backend() {
  echo ">>> 打 backend jar..."
  pushd "$REPO_ROOT/backend-api" >/dev/null
  : "${JAVA_HOME:?需要 JDK 21；export JAVA_HOME=/path/to/jdk21}"
  mvn -q -DskipTests clean package
  local jar
  jar=$(ls -t target/backend-api-*.jar | head -n1)
  cp "$jar" "$ARTIFACTS_DIR/backend-api.jar"
  echo "✓ $ARTIFACTS_DIR/backend-api.jar ($(du -h "$ARTIFACTS_DIR/backend-api.jar" | cut -f1))"
  popd >/dev/null
}

build_frontend() {
  echo ">>> 打 frontend standalone..."
  pushd "$REPO_ROOT/frontend-admin" >/dev/null
  pnpm install --frozen-lockfile
  pnpm build
  # 组装 standalone 包：standalone/ + .next/static + public（next 官方文档要求）
  local stage
  stage=$(mktemp -d)
  cp -r .next/standalone/. "$stage/"
  mkdir -p "$stage/.next"
  cp -r .next/static "$stage/.next/static"
  if [[ -d public ]]; then cp -r public "$stage/public"; fi
  tar czf "$ARTIFACTS_DIR/frontend.tar.gz" -C "$stage" .
  rm -rf "$stage"
  echo "✓ $ARTIFACTS_DIR/frontend.tar.gz ($(du -h "$ARTIFACTS_DIR/frontend.tar.gz" | cut -f1))"
  popd >/dev/null
}

build_worker() {
  echo ">>> 打 asset-worker 源码包..."
  # 不打 venv（目标 OS 可能不同）；只带源码，目标节点重建 venv
  tar czf "$ARTIFACTS_DIR/asset-worker.tar.gz" \
    -C "$REPO_ROOT" \
    --exclude='asset-worker/.venv' \
    --exclude='asset-worker/__pycache__' \
    --exclude='asset-worker/**/__pycache__' \
    --exclude='asset-worker/.pytest_cache' \
    --exclude='asset-worker/tests' \
    asset-worker
  echo "✓ $ARTIFACTS_DIR/asset-worker.tar.gz ($(du -h "$ARTIFACTS_DIR/asset-worker.tar.gz" | cut -f1))"
}

case "$COMPONENT" in
  all)        build_backend; build_frontend; build_worker ;;
  backend)    build_backend ;;
  frontend)   build_frontend ;;
  worker)     build_worker ;;
  *)
    echo "未知 COMPONENT=$COMPONENT（支持 all/backend/frontend/worker）" >&2
    exit 2
    ;;
esac

echo ""
echo "=== 构件清单 ==="
ls -lh "$ARTIFACTS_DIR"
