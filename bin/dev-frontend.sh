#!/usr/bin/env bash
# 启动前端 Next.js dev server
set -e
cd "$(dirname "$0")/../frontend-admin"
exec pnpm dev
