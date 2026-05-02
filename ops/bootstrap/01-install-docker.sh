#!/usr/bin/env bash
# 安装 docker + compose + 必要工具（Ubuntu 22.04）
# 用法：sudo bash 01-install-docker.sh [--dry-run]
set -euo pipefail

DRY_RUN=${1:-}

run() {
  if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "[dry-run] $*"
  else
    eval "$@"
  fi
}

echo ">>> [01] 安装 docker / docker compose / 工具..."

run "apt-get update -y"
run "apt-get install -y ca-certificates curl gnupg lsb-release ufw fail2ban htop tmux jq vim"

run "install -m 0755 -d /etc/apt/keyrings"
run "curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg"
run "chmod a+r /etc/apt/keyrings/docker.gpg"

run "echo 'deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable' > /etc/apt/sources.list.d/docker.list"

run "apt-get update -y"
run "apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin"

run "systemctl enable --now docker"
run "docker --version"
run "docker compose version"

echo ">>> [01] done."
