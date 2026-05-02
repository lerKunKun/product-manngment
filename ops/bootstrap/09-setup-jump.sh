#!/usr/bin/env bash
# 节点 B 配置 jump 用户 + 节点 A/C sshd 改 listen WireGuard 网卡
# 用法：sudo bash 09-setup-jump.sh <角色 jump|backend>
set -euo pipefail
echo ">>> [09] jump-host 配置（占位，Wave 1 完整实现）..."
echo "TODO: 节点 B 加 jump 用户 + ProxyJump 转发；节点 A/C 改 sshd ListenAddress"
