#!/usr/bin/env bash
# ============================================================================
# 04-deploy-stack.sh — 按节点角色（a/b/c）部署应用栈
#
# 用法：
#   sudo bash 04-deploy-stack.sh a    # 节点 A：backend + frontend + nginx
#   sudo bash 04-deploy-stack.sh b    # 节点 B：asset-worker
#   sudo bash 04-deploy-stack.sh c    # 节点 C：监控 + CF Tunnel（占位指引）
#
# 前置：01–03 已跑过（docker / sysctl / wireguard）；mysql/redis/rabbitmq/java/python
#       已通过 README §3.4–3.7 / §4.3 安装到位。
# 本脚本只做：拷 systemd unit + 拷 nginx 配置 + 启服务（idempotent，重复跑不冲突）。
#
# 构件来源：CI 或工作机上跑 ops/deploy/build-artifacts.sh 产出，scp 到目标节点
#   /tmp/shopifyhub-artifacts/{backend-api.jar,frontend.tar.gz,asset-worker.tar.gz}
# 然后本脚本读这些文件部署。
# ============================================================================

set -euo pipefail

ROLE="${1:-}"
if [[ -z "$ROLE" ]]; then
  echo "用法：sudo bash 04-deploy-stack.sh <a|b|c>" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACTS_DIR="${ARTIFACTS_DIR:-/tmp/shopifyhub-artifacts}"
LOG_DIR="/var/log/shopifyhub"

ensure_app_user() {
  if ! id -u app >/dev/null 2>&1; then
    useradd -r -s /usr/sbin/nologin -d /opt/shopifyhub app
    echo "✓ 创建 app 用户"
  fi
  install -d -o app -g app -m 0755 "$LOG_DIR"
}

install_systemd_unit() {
  local unit_name="$1"
  local src="$REPO_ROOT/ops/deploy/systemd/${unit_name}"
  local dst="/etc/systemd/system/${unit_name}"
  if [[ ! -f "$src" ]]; then
    echo "✗ systemd unit 缺失：$src" >&2; exit 3
  fi
  install -m 0644 "$src" "$dst"
  echo "✓ 安装 $dst"
}

deploy_node_a() {
  echo ">>> 节点 A：backend + frontend + nginx"
  ensure_app_user

  install -d -o app -g app /opt/shopifyhub /opt/shopifyhub/data
  if [[ -f "$ARTIFACTS_DIR/backend-api.jar" ]]; then
    install -o app -g app -m 0644 "$ARTIFACTS_DIR/backend-api.jar" /opt/shopifyhub/backend-api.jar
    echo "✓ 部署 /opt/shopifyhub/backend-api.jar"
  else
    echo "⚠ 未找到 $ARTIFACTS_DIR/backend-api.jar，backend 不更新（systemd 仍然安装）"
  fi

  install -d -o app -g app /opt/shopifyhub/frontend
  if [[ -f "$ARTIFACTS_DIR/frontend.tar.gz" ]]; then
    tar xzf "$ARTIFACTS_DIR/frontend.tar.gz" -C /opt/shopifyhub/frontend
    chown -R app:app /opt/shopifyhub/frontend
    echo "✓ 部署 /opt/shopifyhub/frontend"
  else
    echo "⚠ 未找到 $ARTIFACTS_DIR/frontend.tar.gz，frontend 不更新"
  fi

  if [[ ! -f /opt/shopifyhub/.env ]]; then
    install -m 0600 -o app -g app "$REPO_ROOT/ops/deploy/env-templates/.env.node-a" /opt/shopifyhub/.env
    echo "✓ 生成 /opt/shopifyhub/.env（占位值，编辑后再 systemctl restart）"
    echo "  请填入实际密钥后再继续：sudo nano /opt/shopifyhub/.env"
  else
    echo "✓ /opt/shopifyhub/.env 已存在（保留旧值）"
  fi

  install_systemd_unit shopifyhub-backend.service
  install_systemd_unit shopifyhub-frontend.service

  install -d /etc/nginx/snippets
  install -m 0644 "$REPO_ROOT/ops/deploy/nginx/proxy-headers.conf" /etc/nginx/snippets/proxy-headers.conf
  install -m 0644 "$REPO_ROOT/ops/deploy/nginx/shopifyhub.conf" /etc/nginx/sites-available/shopifyhub
  ln -sf /etc/nginx/sites-available/shopifyhub /etc/nginx/sites-enabled/shopifyhub
  if nginx -t; then
    systemctl reload nginx
    echo "✓ nginx 已 reload"
  else
    echo "✗ nginx 配置校验失败" >&2; exit 4
  fi

  systemctl daemon-reload
  systemctl enable shopifyhub-backend shopifyhub-frontend
  if [[ -f /opt/shopifyhub/.env ]] && ! grep -q '__FILL' /opt/shopifyhub/.env; then
    systemctl restart shopifyhub-backend shopifyhub-frontend
    echo "✓ 服务已重启"
  else
    echo "⚠ /opt/shopifyhub/.env 仍含占位 __FILL，未自动重启服务"
    echo "  填完后手动跑：sudo systemctl restart shopifyhub-backend shopifyhub-frontend"
  fi

  echo ""
  echo "=== 节点 A 部署完成 ==="
  echo "下一步："
  echo "  1. journalctl -u shopifyhub-backend -f | grep -i flyway   # 看 V1..V30 全跑过"
  echo "  2. curl -sS http://127.0.0.1:8080/api/health              # 健康检查"
  echo "  3. curl -sS http://127.0.0.1:3000                         # 前端"
}

deploy_node_b() {
  echo ">>> 节点 B：asset-worker"
  ensure_app_user
  install -d -o app -g app /opt/asset-worker

  if [[ -f "$ARTIFACTS_DIR/asset-worker.tar.gz" ]]; then
    install -d -o app -g app /opt/asset-worker/src
    tar xzf "$ARTIFACTS_DIR/asset-worker.tar.gz" -C /opt/asset-worker/src
    chown -R app:app /opt/asset-worker/src
    echo "✓ 部署 /opt/asset-worker/src"
  else
    echo "⚠ 未找到 $ARTIFACTS_DIR/asset-worker.tar.gz，源码不更新"
  fi

  if [[ -d /opt/asset-worker/src/asset-worker ]]; then
    if [[ ! -d /opt/asset-worker/.venv ]]; then
      sudo -u app python3.12 -m venv /opt/asset-worker/.venv
    fi
    sudo -u app /opt/asset-worker/.venv/bin/pip install --quiet -r /opt/asset-worker/src/asset-worker/requirements.txt
    echo "✓ venv 依赖就绪"
  fi

  if [[ ! -f /opt/asset-worker/.env ]]; then
    install -m 0600 -o app -g app "$REPO_ROOT/ops/deploy/env-templates/.env.node-b" /opt/asset-worker/.env
    echo "✓ 生成 /opt/asset-worker/.env（占位值）"
  else
    echo "✓ /opt/asset-worker/.env 已存在"
  fi

  install_systemd_unit shopifyhub-asset-worker.service

  systemctl daemon-reload
  systemctl enable shopifyhub-asset-worker
  if [[ -f /opt/asset-worker/.env ]] && ! grep -q '__FILL' /opt/asset-worker/.env; then
    systemctl restart shopifyhub-asset-worker
    echo "✓ asset-worker 已重启"
  else
    echo "⚠ /opt/asset-worker/.env 仍含占位 __FILL，未自动重启"
  fi

  echo ""
  echo "=== 节点 B 部署完成 ==="
  echo "验证："
  echo "  systemctl status shopifyhub-asset-worker"
  echo "  curl -sS http://127.0.0.1:8000/health"
  echo "  从节点 A：curl http://10.88.0.20:8000/health"
}

deploy_node_c() {
  echo ">>> 节点 C：监控 + Cloudflare Tunnel"
  echo ""
  echo "节点 C 已有专门的 docker-compose stack：ops/monitoring/docker-compose.yml"
  echo "本脚本不重新实现，请按 ops/deploy/cloudflare-tunnel.md + ops/monitoring/ 文档执行："
  echo ""
  echo "  1. 安装 cloudflared：bash ops/bootstrap/07-setup-cloudflare-access.sh"
  echo "  2. 启监控 stack：cd ops/monitoring && docker compose up -d"
  echo "  3. 在 Cloudflare Zero Trust 控制台注册 Tunnel + 路由规则"
  echo ""
  echo "（节点 C 完整自动化留 Wave 3 backlog）"
}

case "$ROLE" in
  a|A) deploy_node_a ;;
  b|B) deploy_node_b ;;
  c|C) deploy_node_c ;;
  *)
    echo "未知 role：$ROLE（支持 a / b / c）" >&2
    exit 2
    ;;
esac
